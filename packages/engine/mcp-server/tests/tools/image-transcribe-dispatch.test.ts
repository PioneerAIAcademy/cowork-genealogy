import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// The real build/index.js (`pretest` builds it) with an empty home. A call with
// no projectPath is read with nothing saved and the text returned inline (issue
// #4136), so it is not refused at the stdio boundary: with no OpenRouter key in
// the empty home it reaches the key check and reports "no key" — no network.
// That no longer tells imageTranscribeMcpTool from the shared
// imageTranscribeTool, which reach the same check; dispatch to the MCP entry
// point is covered by the in-process compaction tests in
// image-transcribe.test.ts, and tools/list here pins the advertised schema.

const INDEX_JS = resolve(dirname(fileURLToPath(import.meta.url)), "../../build/index.js");

let home: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "transcribe-dispatch-home-"));
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("the stdio server serves image_transcribe with no projectPath", () => {
  it("does not refuse a call with no projectPath at the boundary, and advertises no required field", async () => {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
      if (!name.startsWith("GENEALOGY_") && value !== undefined) env[name] = value;
    }
    Object.assign(env, { HOME: home, USERPROFILE: home });

    const client = new Client({ name: "transcribe-dispatch", version: "0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [INDEX_JS], env, stderr: "ignore" }));
    try {
      const { tools } = await client.listTools();
      const schema = tools.find((t) => t.name === "image_transcribe")?.inputSchema;
      expect(schema).toBeDefined();
      expect(schema).not.toHaveProperty("required");

      const result = await client.callTool({ name: "image_transcribe", arguments: { imageId: "004884748_02613" } });
      const text = (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");
      expect(result.isError).toBe(true);
      expect(text).toMatch(/OpenRouter/);
      expect(text).not.toMatch(/projectPath/);
    } finally {
      await client.close();
    }
  }, 30_000);
});
