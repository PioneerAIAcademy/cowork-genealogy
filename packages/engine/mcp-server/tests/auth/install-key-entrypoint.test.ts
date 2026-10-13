import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { INSTALL_OPENROUTER_KEY_ENV } from "../../src/auth/config.js";

// The real build/index.js (`pretest` builds it) with the install dialog's key in
// its environment and an empty home, so config.json holds nothing. image_transcribe
// reads the key before the uploaded file, so a missing file reports "not found"
// when the key reached the server and "no key" when it did not — no network.

const INDEX_JS = resolve(dirname(fileURLToPath(import.meta.url)), "../../build/index.js");

let home: string;
let project: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "install-key-home-"));
  project = await mkdtemp(join(tmpdir(), "install-key-project-"));
  await mkdir(join(project, "uploads"));
  await writeFile(join(project, "research.json"), "{}");
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
});

async function transcribeMissingFile(key?: string): Promise<string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("GENEALOGY_") && value !== undefined) env[name] = value;
  }
  Object.assign(env, { HOME: home, USERPROFILE: home });
  if (key !== undefined) env[INSTALL_OPENROUTER_KEY_ENV] = key;

  const client = new Client({ name: "install-key-entrypoint", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [INDEX_JS], env, stderr: "ignore" }));
  try {
    const result = await client.callTool({
      name: "image_transcribe",
      arguments: { file: "uploads/missing.png", projectPath: project },
    });
    return (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");
  } finally {
    await client.close();
  }
}

describe("the stdio entrypoint layers the install dialog's key over config.json", () => {
  it("passes the dialog's key to the tools", async () => {
    expect(await transcribeMissingFile("sk-or-dialog")).toMatch(/was not found under the project folder/);
  }, 30_000);

  it("treats the unsubstituted placeholder as no key", async () => {
    expect(await transcribeMissingFile("${user_config.openrouter_api_key}")).toMatch(
      /No OpenRouter API key is configured/,
    );
  }, 30_000);
});
