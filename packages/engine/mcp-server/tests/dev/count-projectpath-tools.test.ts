import { describe, it, expect } from "vitest";
import { partitionByProjectPath } from "../../dev/count-projectpath-tools.js";

const tool = (name: string, properties: Record<string, unknown>, required: string[] = []) => ({
  name,
  inputSchema: { properties, required },
});

describe("partitionByProjectPath", () => {
  it("counts a tool by projectPath among its top-level properties, required or not", () => {
    const { takes, required, without } = partitionByProjectPath([
      tool("research_append", { projectPath: { type: "string" } }, ["projectPath"]),
      tool("record_read", { recordId: { type: "string" }, projectPath: { type: "string" } }, ["recordId"]),
      tool("place_search", { query: { type: "string" } }),
      tool("nested", { opts: { type: "object", properties: { projectPath: { type: "string" } } } }),
      { name: "no_schema" },
    ]);
    expect(takes.map((t) => t.name)).toEqual(["research_append", "record_read"]);
    expect(required.map((t) => t.name)).toEqual(["research_append"]);
    expect(without.map((t) => t.name)).toEqual(["place_search", "nested", "no_schema"]);
  });
});
