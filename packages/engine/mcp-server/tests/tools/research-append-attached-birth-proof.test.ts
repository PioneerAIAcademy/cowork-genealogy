import { describe, it, expect, vi, beforeEach } from "vitest";

// Offline: the place lookups answer only what a test lists, and count calls.
const PLACES = vi.hoisted(() => ({
  coords: new Map<string, { latitude: number; longitude: number; type: string }>(),
  ids: new Map<string, string>(),
  reps: new Map<string, string[]>(),
  calls: [] as string[],
  coordCalls: [] as string[],
  refuse: false,
}));
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/utils/place-resolver.js")>()),
  standardPlaceToCoords: vi.fn(async (name: string) => {
    PLACES.calls.push(name);
    PLACES.coordCalls.push(name);
    if (PLACES.refuse) throw markFsRefusal(new Error("FamilySearch budget spent"));
    return PLACES.coords.get(name) ?? null;
  }),
  standardPlaceToPlaceId: vi.fn(async (name: string) => {
    PLACES.calls.push(name);
    return PLACES.ids.get(name) ?? null;
  }),
}));
vi.mock("../../src/utils/place-api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/utils/place-api.js")>()),
  getPlaceReps: vi.fn(async (pid: string) =>
    (PLACES.reps.get(pid) ?? []).map((fullName, i) => ({ placeRepId: `${pid}-${i}`, fullName, names: [fullName] })),
  ),
}));
import { readFileSync } from "fs";
import { join } from "path";
import { cp, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { attachedBirthProofInvariants, researchAppend } from "../../src/tools/research-append.js";
import { projectContext } from "../../src/tools/project-context.js";
import { LOCAL } from "../../src/auth/principal.js";
import { attachedBirthPairsByQuestion } from "../../src/utils/attached-births.js";
import { markFsRefusal } from "../../src/utils/fs-budget.js";
import { ATTACHMENT_LINK_RATIONALE } from "../../src/utils/tree-person.js";

// #4444: a proof may not stand over a family whose own FamilySearch-attached
// records put one person's birth in two places that cannot both be theirs,
// until an identity conflict has weighed which record is that person's.

const MESSAGE = "attached births that cannot both be theirs";
const FATHER = "F1";
const CHILD = "P1";

beforeEach(() => {
  PLACES.coords.clear();
  PLACES.ids.clear();
  PLACES.reps.clear();
  PLACES.calls.length = 0;
  PLACES.coordCalls.length = 0;
  PLACES.refuse = false;
});

function birth(id: string, record: string, place: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    source_id: "src_1",
    record_id: record,
    record_role: "principal",
    record_persona_id: `${record}-principal`,
    fact_type: "birth",
    value: place,
    place,
    information_quality: "primary",
    informant: "self",
    informant_proximity: "participant",
    record_basis: "stated",
    extracted_for_question_ids: [],
    ...extra,
  };
}

function attachment(id: string, assertionId: string, person = CHILD, extra: Record<string, unknown> = {}) {
  return {
    id,
    assertion_id: assertionId,
    person_id: person,
    confidence: "speculative",
    rationale: ATTACHMENT_LINK_RATIONALE,
    match_score: null,
    created: "2026-11-01",
    superseded_by: null,
    ...extra,
  };
}

const CENSUS = birth("a_001", "ark:/61903/1:1:CENS-001", "New York, United States", {
  information_quality: "indeterminate",
  informant_proximity: "household_member",
});
const BAPTISM = birth("a_002", "ark:/61903/1:1:BAPT-002", "Ardfinnan, Tipperary, Ireland");
const MARRIAGE = {
  ...birth("a_010", "ark:/61903/1:1:MARR-010", "Ballylooby, Tipperary, Ireland"),
  fact_type: "marriage",
  record_role: "groom",
  extracted_for_question_ids: ["q_001"],
};

function family(opts: { subjects?: string[]; edges?: boolean; conflicts?: any[]; rejected?: any[]; links?: any[]; assertions?: any[] } = {}) {
  const research: any = {
    project: { subject_person_ids: opts.subjects ?? [FATHER] },
    questions: [{ id: "q_001", question: "When did F1 marry?", status: "open" }],
    assertions: opts.assertions ?? [CENSUS, BAPTISM, MARRIAGE],
    person_evidence: opts.links ?? [attachment("pe_001", "a_001"), attachment("pe_002", "a_002")],
    rejected_links: opts.rejected ?? [],
    conflicts: opts.conflicts ?? [],
    hypotheses: [],
  };
  const tree = {
    persons: [
      { id: FATHER, facts: [{ id: "F1b", type: "Birth", date: "1840", place: "Ireland" }] },
      { id: CHILD, facts: [{ id: "F2b", type: "Birth", date: "28 Nov 1872", place: "Ardfinnan, Tipperary, Ireland" }] },
    ],
    relationships: opts.edges === false ? [] : [{ id: "R1", type: "ParentChild", parent: FATHER, child: CHILD }],
  };
  return { research, tree };
}

