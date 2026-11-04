import { describe, it, expect, vi, beforeEach } from "vitest";

// The host build's place step goes through the converter's own resolver; stub
// it so these stay offline and deterministic.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn() };
});

import { resolveStandardPlace } from "../../src/utils/place-resolver.js";
import { buildFromStagedRead, accessDate } from "../../src/utils/person-read-tree.js";

const resolver = vi.mocked(resolveStandardPlace);
const NOW = new Date("2026-10-01T12:00:00Z");

const read = (facts: Array<Record<string, unknown>>) => ({
  personId: "LZNY-BRF",
  requestedId: "LZNY-BRF",
  gedcomx: {
    persons: [{ id: "LZNY-BRF", gender: "Male", living: false, names: [{ given: "Patrick", surname: "Flynn" }], facts }],
    relationships: [],
    sources: [],
  },
});

beforeEach(() => {
  resolver.mockReset();
});

/** Build, then run the place retry the way project_create does, after its checks. */
async function buildAndFill(args: Parameters<typeof buildFromStagedRead>[0]) {
  const built = await buildFromStagedRead(args);
  await built.fillPlaces();
  return built;
}

describe("buildFromStagedRead — places the read could not standardize", () => {
  it("fills a missing standard_place through the resolver", async () => {
    resolver.mockResolvedValue("Schuylkill, Pennsylvania, United States");
    const { tree } = await buildAndFill({
      staged: read([{ type: "Death", place: "Schuylkill Co., PA" }]),
      now: NOW,
    });
    expect(tree.persons[0].facts[0].standard_place).toBe("Schuylkill, Pennsylvania, United States");
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("reports each resolution once, however the place was spelled", async () => {
    resolver.mockResolvedValue("Ireland");
    const built = await buildFromStagedRead({
      staged: read([{ type: "Birth", place: "Ireland" }, { type: "Residence", place: "  ireland " }]),
      now: NOW,
    });
    expect(await built.fillPlaces()).toEqual([{ place: "Ireland", standardPlace: "Ireland" }]);
    expect(built.tree.persons[0].facts.map((f: any) => f.standard_place)).toEqual(["Ireland", "Ireland"]);
  });

  it("makes no resolver call when every fact already carries standard_place", async () => {
    await buildAndFill({
      staged: read([{ type: "Birth", place: "Ireland", standard_place: "Ireland" }]),
      now: NOW,
    });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("leaves the fact as it was when the resolver finds nothing", async () => {
    resolver.mockResolvedValue(null);
    const { tree } = await buildAndFill({
      staged: read([{ type: "Death", place: "Same Place" }]),
      now: NOW,
    });
    expect("standard_place" in tree.persons[0].facts[0]).toBe(false);
    expect(tree.persons[0].facts[0].place).toBe("Same Place");
  });
});

describe("buildFromStagedRead — the place retry's time budget", () => {
  it("returns within the budget when the resolver hangs, keeping the place unresolved", async () => {
    vi.useFakeTimers();
    try {
      resolver.mockImplementation(() => new Promise(() => {}));
      const built = buildAndFill({ staged: read([{ type: "Death", place: "Hanging Place" }]), now: NOW });
      await vi.advanceTimersByTimeAsync(21_000);
      const { tree } = await built;
      expect("standard_place" in tree.persons[0].facts[0]).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  }, 5_000);

  it("never lets an answer that arrives after the budget land on the returned tree", async () => {
    vi.useFakeTimers();
    try {
      let answer: (v: string) => void = () => {};
      resolver.mockImplementation(() => new Promise<string>((r) => { answer = r; }));
      const built = buildAndFill({ staged: read([{ type: "Death", place: "Slow Place" }]), now: NOW });
      await vi.advanceTimersByTimeAsync(21_000);
      const { tree } = await built;
      answer("Slow Place, Somewhere");
      await vi.runAllTimersAsync();
      expect("standard_place" in tree.persons[0].facts[0]).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  }, 5_000);
});

// A PIN, green before the change that made `person_read` carry relationship refs, because
// `remapRefs` already treated a relationship's refs like a person's. It is here because the
// failure it guards is silent: a ref that stops being re-pointed vanishes at this step with
// no error, and the built tree is exactly as unsourced as it was (issue #3229).
describe("buildFromStagedRead — a relationship's own source refs", () => {
  const person = (id: string, given: string) => ({
    id,
    gender: "Male",
    living: false,
    names: [{ given, surname: "Flynn" }],
  });
  const staged = () => ({
    personId: "LZNY-BRF",
    requestedId: "LZNY-BRF",
    gedcomx: {
      persons: [person("LZNY-BRF", "Patrick"), person("LZNY-DAD", "Joseph")],
      relationships: [
        {
          type: "ParentChild",
          parent: "LZNY-DAD",
          child: "LZNY-BRF",
          sources: [{ ref: "SRC-BAPTISM" }, { ref: "SRC-NOT-IN-THE-READ" }],
        },
      ],
      sources: [{ id: "SRC-BAPTISM", title: "A baptism" }],
    },
  });

  it("keeps an edge's FamilySearch source as its S id, beside the S1 ref, and drops one that resolves nowhere", async () => {
    const { tree, idMap } = await buildFromStagedRead({ staged: staged(), now: NOW });
    const own = idMap.sources["SRC-BAPTISM"];
    expect(own).toBeDefined();
    expect(own).not.toBe(idMap.familySearchTreeSource);
    expect(tree.sources.find((s) => s.id === own)).toMatchObject({ title: "A baptism" });
    expect(tree.relationships[0].sources).toEqual([
      { ref: own },
      { ref: idMap.familySearchTreeSource, quality: 1 },
    ]);
    expect(idMap.familySearchTreeSource).toBe("S1");
  });
});

describe("accessDate", () => {
  it("renders the Evidence Explained access-date form in UTC", () => {
    expect(accessDate(new Date("2026-10-01T23:30:00Z"))).toBe("1 October 2026");
    expect(accessDate(new Date("2026-01-09T00:00:00Z"))).toBe("9 January 2026");
  });
});

describe("buildFromStagedRead — ParentChild loops in the read (#4085)", () => {
  type Rel = Record<string, string>;
  const person = (id: string, given: string) => ({ id, gender: "Unknown", living: false, names: [{ given, surname: "X" }] });
  const pc = (parent: string, child: string): Rel => ({ type: "ParentChild", parent, child });
  const couple = (person1: string, person2: string): Rel => ({ type: "Couple", person1, person2 });
  const build = (subject: string, persons: ReturnType<typeof person>[], relationships: Rel[]) =>
    buildFromStagedRead({
      staged: { personId: subject, requestedId: subject, gedcomx: { persons, relationships, sources: [] } },
      now: NOW,
    });
  /** The built tree's ParentChild edges as "parentPid>childPid", via the idMap. */
  const edges = (built: Awaited<ReturnType<typeof build>>) => {
    const pid = Object.fromEntries(Object.entries(built.idMap.persons).map(([k, v]) => [v, k]));
    return built.tree.relationships
      .filter((r) => r.type === "ParentChild")
      .map((r) => `${pid[r.parent]}>${pid[r.child]}`);
  };
  const droppedPids = (built: Awaited<ReturnType<typeof build>>) => {
    const pid = Object.fromEntries(Object.entries(built.idMap.persons).map(([k, v]) => [v, k]));
    return built.droppedLoopEdges.map((e) => `${pid[e.parent]}>${pid[e.child]}`);
  };

  // salvador-choc-daughter: Salvador (subject) married Petrona; Catarina is
  // their child; FamilySearch also records Catarina as Petrona's parent (R27).
  const SALVADOR = person("MGDD-CB5", "Salvador");
  const PETRONA = person("GG1G-697", "Petrona");
  const CATARINA = person("94B1-P5D", "Catarina");
  const salvadorRels = [
    couple("MGDD-CB5", "GG1G-697"),
    pc("MGDD-CB5", "94B1-P5D"),
    pc("GG1G-697", "94B1-P5D"),
    pc("94B1-P5D", "GG1G-697"),
  ];

  it("salvador shape: drops the child recorded as the spouse's parent, keeps the spouse as the child's parent", async () => {
    const built = await build("MGDD-CB5", [SALVADOR, PETRONA, CATARINA], salvadorRels);
    expect(droppedPids(built)).toEqual(["94B1-P5D>GG1G-697"]);
    expect(edges(built)).toEqual(["MGDD-CB5>94B1-P5D", "GG1G-697>94B1-P5D"]);
    expect(built.droppedLoopEdges[0]).toMatchObject({
      parentName: "Catarina X",
      childName: "Petrona X",
      cycleLength: 2,
    });
  });

  it("isabel shape: drops Ramón as Emilio's parent, keeps Emilio as Ramón's", async () => {
    // isabel-carvajal-daughter: Isabel (subject) married Emilio; Ramón is
    // their child; FamilySearch also records Ramón as Emilio's parent (R16).
    const built = await build(
      "ISAB-001",
      [person("ISAB-001", "Isabel"), person("G5CM-DZW", "Emilio"), person("PZZK-M43", "Ramón")],
      [couple("G5CM-DZW", "ISAB-001"), pc("G5CM-DZW", "PZZK-M43"), pc("ISAB-001", "PZZK-M43"), pc("PZZK-M43", "G5CM-DZW")],
    );
    expect(droppedPids(built)).toEqual(["PZZK-M43>G5CM-DZW"]);
    expect(edges(built)).toEqual(["G5CM-DZW>PZZK-M43", "ISAB-001>PZZK-M43"]);
  });

  it("decides by generation, not by order: the wrong edge listed first is still the one dropped", async () => {
    const reordered = [salvadorRels[0], salvadorRels[1], salvadorRels[3], salvadorRels[2]];
    const built = await build("MGDD-CB5", [SALVADOR, PETRONA, CATARINA], reordered);
    expect(droppedPids(built)).toEqual(["94B1-P5D>GG1G-697"]);
    expect(edges(built)).toEqual(["MGDD-CB5>94B1-P5D", "GG1G-697>94B1-P5D"]);
  });

  it.each([
    ["right edge listed first", [0, 1, 2, 3]],
    ["wrong edge listed first", [0, 1, 3, 2]],
  ])("seeded from a person ON the loop, the loop's own edges set no generation (%s)", async (_label, order) => {
    // Catarina is the subject. Walking the loop edges would reach Petrona
    // through the wrong edge (Catarina>Petrona, Petrona = −1) when it is
    // listed first, and drop Petrona as Catarina's mother. Petrona's
    // generation must come from Salvador instead: +1 as his wife.
    const built = await build("94B1-P5D", [SALVADOR, PETRONA, CATARINA], order.map((i) => salvadorRels[i]));
    expect(droppedPids(built)).toEqual(["94B1-P5D>GG1G-697"]);
    expect(edges(built).sort()).toEqual(["GG1G-697>94B1-P5D", "MGDD-CB5>94B1-P5D"]);
  });

  it("drops the later edge when a person on the loop has no generation", async () => {
    const built = await build(
      "SUBJ-001",
      [person("SUBJ-001", "Subject"), person("FARA-001", "A"), person("FARB-001", "B")],
      [pc("FARA-001", "FARB-001"), pc("FARB-001", "FARA-001")],
    );
    expect(droppedPids(built)).toEqual(["FARB-001>FARA-001"]);
  });

  it.each([
    ["A>B listed first", [0, 1], "BBBB-001>AAAA-001"],
    ["B>A listed first", [1, 0], "AAAA-001>BBBB-001"],
  ])("on a tie drops the loop edge listed later (%s)", async (_label, order, expected) => {
    // A and B are both the subject's partners, so both are generation 0 and
    // both loop edges score 0.
    const loop = [pc("AAAA-001", "BBBB-001"), pc("BBBB-001", "AAAA-001")];
    const built = await build(
      "SUBJ-001",
      [person("SUBJ-001", "Subject"), person("AAAA-001", "A"), person("BBBB-001", "B")],
      [couple("SUBJ-001", "AAAA-001"), couple("SUBJ-001", "BBBB-001"), loop[order[0]], loop[order[1]]],
    );
    expect(droppedPids(built)).toEqual([expected]);
  });

  it("breaks a three-person loop by dropping exactly one edge", async () => {
    // F is the subject's father and G is F's father; the subject is also
    // recorded as G's parent. Every edge is on the loop, so none sets a
    // generation, F and G have none, and the edge listed last goes: the
    // subject as G's parent, keeping the plausible line G > F > subject.
    const built = await build(
      "SUBJ-001",
      [person("SUBJ-001", "Subject"), person("FATH-001", "F"), person("GRAN-001", "G")],
      [pc("FATH-001", "SUBJ-001"), pc("GRAN-001", "FATH-001"), pc("SUBJ-001", "GRAN-001")],
    );
    expect(droppedPids(built)).toEqual(["SUBJ-001>GRAN-001"]);
    expect(built.droppedLoopEdges[0].cycleLength).toBe(3);
    expect(edges(built)).toEqual(["FATH-001>SUBJ-001", "GRAN-001>FATH-001"]);
  });

  it("a three-person loop with an outside anchor drops the edge that inverts generations", async () => {
    // As above, plus edges off the loop: the subject's mother M (married to
    // F) and G's wife H (F's mother). Through them F is +1 and G is +2, so
    // the subject>G edge scores −2 against +1 for the other two.
    const built = await build(
      "SUBJ-001",
      ["SUBJ-001", "FATH-001", "GRAN-001", "MOTH-001", "GRAM-001"].map((id) => person(id, id)),
      [
        pc("MOTH-001", "SUBJ-001"),
        couple("MOTH-001", "FATH-001"),
        pc("GRAM-001", "FATH-001"),
        couple("GRAM-001", "GRAN-001"),
        pc("SUBJ-001", "GRAN-001"),
        pc("FATH-001", "SUBJ-001"),
        pc("GRAN-001", "FATH-001"),
      ],
    );
    expect(droppedPids(built)).toEqual(["SUBJ-001>GRAN-001"]);
  });

  it("drops a person recorded as their own parent", async () => {
    const built = await build("SUBJ-001", [person("SUBJ-001", "Subject")], [pc("SUBJ-001", "SUBJ-001")]);
    expect(built.droppedLoopEdges).toMatchObject([{ cycleLength: 1 }]);
    expect(edges(built)).toEqual([]);
  });

  it("leaves pedigree collapse alone: one ancestor reached by two lines is not a loop", async () => {
    // The subject's parents are first cousins: both descend from G.
    const rels = [
      pc("FATH-001", "SUBJ-001"),
      pc("MOTH-001", "SUBJ-001"),
      couple("FATH-001", "MOTH-001"),
      pc("GPAF-001", "FATH-001"),
      pc("GPAM-001", "MOTH-001"),
      pc("GRAN-001", "GPAF-001"),
      pc("GRAN-001", "GPAM-001"),
    ];
    const ids = ["SUBJ-001", "FATH-001", "MOTH-001", "GPAF-001", "GPAM-001", "GRAN-001"];
    const built = await build("SUBJ-001", ids.map((id) => person(id, id)), rels);
    expect(built.droppedLoopEdges).toEqual([]);
    expect(built.tree.relationships).toHaveLength(rels.length);
  });

  it("reports nothing for a read with no loop", async () => {
    const built = await build("MGDD-CB5", [SALVADOR, PETRONA, CATARINA], salvadorRels.slice(0, 3));
    expect(built.droppedLoopEdges).toEqual([]);
    expect(built.tree.relationships).toHaveLength(3);
  });
});
