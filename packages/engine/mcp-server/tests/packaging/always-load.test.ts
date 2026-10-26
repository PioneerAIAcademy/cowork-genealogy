import { describe, it, expect } from "vitest";
import { ALWAYS_LOAD } from "../../src/tool-schemas.js";
import { listTools } from "../helpers/list-tools.js";

// Pins the tools exempt from ToolSearch deferral. Changing the set is a
// cost decision: re-measure against the e2e corpus and update this list with it.
const PINNED = [
  "project_context",
  // Added for reachability: the research router calls it first in every
  // conversation that names no projectPath, so deferring it would put a
  // ToolSearch round trip in front of every new conversation.
  "project_list",
  "record_read",
  "research_append",
  // 802 B, under a third of record_read (2,363 B). Added for reachability, not
  // frequency: the hosted Stop hook lets a bounded turn stop ONLY when the model
  // calls this tool, so deferring it puts a ToolSearch round trip in front of the
  // one moment that must not fail. A model that has not loaded the schema is
  // nudged back into more research instead (#2813 item 1).
  "research_delivered",
  "research_log_append",
  "research_query",
];

const KEY = "anthropic/alwaysLoad";

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
