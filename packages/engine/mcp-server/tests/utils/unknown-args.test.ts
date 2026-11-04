import { describe, it, expect } from "vitest";
import { allToolSchemas } from "../../src/tool-schemas.js";
import { ACCEPTED_ALIASES, nearestParameters, rejectUnknownArgs } from "../../src/utils/unknown-args.js";
import { SECTION_FILTERS } from "../../src/tools/research-query.js";
import { RECORD_TYPE_GROUP_NAMES } from "../../src/utils/record-type-groups.js";
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

describe("rejectUnknownArgs: a key that belongs to another tool's shape (#4075)", () => {
  // Pinned: a section gaining a filter on its own id is a deliberate edit here,
  // and the no-section entryId sentence must then name it.
  const ID_READS = [
    ["questions", "questionId"],
    ["sources", "sourceId"],
    ["assertions", "assertionId"],
    ["conflicts", "conflictId"],
  ];

  /** The keys a refusal lists after "Section `s` filters only by", in order. */
  function listedKeys(text: string, section: string): string[] {
    const m = text.match(new RegExp(`Section \`${section}\` filters only by ([^;]*);`));
    expect(m).not.toBeNull();
    return [...m![1].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
  }

  function expectSectionKeys(text: string, section: keyof typeof SECTION_FILTERS) {
    expect(listedKeys(text, section)).toEqual(Object.keys(SECTION_FILTERS[section]));
    expect(text).toContain(
      "a filter not in that list does not exist there, so leave it out (with none left, the call reads the whole section).",
    );
  }

  it("names exactly the sections SECTION_FILTERS gives a filter on an entry's own id", () => {
    const fromTable = Object.entries(SECTION_FILTERS).flatMap(([section, rules]) =>
      Object.entries(rules)
        .filter(([, rule]) => rule?.field === "id")
        .map(([key]) => [section, key]),
    );
    expect(fromTable).toEqual(ID_READS);
  });

  it.each([
    ["a JSON string", '{"questionId":"q_001"}'],
    ["an object", { questionId: "q_001" }],
  ])("answers filters given as %s with the section's own filter arguments", async (_, filters) => {
    const r = await callTool("research_query", { projectPath: "/p", section: "plans", filters });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("research_query has no parameter `filters`: send each filter as its own argument");
    expectSectionKeys(r.text, "plans");
    expect(listedKeys(r.text, "plans")).toEqual(["questionId", "status"]);
    expect(r.text).not.toContain("the nearest are");
  });

  it("names the singular filter as sent, with the section's keys", async () => {
    const r = await callTool("research_query", { projectPath: "/p", section: "assertions", filter: '{"fact_type":"Christening"}' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("research_query has no parameter `filter`:");
    expectSectionKeys(r.text, "assertions");
    expect(r.text).not.toContain("the nearest are");
  });

  it("names filters and filter together, and gives neither the generic line", async () => {
    const r = await callTool("research_query", { projectPath: "/p", section: "plans", filters: "{}", filter: "{}" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("research_query has no parameters `filters` and `filter`:");
    expect(r.text).not.toContain("the nearest are");
  });

  it("says a section with no filters takes none", async () => {
    expect(Object.keys(SECTION_FILTERS.localities)).toEqual([]);
    const r = await callTool("research_query", { projectPath: "/p", section: "localities", filters: "{}" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("section `localities` takes no filters: drop `filters` to read the whole section");
    expect(r.text).not.toContain("the nearest are");
  });

  it.each([
    ["no section", {}],
    ["a prototype key", { section: "constructor" }],
    ["an array", { section: ["plans"] }],
    ["an unknown section", { section: "no_such_section_x" }],
  ])("still refuses filters with %s, lists no section's keys and echoes nothing", async (_, extra) => {
    const r = await callTool("research_query", { projectPath: "/p", ...extra, filters: '{"status":"active"}' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain(
      "research_query has no parameter `filters`: send each filter as its own argument beside `section`; " +
        "this tool's description lists the filters each section takes.",
    );
    expect(r.text).not.toContain("filters only by");
    expect(r.text).not.toContain("takes no filters");
    expect(r.text).not.toMatch(/constructor|no_such_section_x|Section `/);
    expect(r.text).not.toContain("the nearest are");
  });

  it("points entryId at the section's id filter, never at a writer", async () => {
    const r = await callTool("research_query", { projectPath: "/p", section: "conflicts", entryId: "c_002" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("to read one `conflicts` entry by its id, pass `conflictId`.");
    expect(r.text).not.toMatch(/research_append|evaluation_append/);
    expect(r.text).not.toContain("the nearest are");
  });

  it("tells entryId on a section with no id filter to read the section", async () => {
    expect(ID_READS.some(([section]) => section === "person_evidence")).toBe(false);
    const r = await callTool("research_query", { projectPath: "/p", section: "person_evidence", entryId: "pe_001" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("section `person_evidence` has no filter on an entry's own id: drop `entryId` and read the section");
    expect(r.text).not.toContain("the nearest are");
  });

  it.each([
    ["no section", {}],
    ["a prototype key", { section: "constructor" }],
  ])("lists every section that reads one entry by id for entryId with %s", async (_, extra) => {
    const r = await callTool("research_query", { projectPath: "/p", ...extra, entryId: "c_002" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain(
      "research_query has no parameter `entryId`: only `questions` (`questionId`), `sources` (`sourceId`), " +
        "`assertions` (`assertionId`) and `conflicts` (`conflictId`) read one entry by its own id; on any " +
        "other section, drop `entryId` and read the section.",
    );
    expect(r.text).not.toContain("the nearest are");
  });

  it("answers sections, filters and entryId in one call, each with its own sentence", async () => {
    const r = await callTool("research_query", {
      projectPath: "/p",
      section: "conflicts",
      sections: ["log"],
      filters: "{}",
      entryId: "c_002",
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain(SECTIONS_NEAR_MISS);
    expectSectionKeys(r.text, "conflicts");
    expect(r.text).toContain("entry by its id, pass `conflictId`");
    expect(r.text).not.toContain("the nearest are");
  });

  it("keeps the nearest-parameter line for a research_query typo", async () => {
    const r = await callTool("research_query", { projectPath: "/p", section: "plans", surnam: "x" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("research_query has no parameter `surnam`; the nearest are");
  });

  it("leaves a typo sent beside filters to the nearest-parameter line", async () => {
    const r = await callTool("research_query", { projectPath: "/p", section: "plans", filters: "{}", surnam: "x" });
    expect(r.isError).toBe(true);
    expectSectionKeys(r.text, "plans");
    expect(r.text).toContain("research_query has no parameter `surnam`; the nearest are");
    expect(r.text).not.toContain("no parameter `filters`; the nearest are");
  });

  it.each(["recordType", "record_type", "recordTypes", "recordTypeGroup", "recordTypeGroups"])(
    "tells catalog_search's %s to drop it and names volume_search",
    async (alias) => {
      const r = await callTool("catalog_search", { standardPlace: "Škofja Loka, Slovenia", [alias]: "[]" });
      expect(r.isError).toBe(true);
      expect(r.text).toContain(`catalog_search has no record-type filter, so drop ${alias} and search by place.`);
      expect(r.text).toContain("volume_search's recordTypeGroups (an array of group names).");
      expect(r.text).toContain(`Valid groups: ${RECORD_TYPE_GROUP_NAMES.join(", ")}.`);
      expect(r.text).not.toMatch(/subject|keywords/);
      expect(r.text).not.toContain("the nearest are");
    },
  );

  it("names every record-type alias sent to catalog_search, and offers keywords for none", async () => {
    const r = await callTool("catalog_search", { standardPlace: "Ohio, United States", recordType: "Census", recordTypeGroups: ["Census"] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("so drop recordType and recordTypeGroups and search by place.");
    expect(r.text).not.toMatch(/subject|keywords/);
    expect(r.text).not.toContain("the nearest are");
  });

  it("keeps the nearest-parameter line for a catalog_search typo", async () => {
    const r = await callTool("catalog_search", { standardPlace: "Ohio, United States", keyword: "census" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("catalog_search has no parameter `keyword`; the nearest are `keywords`");
    expect(r.text).not.toContain("record-type filter");
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