const proof = (extra: Record<string, unknown> = {}) => ({
  id: "ps_001",
  question_id: "q_001",
  tier: "possible",
  shortfall: "gap",
  supporting_assertion_ids: ["a_010"],
  ...extra,
});

const identity = (ids: string[], extra: Record<string, unknown> = {}) => ({
  id: "c_001",
  conflict_type: "identity",
  identity_question: "Which of these births is P1's?",
  competing_assertion_ids: ids,
  status: "unresolved",
  preferred_assertion_id: null,
  independence_analysis: "Different creators and informants.",
  weighing_analysis: "The census places the boy with the family in New York; the baptism is another boy.",
  resolution_rationale: null,
  blocks_question_ids: ["q_001"],
  ...extra,
});

describe("a proof over a family's self-contradicting attached births (#4444)", () => {
  it("refuses a proof whose subject's child carries two attached births that cannot both be theirs", () => {
    const { research, tree } = family();
    const r = attachedBirthProofInvariants(proof(), research, tree);
    expect(r).toHaveLength(1);
    expect(r[0]).toContain(MESSAGE);
    expect(r[0]).toContain(CHILD);
    expect(r[0]).toContain("a_001");
    expect(r[0]).toContain("a_002");
    expect(r[0]).toContain("conflict-resolution");
  });

  it("refuses at not_proved too, and on an affirmed claim above the scalar", () => {
    const { research, tree } = family();
    expect(attachedBirthProofInvariants(proof({ tier: "not_proved" }), research, tree)).toHaveLength(1);
    const claims = [{ claim: "married 1868", proof_tier: "probable", supporting_assertion_ids: ["a_010"] }];
    expect(attachedBirthProofInvariants(proof({ tier: "not_proved", claims }), research, tree)).toHaveLength(1);
  });

  it("is silent at disproved", () => {
    const { research, tree } = family();
    expect(attachedBirthProofInvariants(proof({ tier: "disproved", shortfall: "none" }), research, tree)).toEqual([]);
  });

  it("is answered by an analysed identity conflict naming either record, at any status", () => {
    for (const c of [
      identity(["a_002"]),
      identity(["a_001"]),
      identity(["a_001", "a_002"], {
        status: "resolved",
        preferred_assertion_id: "a_001",
        resolution_kind: "competitor",
        resolution_rationale: "The census is P1's; the baptism is another boy.",
      }),
    ]) {
      const { research, tree } = family({ conflicts: [c] });
      expect(attachedBirthProofInvariants(proof(), research, tree)).toEqual([]);
    }
  });

  it("is answered by an analysed fact conflict naming both records", () => {
    const fact = { ...identity(["a_001", "a_002"]), conflict_type: "fact", disputed_attribute: "birthplace", identity_question: null };
    const { research, tree } = family({ conflicts: [fact] });
    expect(attachedBirthProofInvariants(proof(), research, tree)).toEqual([]);
  });

  it("is not answered by an unanalysed conflict, a moot one with only a rationale, a fact conflict on one record, or another record", () => {
    for (const c of [
      identity(["a_001", "a_002"], { independence_analysis: null }),
      identity(["a_001", "a_002"], { independence_analysis: "   " }),
      identity(["a_001", "a_002"], { status: "moot", independence_analysis: null, weighing_analysis: null, resolution_rationale: "Does not bear on the marriage." }),
      { ...identity(["a_001", "a_003"]), conflict_type: "fact", disputed_attribute: "birthplace", identity_question: null },
      identity(["a_003"]),
    ]) {
      const { research, tree } = family({ conflicts: [c] });
      expect(attachedBirthProofInvariants(proof(), research, tree)).toHaveLength(1);
    }
  });

  it("tells the agent to open the identity conflict when none names the pair", () => {
    const { research, tree } = family();
    const r = attachedBirthProofInvariants(proof(), research, tree);
    expect(r[0]).toContain("open a conflict_type 'identity' conflict");
    expect(r[0]).not.toContain("weigh c_");
  });

  it("names the registered conflict to weigh when one names the pair but has no analysis", () => {
    const { research, tree } = family({ conflicts: [identity(["a_002"], { independence_analysis: null, weighing_analysis: null })] });
    const r = attachedBirthProofInvariants(proof(), research, tree);
    expect(r).toHaveLength(1);
    expect(r[0]).toContain("weigh c_001");
    expect(r[0]).not.toContain("open a conflict_type 'identity' conflict");
  });

  it("is silent for a person outside the proof's family", () => {
    const { research, tree } = family({ edges: false });
    expect(attachedBirthProofInvariants(proof(), research, tree)).toEqual([]);
  });

  it("reaches the person through a link to the question's own assertion when no subject is set", () => {
    const { research, tree } = family({
      subjects: [],
      edges: false,
      links: [attachment("pe_001", "a_001"), attachment("pe_002", "a_002"), { ...attachment("pe_010", "a_010", FATHER), confidence: "probable", rationale: "Groom." }],
    });
    tree.relationships.push({ id: "R1", type: "ParentChild", parent: FATHER, child: CHILD });
    expect(attachedBirthProofInvariants(proof(), research, tree)).toHaveLength(1);
  });

  it("is silent once the researcher rejects one of the attachments", () => {
    const { research, tree } = family({
      links: [attachment("pe_001", "a_001"), attachment("pe_002", "a_002", CHILD, { superseded_by: "rj_001" })],
      rejected: [{ id: "rj_001", assertion_id: "a_002", person_id: CHILD, researcher_words: "Another John.", created: "2026-11-03" }],
    });
    expect(attachedBirthProofInvariants(proof(), research, tree)).toEqual([]);
  });

  it("reads a historical jurisdiction as the same place under its other names", () => {
    const upper = birth("a_001", "ark:/61903/1:1:CENS-001", "Upper Canada, British North America", {
      standard_place: "Upper Canada, British North America",
    });
    const ontario = birth("a_002", "ark:/61903/1:1:BAPT-002", "Ont", { standard_place: "Ontario, Canada" });
    const { research, tree } = family({ assertions: [upper, ontario, MARRIAGE] });
    const place = { latitude: 44.1, longitude: -79.9, type: "Province" };
    const names = ["Ontario, Canada", "Canada West, British North America", "Upper Canada, British North America"];
    const coords = new Map([
      ["Upper Canada, British North America", { ...place, aliases: names }],
      ["Ontario, Canada", { ...place, aliases: names }],
    ]);
    expect(attachedBirthProofInvariants(proof(), research, tree, coords as any)).toEqual([]);
    expect(attachedBirthProofInvariants(proof(), research, tree)).toHaveLength(1);
  });
});

