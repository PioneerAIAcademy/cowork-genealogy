import { describe, it, expect } from "vitest";

import { attachedSources, searchDelegations, subjectBlock, MAX_SEARCH_SPAWNS } from "../../src/utils/search-delegations.js";

const TREE = {
  persons: [
    {
      id: "I1",
      names: [{ id: "N1", preferred: true, given: "Patrick", surname: "Flynn", type: "BirthName" }],
      facts: [
        { id: "F1", type: "Birth", primary: true, date: "~1845", place: "Ireland" },
        { id: "F2", type: "Death", date: "1908-03-12", place: "Schuylkill County, Pennsylvania" },
      ],
    },
    { id: "I2", names: [{ id: "N2", given: "Thomas", surname: "Flynn" }] },
    { id: "I3", names: [{ id: "N3", given: "Bridget", surname: "Flynn" }] },
  ],
  relationships: [
    { id: "R1", type: "ParentChild", parent: "I2", child: "I1" },
    { id: "R2", type: "ParentChild", parent: "I3", child: "I1" },
  ],
};

function item(id: string, sequence: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    sequence,
    record_type: "census",
    jurisdiction: "Schuylkill County, Pennsylvania",
    date_range: "1850",
    repository: "FamilySearch",
    rationale: "The 1850 census names every household member.",
    fallback_for: null,
    status: "planned",
    ...extra,
  };
}

function research(items: any[], question = "Where did Patrick live in 1850?", log: any[] = []) {
  return {
    project: { subject_person_ids: ["I1"] },
    questions: [{ id: "q_001", question, status: "in_progress" }],
    plans: [
      { id: "pl_000", question_id: "q_001", status: "superseded", items: [item("pli_900", 1)] },
      { id: "pl_001", question_id: "q_001", status: "active", items },
    ],
    log,
  };
}

const parse = (prompt: string, field: string) => {
  const line = prompt.split("\n").find((l) => l.startsWith(`${field}: `));
  return line === undefined ? undefined : line.slice(field.length + 2);
};

