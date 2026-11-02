import { describe, it, expect } from "vitest";
import { allToolSchemas } from "../../src/tool-schemas.js";
import { ACCEPTED_ALIASES, nearestParameters, rejectUnknownArgs } from "../../src/utils/unknown-args.js";
import { callTool } from "../helpers/call-tool.js";
import {
  PERSON_READ_REF_REMOVED,
  SECTIONS_NEAR_MISS,
  treeCorrectRejection,
  treeEditRejection,
} from "../../src/utils/tool-hint-messages.js";

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

  it("lets imageArk through to image_read, whose handler folds it into ark", async () => {
    // Not an ARK, so the handler refuses it before any fetch, and the refusal
    // is the ark-format one: the value reached the resolver as `ark`.
    const r = await callTool("image_read", { imageArk: "not-an-ark" });
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain("has no parameter");
    expect(r.text).not.toMatch(/Provide exactly one of|requires one of/);
    expect(r.text).toContain("Unrecognized ark");
  });

  it("redirects a correction op sent to tree_edit, and an addition sent to tree_correct", async () => {
    const edit = await callTool("tree_edit", { projectPath: "/p", operation: "update_fact", personId: "I1", factId: "F1", fact: {} });
    expect(edit.isError).toBe(true);
    expect(edit.text).toContain(treeEditRejection("update_fact"));
    expect(edit.text).not.toContain("no parameter `factId`");
    const correct = await callTool("tree_correct", { projectPath: "/p", operation: "add_fact", sourceAssertionId: "a_001" });
    expect(correct.isError).toBe(true);
    expect(correct.text).toContain(treeCorrectRejection("add_fact"));
  });

  it("names imageGroupNumber for a misspelled group number, not the item hint", async () => {
    const r = await callTool("image_search", { image_group_number: "004884748" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("image_search has no parameter `image_group_number`; the nearest are `imageGroupNumber`");
    expect(r.text).not.toContain("to address one item");
  });

  it("gives a lone sourceDescription the retired-form message", async () => {
    const r = await callTool("extraction_append", { projectPath: "/p", recordIds: ["X"], sourceDescription: { title: "t" } });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("extraction_append no longer takes `sourceDescription`");
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

describe("rejectUnknownArgs: what it echoes back", () => {
  it("sends project_create's own message for the removed personReadRef", async () => {
    const r = await callTool("project_create", { projectPath: "/p", objective: "o", personReadRef: "results/x.json" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain(PERSON_READ_REF_REMOVED);
    expect(r.text).not.toContain("the nearest are");
  });

  it("cuts an over-long key short and suggests nothing for it", () => {
    const key = "k".repeat(100_000);
    const out = rejectUnknownArgs("record_search", { surname: "X", [key]: 1 })!;
    expect(out).toContain(`record_search has no parameter \`${"k".repeat(64)}…\` (100000 characters).`);
    expect(out).not.toContain("the nearest are");
    expect(out).not.toContain("takes no parameters");
    expect(out.length).toBeLessThan(400);
  });

  it("never splits a surrogate pair at the cut", () => {
    const key = "a".repeat(63) + "😀" + "b";
    const out = rejectUnknownArgs("record_search", { [key]: 1 })!;
    expect(out).toContain(`\`${"a".repeat(63)}…\``);
    expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it("names ten unknown keys and counts the rest", () => {
    const many = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`x${i}`, 1]));
    const out = rejectUnknownArgs("record_search", many)!;
    expect(out.match(/has no parameter/g)).toHaveLength(10);
    expect(out).toContain("4990 more keys are not parameters either.");
    expect(out.length).toBeLessThan(2000);
    const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`x${i}`, 1]));
    expect(rejectUnknownArgs("record_search", eleven)).toContain("1 more key is not a parameter either.");
  });

  it("says a no-parameter tool takes none, whatever the key's length", () => {
    expect(rejectUnknownArgs("project_list", { ["p".repeat(200)]: 1 })).toContain("project_list takes no parameters; drop `");
  });

  it("cuts a long key short in image_search's item hint too", () => {
    const out = rejectUnknownArgs("image_search", { imageGroupNumber: "1", ["item".repeat(50)]: 1 })!;
    expect(out).toContain(`image_search has no parameter \`${"item".repeat(16)}…\`; to address one item`);
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

  it("accepts exactly these aliases: adding one is a deliberate edit here", () => {
    expect(ACCEPTED_ALIASES).toEqual({ image_read: ["imageArk"], image_transcribe: ["imageArk"] });
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