const RUN_1117 = join(__dirname, "../../../../../eval/runlogs/e2e/thomas-hanrahan-marriage/run-2026-11-17_12-41-35");
const RUN_1412 = join(__dirname, "../../../../../eval/runlogs/e2e/thomas-hanrahan-marriage/run-2026-11-18_14-12-58");
const RUN_1109 = join(__dirname, "../../../../../eval/runlogs/e2e/thomas-hanrahan-marriage/run-2026-11-09_12-14-54");

async function runDir(base: string, edit?: (research: any) => void): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "attached-proof-"));
  const research = JSON.parse(readFileSync(`${base}.final-research.json`, "utf-8"));
  edit?.(research);
  await writeFile(join(dir, "research.json"), JSON.stringify(research));
  await cp(`${base}.final-tree.gedcomx.json`, join(dir, "tree.gedcomx.json"));
  return dir;
}

const errorsOf = (r: any): string => ((r.errors ?? []) as string[]).join(" ");

/** Conflict-resolution's identity answer for one person's two attached births. */
const settled = (ids: [string, string], keep: string) => ({
  conflict_type: "identity",
  identity_question: `Which of these two births belongs to the tree person: ${ids[0]} or ${ids[1]}?`,
  description: "Two attached births too far apart to be one birth.",
  competing_assertion_ids: ids,
  status: "resolved",
  preferred_assertion_id: keep,
  resolution_kind: "competitor",
  independence_analysis: "Different creators and informants.",
  weighing_analysis: "The New York census places the child with the Saratoga family; the Irish baptism is another child.",
  resolution_rationale: "The census birth is the tree person's.",
  blocks_question_ids: ["q_001"],
});

