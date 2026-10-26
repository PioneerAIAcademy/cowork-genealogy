import { describe, it, expect } from "vitest";
import { allToolSchemas } from "../../src/tool-schemas.js";
import { nearestParameters, rejectUnknownArgs } from "../../src/utils/unknown-args.js";
import { callTool } from "../helpers/call-tool.js";

const LUXEMBOURG = { surname: "X", recordCountry: "Luxembourg" };

describe("rejectUnknownArgs through the server (#3736)", () => {
  it("refuses record_search's marriageYear, naming it and the nearest parameters", async () => {
    const r = await callTool("record_search", { ...LUXEMBOURG, marriageYear: 1866 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("record_search has no parameter `marriageYear`; the nearest are ");
    expect(r.text).toMatch(/`marriageYearFrom`|`marriageYearTo`/);
    expect(r.text).toContain("Nothing was run");
  });

  it("names every unknown key of one call, not only the first", async () => {
    const r = await callTool("record_search", { collection: 5000012, country: "Luxembourg", surname: "Grigard" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("no parameter `collection`");
    expect(r.text).toContain("no parameter `country`");
  });

  it("refuses image_read's memoryArtifactUrl, which its schema does not list", async () => {
    const r = await callTool("image_read", { memoryArtifactUrl: "https://example.org/x" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("image_read has no parameter `memoryArtifactUrl`");
  });
});

describe("rejectUnknownArgs: what it lets through", () => {
  it("every advertised tool has a top-level properties object", () => {
    for (const t of allToolSchemas as any[]) {
      expect(typeof t.inputSchema?.properties, t.name).toBe("object");
    }
  });

  it("passes a call carrying every declared parameter of every tool", () => {
    for (const t of allToolSchemas as any[]) {
      const args = Object.fromEntries(Object.keys(t.inputSchema.properties).map((k) => [k, "x"]));
      expect(rejectUnknownArgs(t.name, args), t.name).toBeNull();
    }
  });

  it("checks top-level names only, not nested objects", () => {
    expect(
      rejectUnknownArgs("research_log_append", {
        projectPath: "/p",
        tool: "external_site",
        outcome: "negative",
        resultsExamined: 0,
        query: { recordType: "Marriage", collection: "PA marriages" },
      }),
    ).toBeNull();
  });

  it("leaves an unadvertised tool and a missing arguments object to the dispatcher", () => {
    expect(rejectUnknownArgs("no_such_tool", { anything: 1 })).toBeNull();
    expect(rejectUnknownArgs("record_search", undefined)).toBeNull();
  });
});

describe("nearestParameters", () => {
  it("ranks by edit distance, case folded, ties in schema order", () => {
    expect(nearestParameters("ITEM", ["itemImage", "item", "imageGroupNumber"])).toEqual(["item", "itemImage", "imageGroupNumber"]);
    expect(nearestParameters("b", ["a", "c", "d", "e"])).toEqual(["a", "c", "d"]);
  });
});
