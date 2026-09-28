import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { LOCAL } from "../../src/auth/principal.js";
import { ALWAYS_LOAD } from "../../src/tool-schemas.js";

// Pins the tools exempt from ToolSearch deferral. Changing the set is a
// cost decision: re-measure against the e2e corpus and update this list with it.
const PINNED = [
  "project_context",
  "record_read",
  "research_append",
  "research_log_append",
  "research_query",
];

const KEY = "anthropic/alwaysLoad";

async function listTools() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer(LOCAL);
  await server.connect(serverSide);
  const client = new Client({ name: "always-load-test", version: "0" });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

describe("ALWAYS_LOAD", () => {
  it("is exactly the pinned set", () => {
    expect([...ALWAYS_LOAD].sort()).toEqual(PINNED);
  });

  it("reaches tools/list as a top-level _meta key on exactly the pinned tools", async () => {
    const tools = await listTools();
    const flagged = tools.filter((t) => t._meta?.[KEY] === true).map((t) => t.name).sort();
    expect(flagged).toEqual(PINNED);
    for (const t of tools) {
      if (!PINNED.includes(t.name)) expect(t._meta, t.name).toBeUndefined();
      expect(JSON.stringify(t.inputSchema), t.name).not.toContain(KEY);
    }
  });
});
