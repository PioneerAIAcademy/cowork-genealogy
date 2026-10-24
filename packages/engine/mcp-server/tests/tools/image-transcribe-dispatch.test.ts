import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { IMAGE_TRANSCRIBE_NEEDS_PROJECT_MESSAGE } from "../../src/tools/image-transcribe.js";

// The real build/index.js (`pretest` builds it) with an empty home. The MCP arm
// must dispatch to imageTranscribeMcpTool, which refuses a call with no
// projectPath before anything else. Dispatching to the shared imageTranscribeTool
// instead would return the page inline; here it would reach the OpenRouter key
// check and report "no key" rather than the projectPath refusal — no network.

const INDEX_JS = resolve(dirname(fileURLToPath(import.meta.url)), "../../build/index.js");

let home: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "transcribe-dispatch-home-"));
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("the stdio server dispatches image_transcribe to its MCP entry point", () => {
  it("refuses a call with no projectPath", async () => {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
      if (!name.startsWith("GENEALOGY_") && value !== undefined) env[name] = value;
    }
    Object.assign(env, { HOME: home, USERPROFILE: home });

    const client = new Client({ name: "transcribe-dispatch", version: "0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [INDEX_JS], env, stderr: "ignore" }));
    try {
      const result = await client.callTool({ name: "image_transcribe", arguments: { imageId: "004884748_02613" } });
      const text = (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");
      expect(result.isError).toBe(true);
      expect(text).toContain(IMAGE_TRANSCRIBE_NEEDS_PROJECT_MESSAGE);
    } finally {
      await client.close();
    }
  }, 30_000);
});