describe("research_append on thomas-hanrahan-marriage's own documents (#4444)", () => {
  for (const [label, base] of [["2026-11-17", RUN_1117], ["2026-11-09", RUN_1109]] as const) {
    it(`refuses ps_001 standing on run ${label}, naming John and Mary`, async () => {
      const dir = await runDir(base);
      try {
        const r: any = await researchAppend({
          projectPath: dir, section: "proof_summaries", op: "update", entryId: "ps_001",
          fields: { exhaustive_search_summary: "Unchanged in substance." },
        } as any);
        expect(r.ok).toBe(false);
        expect(errorsOf(r)).toContain(MESSAGE);
        expect(errorsOf(r)).toContain("M8R7-2TR");
        expect(errorsOf(r)).toContain("93RB-RTD");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  it("accepts identity conflicts resolved toward the census, and then the proof (run 2026-11-17)", async () => {
    const dir = await runDir(RUN_1117);
    try {
      const c: any = await researchAppend({
        projectPath: dir,
        ops: [
          { section: "conflicts", op: "append", entry: settled(["a_052", "a_074"], "a_052") },
          { section: "conflicts", op: "append", entry: settled(["a_026", "a_064"], "a_026") },
        ],
      } as any);
      expect(errorsOf(c)).toBe("");
      expect(c.ok).toBe(true);
      const r: any = await researchAppend({
        projectPath: dir, section: "proof_summaries", op: "update", entryId: "ps_001",
        fields: { tier: "not_proved", shortfall: "gap" },
      } as any);
      expect(errorsOf(r)).not.toContain(MESSAGE);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not let a batch open the identity conflict and spend it on the proof", async () => {
    const dir = await runDir(RUN_1117);
    try {
      const r: any = await researchAppend({
        projectPath: dir,
        ops: [
          { section: "conflicts", op: "append", entry: settled(["a_052", "a_074"], "a_052") },
          { section: "conflicts", op: "append", entry: settled(["a_026", "a_064"], "a_026") },
          { section: "proof_summaries", op: "update", entryId: "ps_001", fields: { tier: "not_proved", shortfall: "gap" } },
        ],
      } as any);
      expect(errorsOf(r)).toContain(MESSAGE);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // With FamilySearch (here, by fiat) keeping John's two birthplaces as one
  // place, the prefetch for the proof op reads that and the gate lets it pass.
  it("reads the other names it looks up for the proof's pairs", async () => {
    const dir = await runDir(RUN_1117);
    const ny = "New York, United States";
    const ardfinnan = "Ardfinnan, County Tipperary, Ireland";
    try {
      PLACES.coords.set(ny, { latitude: 43, longitude: -75, type: "State" });
      PLACES.coords.set(ardfinnan, { latitude: 52.33, longitude: -7.88, type: "Village" });
      PLACES.ids.set(ny, "P_ONE").set(ardfinnan, "P_ONE");
      PLACES.reps.set("P_ONE", [ny, ardfinnan]);
      const r: any = await researchAppend({
        projectPath: dir, section: "proof_summaries", op: "update", entryId: "ps_001",
        fields: { exhaustive_search_summary: "Unchanged in substance." },
      } as any);
      expect(PLACES.calls).toContain(ardfinnan);
      expect(errorsOf(r)).not.toContain("M8R7-2TR's attached births");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("looks up no place for a proof whose family's attached births agree", async () => {
    const { research, tree } = family({ assertions: [CENSUS, { ...BAPTISM, place: "Saratoga, New York, United States", value: "Saratoga, New York, United States" }, MARRIAGE] });
    research.project = { id: "rp_1", objective: "x", status: "active", created: "2026-01-01", updated: "2026-01-01", subject_person_ids: [FATHER] };
    const dir = await mkdtemp(join(tmpdir(), "attached-proof-"));
    try {
      await writeFile(join(dir, "research.json"), JSON.stringify(research));
      await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree));
      await researchAppend({ projectPath: dir, section: "proof_summaries", op: "append", entry: proof() } as any);
      expect(PLACES.calls).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("project_context routes the identity question before a proof (#4444)", () => {
  const withoutProof = (research: any) => {
    research.proof_summaries = [];
    research.evaluations = [];
    for (const q of research.questions) q.status = "in_progress";
  };

  it("names conflict-resolution and both of John's attached births on run 2026-11-17", async () => {
    const dir = await runDir(RUN_1117, withoutProof);
    try {
      const r: any = await projectContext({ projectPath: dir }, LOCAL);
      const step = r.questionStatuses.find((s: any) => s.id === "q_001").nextStep as string;
      expect(step).toMatch(/^conflict-resolution — identity/);
      expect(step).toContain("M8R7-2TR");
      expect(step).toContain("a_052");
      expect(step).toContain("a_074");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("names the registered, unweighed c_002 instead of asking for a new conflict (run 2026-11-18 14:12)", async () => {
    const dir = await runDir(RUN_1412);
    try {
      const r: any = await projectContext({ projectPath: dir }, LOCAL);
      const step = r.questionStatuses.find((s: any) => s.id === "q_001").nextStep as string;
      expect(step).toMatch(/^conflict-resolution — identity/);
      expect(step).toContain("M8R7-2TR");
      expect(step).toContain("weigh c_002");
      expect(step).not.toContain("open a conflict_type 'identity' conflict");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("moves on once an analysed identity conflict names one record of each pair", async () => {
    const dir = await runDir(RUN_1117, (research) => {
      withoutProof(research);
      research.conflicts = [
        { id: "c_001", ...settled(["a_074", "a_074"], "a_074"), competing_assertion_ids: ["a_074"], status: "unresolved", preferred_assertion_id: null, resolution_kind: null, resolution_rationale: null },
        { id: "c_002", ...settled(["a_064", "a_064"], "a_064"), competing_assertion_ids: ["a_064"], status: "unresolved", preferred_assertion_id: null, resolution_kind: null, resolution_rationale: null },
      ];
    });
    try {
      const r: any = await projectContext({ projectPath: dir }, LOCAL);
      const step = r.questionStatuses.find((s: any) => s.id === "q_001").nextStep as string | null;
      expect(step ?? "").not.toMatch(/^conflict-resolution — identity/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("still routes a resolved question whose proof stands over the pairs", async () => {
    const dir = await runDir(RUN_1117);
    try {
      const r: any = await projectContext({ projectPath: dir }, LOCAL);
      const step = r.questionStatuses.find((s: any) => s.id === "q_001")?.nextStep ?? "";
      expect(step).toMatch(/^conflict-resolution — identity/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Above the ladder's every proof-conclusion rung: run 2026-11-09's c_001, left
  // open and analysed with nothing to search (the conflict rule refuses resolving
  // it), would otherwise send proof-conclusion back to the refusal for ever.
  it("outranks an unsettled conflict that has weighed every log entry (run 2026-11-09)", async () => {
    const dir = await runDir(RUN_1109, (research) => {
      withoutProof(research);
      const c = research.conflicts.find((x: any) => x.id === "c_001");
      Object.assign(c, {
        status: "unresolved",
        preferred_assertion_id: null,
        resolution_rationale: null,
        weighed_log_entry_ids: research.log.map((e: any) => e.id),
      });
    });
    try {
      const r: any = await projectContext({ projectPath: dir }, LOCAL);
      const step = r.questionStatuses.find((s: any) => s.id === "q_001").nextStep as string;
      expect(step).toMatch(/^conflict-resolution — identity/);
      expect(step).toContain("93RB-RTD");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("attachedBirthPairsByQuestion: the identity rung's pairs (#4444)", () => {
  it("names a pair whose births carry no standard place, as the gate refuses on it", async () => {
    const { research, tree } = family();
    expect(attachedBirthProofInvariants(proof(), research, tree)).toHaveLength(1);
    const pairs = await attachedBirthPairsByQuestion(research, tree);
    expect(pairs.get("q_001")?.map((p) => [p.personId, p.a.id, p.b.id])).toEqual([[CHILD, "a_001", "a_002"]]);
  });

  it("falls back to reading the pair with no place data when FamilySearch refuses the lookup", async () => {
    const census = { ...CENSUS, standard_place: "Cork, Ireland", place: "Cork, Ireland", value: "Cork, Ireland" };
    const baptism = { ...BAPTISM, standard_place: "Dublin, Ireland", place: "Dublin, Ireland", value: "Dublin, Ireland" };
    const { research, tree } = family({ assertions: [census, baptism, MARRIAGE] });
    PLACES.refuse = true;
    const pairs = await attachedBirthPairsByQuestion(research, tree);
    expect(pairs.get("q_001")?.map((p) => p.personId)).toEqual([CHILD]);
  });

  it("reads coordinates only for a pair in one country; other names for every pair", async () => {
    const census = { ...CENSUS, standard_place: "New York, United States" };
    const baptism = { ...BAPTISM, standard_place: "Ardfinnan, County Tipperary, Ireland" };
    const { research, tree } = family({ assertions: [census, baptism, MARRIAGE] });
    await attachedBirthPairsByQuestion(research, tree);
    expect(PLACES.coordCalls).toEqual([]);
    expect(PLACES.calls).toContain("Ardfinnan, County Tipperary, Ireland");
  });
});

describe("research_append looks up no place for a proof the gate does not judge (#4444)", () => {
  it("is silent on a disproved summary, and spends no lookup on it", async () => {
    const dir = await runDir(RUN_1117);
    try {
      const r: any = await researchAppend({
        projectPath: dir, section: "proof_summaries", op: "update", entryId: "ps_001",
        fields: { tier: "disproved", shortfall: "none" },
      } as any);
      expect(errorsOf(r)).not.toContain(MESSAGE);
      expect(PLACES.calls).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
