import { describe, it, expect } from "vitest";
import { allToolSchemas } from "../../src/tool-schemas.js";
import { nearestParameters, rejectUnknownArgs } from "../../src/utils/unknown-args.js";
import { callTool } from "../helpers/call-tool.js";
import { IMAGE_TRANSCRIBE_NEEDS_PROJECT_MESSAGE } from "../../src/tools/image-transcribe.js";
import { SECTIONS_NEAR_MISS } from "../../src/tools/research-query.js";

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

  it("lets imageArk through to image_transcribe, whose handler folds it into ark", async () => {
    const r = await callTool("image_transcribe", { imageArk: "ark:/61903/3:1:3QS7-L9S9-ZQ1T" });
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain("has no parameter");
    expect(r.text).toContain(IMAGE_TRANSCRIBE_NEEDS_PROJECT_MESSAGE);
  });

  it("answers research_query's plural sections with the singular near-miss", async () => {
    const r = await callTool("research_query", { projectPath: "/p", sections: ["log"] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain(SECTIONS_NEAR_MISS);
    expect(r.text).not.toContain("the nearest are");
  });

  it("says a tool takes no parameters rather than listing an empty nearest", async () => {
    const r = await callTool("project_list", { projectPath: "/p" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("project_list takes no parameters; drop `projectPath`.");
    expect(r.text).not.toContain("the nearest are .");
  });

  it("gives image_search's item hint only to a key that names a place in the film", async () => {
    const r = await callTool("image_search", { imageGroupNumber: "004528134", maxResults: 50 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("image_search has no parameter `maxResults`; the nearest are");
    expect(r.text).not.toContain("to address one item");
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

  it("accepts imageArk on the two image tools, and nowhere else", () => {
    expect(rejectUnknownArgs("image_read", { imageArk: "ark:/61903/3:1:X" })).toBeNull();
    expect(rejectUnknownArgs("image_transcribe", { imageArk: "ark:/61903/3:1:X" })).toBeNull();
    expect(rejectUnknownArgs("image_search", { imageGroupNumber: "1", imageArk: "ark:/61903/3:1:X" })).not.toBeNull();
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