describe("searchDelegations", () => {
  it("writes one spawn per open item of the active plan, with the item verbatim and the subject", () => {
    const items = [item("pli_001", 1), item("pli_002", 2, { record_type: "death" }), item("pli_003", 3, { status: "completed" })];
    const r = research(items);
    const out = searchDelegations("/p", r, TREE, r.questions[0], new Set());
    expect(out.map((d) => [d.planItemId, d.agent])).toEqual([
      ["pli_001", "search-records"],
      ["pli_002", "search-records"],
    ]);
    const prompt = out[0].prompt;
    expect(parse(prompt, "projectPath")).toBe("/p");
    expect(parse(prompt, "questionId")).toBe("q_001");
    expect(parse(prompt, "planId")).toBe("pl_001");
    expect(parse(prompt, "planItemId")).toBe("pli_001");
    expect(JSON.parse(parse(prompt, "plan_item")!)).toEqual(items[0]);
    expect(JSON.parse(parse(prompt, "subject")!)).toEqual({
      subjectId: "I1",
      names: [{ given: "Patrick", surname: "Flynn", type: "BirthName" }],
      birth: { date: "~1845", place: "Ireland" },
      death: { date: "1908-03-12", place: "Schuylkill County, Pennsylvania" },
      parents: [
        { personId: "I2", name: "Thomas Flynn" },
        { personId: "I3", name: "Bridget Flynn" },
      ],
    });
  });

  it("leaves the parents out when the question asks about the subject's parentage", () => {
    const r = research([item("pli_001", 1)], "Was Patrick the son of Thomas Flynn?");
    const [d] = searchDelegations("/p", r, TREE, r.questions[0], new Set());
    expect(JSON.parse(parse(d.prompt, "subject")!).parents).toBeUndefined();
  });

  it("leaves the parents out when the tree gives more than two", () => {
    const tree = {
      ...TREE,
      persons: [...TREE.persons, { id: "I4", names: [{ given: "John", surname: "Flynn" }] }],
      relationships: [...TREE.relationships, { id: "R3", type: "ParentChild", parent: "I4", child: "I1" }],
    };
    expect(subjectBlock(tree, "I1", "Where did he live?")?.parents).toBeUndefined();
  });

  it("caps the step at four spawns, lowest sequence first", () => {
    const r = research([5, 4, 3, 2, 1, 6].map((n) => item(`pli_00${n}`, n)));
    const out = searchDelegations("/p", r, TREE, r.questions[0], new Set());
    expect(out).toHaveLength(MAX_SEARCH_SPAWNS);
    expect(out.map((d) => d.planItemId)).toEqual(["pli_001", "pli_002", "pli_003", "pli_004"]);
  });

  it("sends a hints item at the head of the plan alone, with the person id its rationale names", () => {
    const hints = item("pli_001", 1, {
      record_type: "fs_hints",
      rationale: "Review pending FamilySearch hints on LZNY-BRF before searching.",
    });
    const r = research([hints, item("pli_002", 2)]);
    const out = searchDelegations("/p", r, TREE, r.questions[0], new Set());
    expect(out).toHaveLength(1);
    expect(out[0].agent).toBe("search-hints");
    expect(parse(out[0].prompt, "personId")).toBe("LZNY-BRF");
    expect(parse(out[0].prompt, "subject")).toBeUndefined();
  });

  it("names each item's lane from its repository, never from the rationale's words", () => {
    const r = research([
      item("pli_001", 1, { repository: "FamilySearch (images)" }),
      item("pli_002", 2, { repository: "Ancestry" }),
      item("pli_003", 3, { repository: "FamilySearch (full-text)", rationale: "His baptism is unindexed; full-text search the registers." }),
      item("pli_004", 4, { rationale: "The baptism is unindexed and the probate is browse-only, so search the death index." }),
    ]);
    const out = searchDelegations("/p", r, TREE, r.questions[0], new Set());
    expect(out.map((d) => d.agent)).toEqual(["search-images", "search-external-sites", "search-full-text", "search-records"]);
    expect(parse(out[2].prompt, "subject")).toBeDefined();
    expect(parse(out[0].prompt, "subject")).toBeDefined();
    expect(parse(out[1].prompt, "subject")).toBeUndefined();
  });

  it("leaves out an item whose film is spent and an item waiting on the researcher's upload", () => {
    const log = [
      {
        id: "log_001",
        plan_item_id: "pli_002",
        tool: "external_site",
        outcome: "partial",
        external_site: { site: "ancestry", url_generated: "https://x", capture_received: false },
      },
    ];
    const r = research([item("pli_001", 1), item("pli_002", 2, { repository: "Ancestry" }), item("pli_003", 3)], undefined, log);
    const out = searchDelegations("/p", r, TREE, r.questions[0], new Set(["pli_001"]));
    expect(out.map((d) => d.planItemId)).toEqual(["pli_003"]);
  });

  it("runs a fallback only once its primary has come back empty", () => {
    const fallback = item("pli_002", 2, { fallback_for: "pli_001" });
    const open = research([item("pli_001", 1), fallback]);
    expect(searchDelegations("/p", open, TREE, open.questions[0], new Set()).map((d) => d.planItemId)).toEqual(["pli_001"]);

    const done = item("pli_001", 1, { status: "completed" });
    const found = research([done, fallback], undefined, [{ id: "log_001", plan_item_id: "pli_001", outcome: "positive" }]);
    expect(searchDelegations("/p", found, TREE, found.questions[0], new Set())).toEqual([]);

    const nil = research([done, fallback], undefined, [{ id: "log_001", plan_item_id: "pli_001", outcome: "negative" }]);
    expect(searchDelegations("/p", nil, TREE, nil.questions[0], new Set()).map((d) => d.planItemId)).toEqual(["pli_002"]);
  });

  it("runs a fallback when its primary's only positive entries are page reads the tool logged (#4721)", () => {
    const fallback = item("pli_002", 2, { fallback_for: "pli_001" });
    const done = item("pli_001", 1, { status: "completed" });
    const r = research([done, fallback], undefined, [
      { id: "log_001", plan_item_id: "pli_001", tool: "image_search", outcome: "negative" },
      { id: "log_002", plan_item_id: "pli_001", tool: "image_transcribe", written_by: "image_transcribe", outcome: "positive" },
    ]);
    expect(searchDelegations("/p", r, TREE, r.questions[0], new Set()).map((d) => d.planItemId)).toEqual(["pli_002"]);

    const onlyReads = research([done, fallback], undefined, [
      { id: "log_001", plan_item_id: "pli_001", tool: "image_transcribe", written_by: "image_transcribe", outcome: "negative" },
    ]);
    expect(searchDelegations("/p", onlyReads, TREE, onlyReads.questions[0], new Set())).toEqual([]);
  });

  it("searches a given name no linked record carries by its searchAs form and says so", () => {
    const r = research([item("pli_001", 1)]);
    const [d] = searchDelegations("/p", r, TREE, r.questions[0], new Set(), { given: "Patrick", searchAs: "P*" });
    expect(JSON.parse(parse(d.prompt, "subject")!).names[0].given).toBe("P*");
    expect(d.prompt).toContain('"Patrick" is a reading in doubt');
  });

  it("lists the subject's attached sources, not the Family Tree read or a relative's", () => {
    const tree = {
      persons: [
        {
          id: "I1",
          sources: [{ ref: "S2" }],
          names: [{ given: "A", sources: [{ ref: "S1" }] }],
          facts: [{ type: "Death", sources: [{ ref: "S3" }, { ref: "S1" }] }],
        },
        { id: "I2", sources: [{ ref: "S4" }] },
      ],
      sources: [
        { id: "S1", title: "FamilySearch Family Tree (read from Ann Lee, AAAA-111)" },
        { id: "S2", title: 'Ann Lee, "Ohio, Births, 1840"' },
        { id: "S3", title: 'Ann Lee, "Ohio, Deaths, 1900"' },
        { id: "S4", title: "A relative's census" },
      ],
    };
    expect(attachedSources(tree, "I1")).toEqual([
      { id: "S2", title: 'Ann Lee, "Ohio, Births, 1840"' },
      { id: "S3", title: 'Ann Lee, "Ohio, Deaths, 1900"' },
    ]);
    expect(attachedSources(tree, "I9")).toEqual([]);
  });

  it("gives an attached source its recordId only when its url is a 1:1 persona ARK record_read takes", () => {
    const tree = {
      persons: [{ id: "I1", sources: ["S2", "S3", "S4", "S5"].map((ref) => ({ ref })) }],
      sources: [
        { id: "S2", title: 'Benj Phillips, "United States, Census, 1860"', url: "https://familysearch.org/ark:/61903/1:1:MHR9-JWT" },
        { id: "S3", title: "1860 Federal Census, Agriculture Schedule", url: "https://familysearch.org/ark:/61903/3:1:3QHJ-1QDY-S9ZM-4" },
        { id: "S4", title: "A record link", url: "https://familysearch.org/ark:/61903/1:2:QQ9N-2ZRB?view=index" },
        { id: "S5", title: "A source with no url" },
      ],
    };
    expect(attachedSources(tree, "I1")).toEqual([
      { id: "S2", title: 'Benj Phillips, "United States, Census, 1860"', recordId: "ark:/61903/1:1:MHR9-JWT" },
      { id: "S3", title: "1860 Federal Census, Agriculture Schedule" },
      { id: "S4", title: "A record link" },
      { id: "S5", title: "A source with no url" },
    ]);
  });

  it("returns nothing for a question with no active plan", () => {
    const r = { ...research([item("pli_001", 1)]), plans: [] };
    expect(searchDelegations("/p", r, TREE, r.questions[0], new Set())).toEqual([]);
  });
});
