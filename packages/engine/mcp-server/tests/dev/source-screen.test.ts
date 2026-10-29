/**
 * dev/source-screen.ts (issue #3408, steps 1-2). Every network stage runs over
 * a fake `Tools`, except the error-classification test, which runs the real
 * tool functions over a stubbed `fetch` so the messages are the ones the tools
 * actually throw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cpSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../../src/auth/tokenManager.js", async (orig) => ({
  ...(await orig<typeof import("../../src/auth/tokenManager.js")>()),
  loadTokens: vi.fn(),
  isExpired: vi.fn(() => false),
}));
vi.mock("../../src/utils/place-resolver.js", async (orig) => ({
  ...(await orig<typeof import("../../src/utils/place-resolver.js")>()),
  resolveStandardPlace: vi.fn().mockResolvedValue(null),
  repIdToStandardPlace: vi.fn().mockResolvedValue(null),
}));

import { loadTokens } from "../../src/auth/tokenManager.js";
import {
  addHostAttachment,
  applyIndexingPlant,
  applyWrongPersonPlant,
  buildAuditList,
  classifyError,
  guardPath,
  liveTools,
  loadSpec,
  main,
  readFindings,
  readJson,
  readRecord,
  relationshipNoteCount,
  REPO_ROOT,
  runBaseline,
  runPlant,
  runRefreshAttachments,
  runTreeSources,
  classifyArk,
  runSnapshot,
  scoreFindings,
  selectSubjectPersona,
  SPEC_PATH,
  unplantedKey,
  writeJson,
  type FindingRow,
  type FixtureSpec,
  type Tools,
} from "../../dev/source-screen.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const tmp: string[] = [];
const mkTmp = () => {
  const d = mkdtempSync(join(tmpdir(), "source-screen-"));
  tmp.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

// ─── a fake FamilySearch ────────────────────────────────────────────────────

const ark = (id: string) => `ark:/61903/1:1:${id}`;
const url = (id: string) => `https://www.familysearch.org/ark:/61903/1:1:${id}`;

function person(id: string, opts: { living?: boolean; personas?: string[]; relSources?: string[]; relativeSources?: string[]; notes?: string[] } = {}): Json {
  const sources = [
    ...(opts.personas ?? []).map((p) => ({ id: `s_${p}`, title: `Record ${p}`, url: url(p) })),
    ...(opts.relSources ?? []).map((p) => ({ id: `r_${p}`, title: `Edge ${p}`, url: url(p) })),
    ...(opts.relativeSources ?? []).map((p) => ({ id: `k_${p}`, title: `Kin ${p}`, url: url(p) })),
  ];
  return {
    persons: [
      { id, gender: "Male", living: opts.living ?? false, names: [{ given: "John", surname: "Smith" }], sources: (opts.personas ?? []).map((p) => ({ ref: `s_${p}` })) },
      { id: "KIN1-111", gender: "Female", living: false, names: [{ given: "Mary", surname: "Smith" }], sources: (opts.relativeSources ?? []).map((p) => ({ ref: `k_${p}` })) },
    ],
    relationships: [{ type: "ParentChild", parent: "KIN1-111", child: id, sources: (opts.relSources ?? []).map((p) => ({ ref: `r_${p}` })) }],
    sources,
    ...(opts.notes ? { notes: opts.notes } : {}),
  };
}

function record(personaId: string, given = "John", surname = "Smith"): Json {
  return {
    persons: [
      { id: "p_1", ark: ark(personaId), names: [{ given, surname }], facts: [{ type: "http://gedcomx.org/Birth", date: "1850", place: "Ohio" }] },
      { id: "p_2", ark: ark(`${personaId.slice(0, 4)}-ZZZ`), names: [{ given: "Other", surname: "Person" }], facts: [] },
    ],
    sources: [
      { id: "src_r", resource_type: "Record", citation: `Citation for ${personaId}` },
      { id: "src_c", resource_type: "Collection", title: "Ohio, Births, 1800-1900" },
    ],
  };
}

interface World {
  persons: Record<string, Json>;
  records: Record<string, Json>;
  attach: Record<string, { personId: string; tags: string[] }[]>;
  quality?: Record<string, Json>;
  scores?: Record<string, number>;
  fail?: (tool: string, key: string) => string | undefined;
  trees?: Record<string, Json>;
  calls: string[];
}

function fakeTools(w: World): Tools {
  const go = <T>(tool: string, key: string, fn: () => T): Promise<T> => {
    w.calls.push(`${tool}:${key}`);
    const msg = w.fail?.(tool, key);
    return msg ? Promise.reject(new Error(msg)) : Promise.resolve(fn());
  };
  return {
    personRead: (pid) =>
      go("person_read", pid, () => {
        const p = w.persons[pid];
        if (!p) throw new Error(`Person ${pid} not found in the FamilySearch Family Tree.`);
        return structuredClone(p);
      }),
    recordRead: (a) =>
      go("record_read", a, () => {
        const r = w.records[a];
        if (!r) throw new Error(`Record ${a} was not found in FamilySearch historical records.`);
        return structuredClone(r);
      }),
    sourceAttachments: (uris) =>
      go("source_attachments", uris.join(","), () => ({
        attachments: Object.fromEntries(uris.filter((u) => w.attach[u]).map((u) => [u, w.attach[u]])),
        unattached: uris.filter((u) => !w.attach[u]),
      })),
    personQuality: (pid) => go("person_quality", pid, () => w.quality?.[pid] ?? { personId: pid, detail: { facts: [], conflicts: [] } }),
    personWarnings: (_dir, pid) => go("person_warnings", pid, () => ({ warningCount: 0, warnings: [] })),
    samePerson: (input) =>
      go("same_person", input.primaryId1, () => {
        const persona = input.gedcomx2.persons.find((p: Json) => p.id === input.primaryId2);
        return { matched: true, score: w.scores?.[persona.ark] ?? 0.9 };
      }),
    compiledTreeRead: (a) =>
      go("compiled_tree_read", a, () => {
        const t = w.trees?.[a];
        if (!t) throw new Error(`Compiled tree entry ${a} was not found (404).`);
        return structuredClone(t);
      }),
  };
}

const world = (over: Partial<World> = {}): World => ({ persons: {}, records: {}, attach: {}, calls: [], ...over });

function pidsFile(dir: string, pids: string[]): string[] {
  writeFileSync(join(dir, "pids.txt"), pids.join("\n"), "utf8");
  return pids;
}

const snap = (out: string, pids: string[], w: World, samePerson = true) =>
  runSnapshot({ pids, out, sample: null, seed: 1, samePerson, tools: fakeTools(w) });

// ─── audit list ─────────────────────────────────────────────────────────────

describe("audit list", () => {
  it("audit list takes subject and relationship sources, not relatives', and records level and class", () => {
    const read = person("AAAA-111", { personas: ["P1"], relSources: ["E1"], relativeSources: ["K1"] });
    read.sources.push({ id: "s_rec", title: "Record level", url: "https://www.familysearch.org/ark:/61903/1:2:RRRR" });
    read.sources.push({ id: "s_book", title: "A book" });
    read.sources.push({ id: "s_mem", title: "A memory", url: "https://www.familysearch.org/photos/artifacts/1", artifact_url: "https://x/1" });
    read.persons[0].sources.push({ ref: "s_rec" }, { ref: "s_book" });
    read.sources.push({ id: "c_K2", title: "Kin marriage", url: url("K2") });
    read.relationships.push({ type: "Couple", person1: "KIN1-111", person2: "KIN2-111", sources: [{ ref: "c_K2" }] });
    const audit = buildAuditList(read);
    const by = Object.fromEntries(audit.entries.map((e) => [e.source_ids[0], [e.level, e.class]]));
    expect(by).toEqual({
      s_P1: ["subject", "persona"],
      s_rec: ["subject", "record_only"],
      s_book: ["subject", "no_index"],
      r_E1: ["relationship", "persona"],
      s_mem: ["subject", "no_index"],
    });
    expect(audit.entries.some((e) => e.source_ids.includes("k_K1") || e.source_ids.includes("c_K2"))).toBe(false);
  });

  it("a source cited by the subject and a relationship is level subject", () => {
    const read = person("AAAA-111", { personas: ["P1"], relSources: ["P1"] });
    const audit = buildAuditList(read);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({ ark: ark("P1"), level: "subject" });
    expect(audit.entries[0].source_ids.sort()).toEqual(["r_P1", "s_P1"]);
  });

  it("counts a living subject", async () => {
    const out = mkTmp();
    const w = world({ persons: { "LIVE-111": person("LIVE-111", { living: true, personas: ["P1"] }) } });
    const ledger = await snap(out, ["LIVE-111"], w);
    expect(ledger.living).toBe(1);
    expect(readJson(join(out, "persons", "LIVE-111", "meta.json")).living).toBe(true);
    expect(w.calls).toEqual(["person_read:LIVE-111"]);
  });
});

// ─── paths ──────────────────────────────────────────────────────────────────

describe("path guard", () => {
  it("refuses --pids, --out, --snapshot and --findings inside the repo, accepts them outside, and accepts the committed --spec", () => {
    const outside = mkTmp();
    for (const flag of ["--pids", "--out", "--snapshot", "--findings"]) {
      expect(() => guardPath(flag, join(REPO_ROOT, "eval", "x.txt"))).toThrow(/inside the repo/);
      expect(() => guardPath(flag, join(REPO_ROOT, "not-yet", "deep", "x"))).toThrow(/inside the repo/);
      expect(guardPath(flag, join(outside, "x.txt"))).toBe(join(outside, "x.txt"));
    }
    expect(guardPath("--spec", SPEC_PATH)).toBe(SPEC_PATH);
    expect(() => guardPath("--spec", join(REPO_ROOT, "eval", "other.json"))).toThrow(/committed spec/);
    expect(guardPath("--spec", join(outside, "spec.json"))).toBe(join(outside, "spec.json"));
    expect(() => guardPath("--out", join(REPO_ROOT, "..data", "x"))).toThrow(/inside the repo/);
    expect(guardPath("--out", join(REPO_ROOT, "..", "sibling-of-repo"))).toBe(join(REPO_ROOT, "..", "sibling-of-repo"));
  });

  it("refuses a no-op run: --sample 0, an unknown --no- flag, and a resume with another PID file", async () => {
    const out = mkTmp();
    writeFileSync(join(out, "p.txt"), "AAAA-111\nBBBB-111\n", "utf8");
    const tools = fakeTools(world({ persons: { "AAAA-111": person("AAAA-111"), "BBBB-111": person("BBBB-111") } }));
    await expect(main(["snapshot", "--pids", join(out, "p.txt"), "--out", join(out, "s"), "--sample", "0"], tools)).rejects.toThrow(/positive integer/);
    await expect(main(["snapshot", "--pids", join(out, "p.txt"), "--out", join(out, "s"), "--no-same-persons"], tools)).rejects.toThrow(/does not take --no-same-persons/);
    await expect(main(["baseline", "--snapshot", join(out, "s"), "--no-same-person"], tools)).rejects.toThrow(/does not take/);
    await main(["snapshot", "--pids", join(out, "p.txt"), "--out", join(out, "s")], tools);
    writeFileSync(join(out, "p.txt"), "AAAA-111\n", "utf8");
    await expect(main(["snapshot", "--pids", join(out, "p.txt"), "--out", join(out, "s")], tools)).rejects.toThrow(/drawn from 2 PIDs/);
  });
});

// ─── errors, from the real tools ────────────────────────────────────────────

describe("error classes", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    vi.mocked(loadTokens).mockResolvedValue({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 3_600_000 } as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const messageOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error("expected the tool to throw");
  };
  const tools = liveTools();

  it("classifies the exact messages the tools throw", async () => {
    const cases: [string, () => void, () => Promise<unknown>, string][] = [
      ["429 + Retry-After", () => fetchMock.mockResolvedValue(res(429, {}, { "retry-after": "120" })), () => tools.recordRead(ark("QQQQ-111")), "stop"],
      ["429", () => fetchMock.mockImplementation(async () => res(429)), () => tools.recordRead(ark("QQQQ-112")), "stop"],
      ["503", () => fetchMock.mockImplementation(async () => res(503, "down")), () => tools.recordRead(ark("QQQQ-113")), "transient"],
      ["fetch failed", () => fetchMock.mockRejectedValue(new TypeError("fetch failed")), () => tools.recordRead(ark("QQQQ-114")), "transient"],
      ["timeout", () => fetchMock.mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" })), () => tools.recordRead(ark("QQQQ-115")), "transient"],
      ["no token", () => vi.mocked(loadTokens).mockResolvedValue(null), () => tools.recordRead(ark("QQQQ-116")), "stop"],
      ["404 record", () => fetchMock.mockResolvedValue(res(404)), () => tools.recordRead(ark("QQQQ-117")), "permanent"],
      ["410 record", () => fetchMock.mockResolvedValue(res(410)), () => tools.recordRead(ark("QQQQ-118")), "permanent"],
      ["deleted person", () => fetchMock.mockResolvedValue(res(410)), () => tools.personRead("KWCB-QZ3"), "permanent"],
      ["tombstoned quality", () => fetchMock.mockResolvedValue(res(200, { isValid: true, visibility: "TOMBSTONED" })), () => tools.personQuality("KWCB-QZ4"), "permanent"],
      ["404 compiled tree", () => fetchMock.mockResolvedValue(res(404)), () => tools.compiledTreeRead("ark:/61903/2:2:TEST-2A3"), "permanent"],
    ];
    const got: Record<string, string> = {};
    const want: Record<string, string> = {};
    for (const [name, arrange, act, expected] of cases) {
      fetchMock.mockReset();
      vi.mocked(loadTokens).mockResolvedValue({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 3_600_000 } as never);
      arrange();
      const msg = await messageOf(act()).catch((e) => `NO THROW in ${name}: ${e.message}`);
      got[name] = `${classifyError(msg)} <- ${msg}`;
      want[name] = expected;
    }
    expect(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.split(" <- ")[0]])), JSON.stringify(got, null, 2)).toEqual(want);
    expect(classifyError("something nobody has seen before")).toBe("transient");
    expect(classifyError("FamilySearch recapi error: 500")).toBe("transient");
    expect(classifyError("Record 4X7Q-429 was not found in FamilySearch historical records.")).toBe("permanent");
    expect(classifyError("Person KWCB-429 not found in the FamilySearch Family Tree.")).toBe("permanent");
  }, 30_000);

  it("stops the run on a 429 from every one of the six tools", async () => {
    fetchMock.mockImplementation(async () => res(429));
    const gx = { persons: [{ id: "p1", names: [{ given: "A", surname: "B" }] }] };
    const calls: [string, () => Promise<unknown>][] = [
      ["person_read", () => tools.personRead("KWCB-QZ3")],
      ["record_read", () => tools.recordRead(ark("QQQQ-120"))],
      ["source_attachments", () => tools.sourceAttachments([ark("QQQQ-121")])],
      ["person_quality", () => tools.personQuality("KWCB-QZ5")],
      ["same_person", () => tools.samePerson({ gedcomx1: gx, primaryId1: "p1", gedcomx2: gx, primaryId2: "p1" })],
      ["compiled_tree_read", () => tools.compiledTreeRead("ark:/61903/2:2:TEST-2A2")],
    ];
    const got: Record<string, string> = {};
    for (const [name, act] of calls) {
      const msg = await messageOf(act());
      got[name] = `${classifyError(msg)} <- ${msg}`;
    }
    expect(Object.values(got).map((v) => v.split(" <- ")[0]), JSON.stringify(got, null, 2)).toEqual(Array(6).fill("stop"));
  }, 60_000);

  it("counts only the relationship note as a partial read", () => {
    expect(relationshipNoteCount(["2 of 5 source descriptions cited by relationships could not be read, so those sources are missing from this response's relationships."])).toBe(2);
    expect(relationshipNoteCount(["3 of 7 relatives' attached sources could not be read, so their sources are missing from this response."])).toBeNull();
    expect(relationshipNoteCount(undefined)).toBeNull();
  });
});

// ─── resume ─────────────────────────────────────────────────────────────────

describe("resume follows the input-PID map", () => {
  it("skips a complete person, re-fetches a transient one, and counts a merged duplicate once", async () => {
    const out = mkTmp();
    let down = true;
    const w = world({
      persons: { "AAAA-111": person("AAAA-111", { personas: ["P1"] }), "BBBB-111": person("BBBB-111", { personas: ["P2"] }), "OLD1-111": person("AAAA-111", { personas: ["P1"] }) },
      records: { [ark("P1")]: record("P1"), [ark("P2")]: record("P2") },
      fail: (tool, key) => (down && tool === "person_quality" && key === "BBBB-111" ? "FamilySearch API error 503" : undefined),
    });
    const pids = pidsFile(out, ["AAAA-111", "BBBB-111", "OLD1-111"]);
    const first = await snap(out, pids, w);
    expect(first).toMatchObject({ fetched: 1, errored: 1, merged: 1 });
    expect(existsSync(join(out, "persons", "BBBB-111", "meta.error.json"))).toBe(true);
    expect(readJson(join(out, "run.json")).map).toEqual({ "AAAA-111": "AAAA-111", "BBBB-111": "BBBB-111", "OLD1-111": "AAAA-111" });

    down = false;
    w.calls = [];
    const second = await snap(out, pids, w);
    expect(second).toMatchObject({ fetched: 1, skipped: 2, errored: 0, merged: 0 });
    expect(w.calls.filter((c) => c.startsWith("person_read")).sort()).toEqual(["person_read:BBBB-111"]);
    expect(existsSync(join(out, "persons", "BBBB-111", "meta.error.json"))).toBe(false);
  });

  it("calls a transient record error again on the next attempt, and for a second person citing it", async () => {
    const out = mkTmp();
    let n = 0;
    const w = world({
      persons: { "AAAA-111": person("AAAA-111", { personas: ["P1"] }), "BBBB-111": person("BBBB-111", { personas: ["P1"] }) },
      records: { [ark("P1")]: record("P1") },
      fail: (tool) => (tool === "record_read" && n++ < 2 ? "FamilySearch API error 503" : undefined),
    });
    const pids = pidsFile(out, ["AAAA-111", "BBBB-111"]);
    await snap(out, pids, w);
    expect(w.calls.filter((c) => c.startsWith("record_read"))).toHaveLength(2);
    expect(existsSync(join(out, "records", "P1.json"))).toBe(false);
    await snap(out, pids, w);
    expect(w.calls.filter((c) => c.startsWith("record_read"))).toHaveLength(3);
    expect(existsSync(join(out, "records", "P1.json"))).toBe(true);
  });

  it("writes meta.json on the third failed attempt, and a fourth run does not re-fetch", async () => {
    const out = mkTmp();
    const w = world({
      persons: { "AAAA-111": person("AAAA-111", { personas: ["P1"] }) },
      records: { [ark("P1")]: record("P1") },
      fail: (tool) => (tool === "person_quality" ? "FamilySearch API error 503" : undefined),
    });
    const pids = pidsFile(out, ["AAAA-111"]);
    for (let i = 1; i <= 2; i++) {
      expect((await snap(out, pids, w)).errored).toBe(1);
      expect(readJson(join(out, "persons", "AAAA-111", "meta.error.json")).attempts).toBe(i);
    }
    const third = await snap(out, pids, w);
    expect(third).toMatchObject({ fetched: 1, final_with_errors: 1 });
    expect(readJson(join(out, "persons", "AAAA-111", "meta.json")).attempts).toBe(3);
    w.calls = [];
    expect((await snap(out, pids, w)).skipped).toBe(1);
    expect(w.calls).toEqual([]);
  });

  it("a run stopped by a 401 leaves the attempt counts of unreached persons unchanged", async () => {
    const out = mkTmp();
    let authed = true;
    const w = world({
      persons: { "AAAA-111": person("AAAA-111", { personas: ["P1"] }), "BBBB-111": person("BBBB-111", { personas: ["P2"] }), "CCCC-111": person("CCCC-111", { personas: ["P3"] }) },
      records: { [ark("P1")]: record("P1"), [ark("P2")]: record("P2"), [ark("P3")]: record("P3") },
      fail: (tool, key) => {
        if (tool === "person_quality" && key !== "AAAA-111") return "FamilySearch API error 503";
        if (!authed && tool === "person_read") return "FamilySearch session has expired and refresh failed. Call the login tool to re-authenticate.";
        return undefined;
      },
    });
    const pids = pidsFile(out, ["AAAA-111", "BBBB-111", "CCCC-111"]);
    await snap(out, pids, w);
    const before = ["BBBB-111", "CCCC-111"].map((k) => readJson(join(out, "persons", k, "meta.error.json")).attempts);
    authed = false;
    const stopped = await snap(out, pids, w);
    expect(stopped.stopped).toMatch(/login tool/);
    expect(stopped).toMatchObject({ fetched: 0, errored: 0 });
    const after = ["BBBB-111", "CCCC-111"].map((k) => readJson(join(out, "persons", k, "meta.error.json")).attempts);
    expect(after).toEqual(before);
    const ledgers = readJson(join(out, "runs", readdirSync(join(out, "runs")).sort().at(-1)!));
    expect(ledgers.stopped).toMatch(/login tool/);
  });

  it("record cache fetches a shared persona once across two persons", async () => {
    const out = mkTmp();
    const w = world({
      persons: { "AAAA-111": person("AAAA-111", { personas: ["CENS-111"] }), "BBBB-111": person("BBBB-111", { personas: ["CENS-111"] }) },
      records: { [ark("CENS-111")]: record("CENS-111") },
    });
    await snap(out, pidsFile(out, ["AAAA-111", "BBBB-111"]), w);
    expect(w.calls.filter((c) => c === `record_read:${ark("CENS-111")}`)).toHaveLength(1);
  });

  it("--no-same-person counts every relationship-level source as unscored and writes no rows", async () => {
    const out = mkTmp();
    const w = world({
      persons: { "AAAA-111": person("AAAA-111", { personas: ["P1"], relSources: ["E1", "E2"] }) },
      records: { [ark("P1")]: record("P1"), [ark("E1")]: record("E1"), [ark("E2")]: record("E2") },
    });
    await snap(out, pidsFile(out, ["AAAA-111"]), w, false);
    expect(existsSync(join(out, "persons", "AAAA-111", "same-person.json"))).toBe(false);
    expect(readJson(join(out, "persons", "AAAA-111", "meta.json")).relationship_unscored).toBe(2);
  });
});

// ─── relationship-level persona selection (issue #3892) ─────────────────────

const rp = (id: string, gender: string, a?: string, date = "1850"): Json => ({
  id,
  gender,
  ...(a ? { ark: a } : {}),
  names: [{ given: "N", surname: "S" }],
  facts: [{ type: "http://gedcomx.org/Birth", date, place: "Ohio" }],
});
const pc = (parent: string, child: string): Json => ({ type: "ParentChild", parent, child });

/** AAAA-111 with the given tree edges, every one citing the single source E1. */
function edgeRead(edges: Json[], gender = "Male"): Json {
  return {
    persons: [{ id: "AAAA-111", gender, living: false, names: [{ given: "John", surname: "Smith" }], sources: [] }],
    relationships: edges.map((e) => ({ ...e, sources: [{ ref: "r_E1" }] })),
    sources: [{ id: "r_E1", title: "Edge E1", url: url("E1") }],
  };
}
const asParent: Json = { type: "ParentChild", parent: "AAAA-111", child: "KIN1-111" };
const asChild: Json = { type: "ParentChild", parent: "KIN1-111", child: "AAAA-111" };
const asSpouse: Json = { type: "Couple", person1: "AAAA-111", person2: "KIN1-111" };
const entryOf = (read: Json) => buildAuditList(read).entries[0];
const select = (read: Json, rec: Json) => selectSubjectPersona(read, "AAAA-111", entryOf(read), rec);

const parentsRecord = (): Json => ({
  persons: [rp("f", "Male"), rp("m", "Female"), rp("c", "Female", ark("E1"))],
  relationships: [pc("f", "c"), pc("m", "c")],
});
const childrenRecord = (): Json => ({
  persons: [rp("mo", "Female", ark("E1")), rp("fa", "Male"), rp("c1", "Female"), rp("c2", "Male")],
  relationships: [pc("fa", "c1"), pc("mo", "c1"), pc("fa", "c2"), pc("mo", "c2")],
});
const coupleRecord = (): Json => ({
  persons: [rp("h", "Male"), rp("w", "Female", ark("E1"))],
  relationships: [{ type: "Couple", person1: "h", person2: "w" }],
});

describe("selectSubjectPersona", () => {
  it("(a) subject is the parent and the ARK names the child: the subject's gender picks one of two record parents", () => {
    expect(select(edgeRead([asParent], "Male"), parentsRecord())).toEqual({ persona_id: "f", selected_by: "role:parent" });
    expect(select(edgeRead([asParent], "Female"), parentsRecord())).toEqual({ persona_id: "m", selected_by: "role:parent" });
  });

  it("(b) subject is the child and the ARK names a parent", () => {
    expect(select(edgeRead([asChild], "Female"), childrenRecord())).toEqual({ persona_id: "c1", selected_by: "role:child" });
    expect(select(edgeRead([asChild], "Male"), childrenRecord())).toEqual({ persona_id: "c2", selected_by: "role:child" });
  });

  it("(c) a Couple source: the partner of the same gender, P itself included as a candidate", () => {
    expect(select(edgeRead([asSpouse], "Male"), coupleRecord())).toEqual({ persona_id: "h", selected_by: "role:spouse" });
    expect(select(edgeRead([asSpouse], "Female"), coupleRecord())).toEqual({ persona_id: "w", selected_by: "role:spouse" });
  });

  it("(d) two same-gender children are ambiguous, and so are two parents when the subject's gender is unknown", () => {
    const sibs: Json = { persons: [rp("mo", "Female", ark("E1")), rp("c1", "Female"), rp("c2", "Female")], relationships: [pc("mo", "c1"), pc("mo", "c2")] };
    expect(select(edgeRead([asChild], "Female"), sibs)).toEqual({ unscored: "ambiguous" });
    expect(select(edgeRead([asParent], "Unknown"), parentsRecord())).toEqual({ unscored: "ambiguous" });
  });

  it("a persona holding the role itself is a candidate (a parent named by the ARK, subject also a parent)", () => {
    const rec: Json = { persons: [rp("f", "Male", ark("E1")), rp("c", "Female")], relationships: [pc("f", "c")] };
    expect(select(edgeRead([asParent], "Male"), rec)).toEqual({ persona_id: "f", selected_by: "role:parent" });
  });

  it("two edges that select different personas are edges_disagree; two that select the same one are not", () => {
    const rec: Json = { persons: [rp("g", "Male"), rp("x", "Female", ark("E1")), rp("k", "Male")], relationships: [pc("g", "x"), pc("x", "k")] };
    expect(select(edgeRead([asParent, asChild]), rec)).toEqual({ unscored: "edges_disagree" });
    expect(select(edgeRead([asParent, { ...asParent, child: "KIN2-111" }]), parentsRecord())).toEqual({ persona_id: "f", selected_by: "role:parent" });
  });

  it("a source on two edges where only one edge finds a persona is no_relationship, not that edge's pick", () => {
    expect(select(edgeRead([asParent], "Male"), parentsRecord())).toEqual({ persona_id: "f", selected_by: "role:parent" });
    expect(select(edgeRead([asParent, asSpouse], "Male"), parentsRecord())).toEqual({ unscored: "no_relationship" });
  });

  it("no candidates, or none of the subject's gender, is no_relationship", () => {
    expect(select(edgeRead([asParent]), { persons: [rp("c", "Female", ark("E1"))], relationships: [] })).toEqual({ unscored: "no_relationship" });
    expect(select(edgeRead([asParent], "Male"), { persons: [rp("m", "Female"), rp("c", "Male", ark("E1"))], relationships: [pc("m", "c")] })).toEqual({ unscored: "no_relationship" });
    const noEdge = edgeRead([asParent]);
    noEdge.relationships = [];
    noEdge.persons[0].sources = [{ ref: "r_E1" }];
    const e = { ...entryOf(edgeRead([asParent])) };
    expect(selectSubjectPersona(noEdge, "AAAA-111", e, parentsRecord())).toEqual({ unscored: "no_relationship" });
  });

  it("an unreadable record, or one without the ARK's persona, is record_unreadable", () => {
    expect(select(edgeRead([asParent]), undefined)).toEqual({ unscored: "record_unreadable" });
    expect(select(edgeRead([asParent]), { is_error: true, error: "gone" })).toEqual({ unscored: "record_unreadable" });
    expect(select(edgeRead([asParent]), { persons: [rp("f", "Male")], relationships: [] })).toEqual({ unscored: "record_unreadable" });
  });

  it("a subject-level source selects the ARK's own persona", () => {
    const read = person("AAAA-111", { personas: ["P1"] });
    expect(selectSubjectPersona(read, "AAAA-111", buildAuditList(read).entries[0], record("P1"))).toEqual({ persona_id: "p_1", selected_by: "ark" });
  });
});

describe("relationship-level sources in snapshot, baseline and plant", () => {
  const edgeWorld = (edges: Json[], rec: Json, gender = "Male"): World =>
    world({ persons: { "AAAA-111": edgeRead(edges, gender) }, records: { [ark("E1")]: rec } });
  const rowsOf = (out: string) => readJson(join(out, "persons", "AAAA-111", "same-person.json"));
  const metaOf = (out: string) => readJson(join(out, "persons", "AAAA-111", "meta.json"));

  it("scores the selected persona and records who was chosen and why", async () => {
    const out = mkTmp();
    const w = edgeWorld([asParent], parentsRecord());
    await snap(out, ["AAAA-111"], w);
    expect(rowsOf(out)).toEqual([{ ark: ark("E1"), persona_id: "f", selected_by: "role:parent", result: { matched: true, score: 0.9 } }]);
    expect(metaOf(out)).toMatchObject({ relationship_unscored: 0, relationship_unscored_reasons: {} });
  });

  it("an ambiguous source gets an unscored row with its reason, and baseline sums the reasons without adding findings", async () => {
    const out = mkTmp();
    const sibs: Json = { persons: [rp("mo", "Female", ark("E1")), rp("c1", "Female"), rp("c2", "Female")], relationships: [pc("mo", "c1"), pc("mo", "c2")] };
    await snap(out, ["AAAA-111"], edgeWorld([asChild], sibs, "Female"));
    expect(rowsOf(out)).toEqual([{ ark: ark("E1"), unscored: "ambiguous" }]);
    expect(metaOf(out)).toMatchObject({ relationship_unscored: 1, relationship_unscored_reasons: { ambiguous: 1 } });
    const { rows, summary } = runBaseline(out);
    expect(rows).toEqual([]);
    expect(summary.counts).toMatchObject({ relationship_unscored: 1, relationship_unscored_reasons: { ambiguous: 1 } });
  });

  it("(e) an indexing plant on a relationship-level ARK re-scores that source from the edited record", async () => {
    const out = mkTmp();
    const w = edgeWorld([asSpouse], coupleRecord(), "Female");
    w.persons["HOST-111"] = w.persons["AAAA-111"];
    delete w.persons["AAAA-111"];
    const tools = fakeTools(w);
    const seen: string[] = [];
    tools.samePerson = (input) => {
      seen.push(input.gedcomx2.persons.find((p: Json) => p.id === input.primaryId2).facts[0].date);
      return fakeTools(w).samePerson(input);
    };
    await runPlant(spec([{ id: "fx_i", type: "indexing_error", host: "HOST-111", edit: { persona_ark: ark("E1"), field: "Birth.date", value: "1805" } }]), out, tools);
    expect(seen).toEqual(["1850", "1805"]);
    const rows = readJson(join(out, "persons", "fx_i", "same-person.json"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ark: ark("E1"), persona_id: "w", selected_by: "role:spouse" });
  });
});

// ─── tree-link sources ──────────────────────────────────────────────────────

describe("tree-link sources", () => {
  /** A subject whose sources are one persona, one 4:1: tree person and one 2:2: compiled tree. */
  const linked = (id: string): Json => {
    const p = person(id, { personas: ["REC1-111"] });
    p.sources.push(
      { id: "s_tp", title: "Same man", url: "https://familysearch.org/ark:/61903/4:1:TREE-PPP" },
      { id: "s_ct", title: "Community Trees", url: "https://familysearch.org/ark:/61903/2:2:TEST-2A2" },
    );
    p.persons[0].sources.push({ ref: "s_tp" }, { ref: "s_ct" });
    return p;
  };
  const ct = ark("REC1-111").replace("1:1:REC1-111", "2:2:TEST-2A2");
  const tw = (over: Partial<World> = {}) =>
    world({
      persons: { "AAAA-111": linked("AAAA-111"), "TREE-PPP": person("TREE-PPP") },
      records: { [ark("REC1-111")]: record("REC1-111") },
      trees: { [ct]: { persons: [{ id: "2:2:TEST-2A2", display: { name: "John /Smith/" } }] } },
      ...over,
    });

  it("classifies 4:1: tree persons and 2:2:/2:3: compiled trees apart from no-index sources", () => {
    expect(classifyArk("ark:/61903/4:1:TEST-4D1")).toBe("tree_person");
    expect(classifyArk("ark:/61903/2:2:TEST-2A2")).toBe("compiled_tree");
    expect(classifyArk("ark:/61903/2:3:TEST-2B3")).toBe("compiled_tree");
    expect(classifyArk("ark:/61903/3:1:TEST-3C1-XX")).toBe("no_index");
    expect(classifyArk("ark:/61903/1:1:TEST-1A1")).toBe("persona");
    expect(classifyArk(null)).toBe("no_index");
  });

  it("snapshot reads the tree person into others/ and the compiled tree into trees/", async () => {
    const out = mkTmp();
    const w = tw();
    await snap(out, ["AAAA-111"], w);
    const dir = join(out, "persons", "AAAA-111");
    expect(readJson(join(dir, "audit.json")).entries.map((e: Json) => e.class).sort()).toEqual(["compiled_tree", "persona", "tree_person"]);
    expect(existsSync(join(dir, "others", "TREE-PPP.json"))).toBe(true);
    expect(readJson(join(out, "trees", "2-2-TEST-2A2.json")).persons[0].display.name).toBe("John /Smith/");
  });

  it("tree-sources reclassifies an old snapshot and fetches only what is not on disk", async () => {
    const out = mkTmp();
    const w = tw();
    await snap(out, ["AAAA-111"], w);
    const audit = join(out, "persons", "AAAA-111", "audit.json");
    const a = readJson(audit);
    for (const e of a.entries) if (e.class !== "persona") e.class = "no_index";
    writeJson(audit, a);
    rmSync(join(out, "trees"), { recursive: true, force: true });
    w.calls.length = 0;

    const ledger = await runTreeSources(out, fakeTools(w));
    expect(ledger).toMatchObject({ copies: 1, tree_links: 2, tree_links_read: 2, errored: 0 });
    expect(ledger.by_class).toEqual({ persona: 1, tree_person: 1, compiled_tree: 1 });
    expect(w.calls).toEqual([`compiled_tree_read:${ct}`]);
    expect(readJson(audit).entries.map((e: Json) => e.class).sort()).toEqual(["compiled_tree", "persona", "tree_person"]);
  });

  it("a missing compiled tree is cached as a permanent error, not retried", async () => {
    const out = mkTmp();
    const w = tw({ trees: {} });
    await snap(out, ["AAAA-111"], w);
    expect(readJson(join(out, "trees", "2-2-TEST-2A2.json")).is_error).toBe(true);
    w.calls.length = 0;
    const ledger = await runTreeSources(out, fakeTools(w));
    expect(ledger).toMatchObject({ tree_links: 2, tree_links_read: 1 });
    expect(w.calls).toEqual([]);
  });

  it("main runs tree-sources and refuses a flag it does not take", async () => {
    const out = mkTmp();
    const w = tw();
    await snap(out, ["AAAA-111"], w);
    expect(await main(["tree-sources", "--snapshot", out], fakeTools(w))).toBe(0);
    await expect(main(["tree-sources", "--snapshot", out, "--tree", "X"], fakeTools(w))).rejects.toThrow(/does not take --tree/);
  });
});

// ─── researcher-tree attachments ────────────────────────────────────────────

describe("attachments refresh", () => {
  const familyTree = () =>
    world({
      persons: { "AAAA-111": person("AAAA-111", { personas: ["REC1-111", "REC2-111"] }), "FTCP-111": person("FTCP-111") },
      records: { [ark("REC1-111")]: record("REC1-111"), [ark("REC2-111")]: record("REC2-111") },
      attach: { [ark("REC1-111")]: [{ personId: "FTCP-111", tags: ["Birth"] }] },
    });
  const researcherTree = (base: World) => ({
    ...base,
    persons: { ...base.persons, "OTHR-222": person("OTHR-222") },
    attach: {
      [ark("REC1-111")]: [{ personId: "AAAA-111", tags: ["Birth"] }],
      [ark("REC2-111")]: [{ personId: "AAAA-111", tags: ["Name"] }, { personId: "OTHR-222", tags: ["Name"] }],
    },
    calls: [],
  });

  it("keeps the Family Tree answer, writes the tree's, and adds the tree's others to the reads already held", async () => {
    const out = mkTmp();
    const ft = familyTree();
    await snap(out, ["AAAA-111"], ft);
    const dir = join(out, "persons", "AAAA-111");
    expect(existsSync(join(dir, "others", "FTCP-111.json"))).toBe(true);

    const ledger = await runRefreshAttachments(out, fakeTools(researcherTree(ft)), "9NMM-TEST");
    expect(ledger).toMatchObject({ refreshed: 1, skipped: 0, errored: 0, subject_arks: 2, subject_arks_naming_subject: 2 });
    expect(readJson(join(dir, "attachments.family-tree.json")).attachments[ark("REC1-111")][0].personId).toBe("FTCP-111");
    expect(readJson(join(dir, "attachments.json")).attachments[ark("REC1-111")][0].personId).toBe("AAAA-111");
    expect(readdirSync(join(dir, "others")).sort()).toEqual(["FTCP-111.json", "OTHR-222.json"]);
    expect(existsSync(join(dir, "others.family-tree"))).toBe(false);
    expect(readJson(join(dir, "attachments-tree.json")).tree).toBe("9NMM-TEST");
  });

  it("skips a copy already refreshed for the tree, and still counts its subject ARKs", async () => {
    const out = mkTmp();
    const ft = familyTree();
    await snap(out, ["AAAA-111"], ft);
    const rt = researcherTree(ft);
    await runRefreshAttachments(out, fakeTools(rt), "9NMM-TEST");
    rt.calls.length = 0;
    const again = await runRefreshAttachments(out, fakeTools(rt), "9NMM-TEST");
    expect(again).toMatchObject({ refreshed: 0, skipped: 1, subject_arks: 2, subject_arks_naming_subject: 2 });
    expect(rt.calls).toEqual([]);
    expect(readJson(join(out, "persons", "AAAA-111", "attachments.family-tree.json")).attachments[ark("REC1-111")][0].personId).toBe("FTCP-111");
  });

  it("counts a Family Tree answer as naming no subject ARK", async () => {
    const out = mkTmp();
    const ft = familyTree();
    await snap(out, ["AAAA-111"], ft);
    const ledger = await runRefreshAttachments(out, fakeTools({ ...ft, calls: [] }), "9NMM-TEST");
    expect(ledger).toMatchObject({ refreshed: 1, subject_arks: 2, subject_arks_naming_subject: 0 });
  });

  it("leaves plant copies alone", async () => {
    const out = mkTmp();
    const ft = familyTree();
    await snap(out, ["AAAA-111"], ft);
    const run = readJson(join(out, "run.json"));
    writeJson(join(out, "run.json"), { ...run, plants: { "FIX-1": { host: "AAAA-111" } } });
    cpSync(join(out, "persons", "AAAA-111"), join(out, "persons", "FIX-1"), { recursive: true });
    writeJson(join(out, "persons", "FIX-1", "attachments.json"), { attachments: {}, unattached: ["x"] });
    await runRefreshAttachments(out, fakeTools(researcherTree(ft)), "9NMM-TEST");
    expect(readJson(join(out, "persons", "FIX-1", "attachments.json"))).toEqual({ attachments: {}, unattached: ["x"] });
    expect(existsSync(join(out, "persons", "FIX-1", "attachments.family-tree.json"))).toBe(false);
  });

  it("a rate limit stops the run and leaves the copy unmarked for the next run", async () => {
    const out = mkTmp();
    const ft = familyTree();
    await snap(out, ["AAAA-111"], ft);
    const rt = { ...researcherTree(ft), fail: (tool: string) => (tool === "source_attachments" ? "FamilySearch rate limit reached." : undefined) };
    const ledger = await runRefreshAttachments(out, fakeTools(rt), "9NMM-TEST");
    expect(ledger.stopped).toMatch(/rate limit/);
    expect(existsSync(join(out, "persons", "AAAA-111", "attachments-tree.json"))).toBe(false);
    const resumed = await runRefreshAttachments(out, fakeTools(researcherTree(ft)), "9NMM-TEST");
    expect(resumed).toMatchObject({ refreshed: 1, subject_arks_naming_subject: 2 });
    expect(readJson(join(out, "persons", "AAAA-111", "attachments.family-tree.json")).attachments[ark("REC1-111")][0].personId).toBe("FTCP-111");
  });

  it("main passes --tree to the attachments subcommand and refuses it on baseline", async () => {
    const out = mkTmp();
    const ft = familyTree();
    await snap(out, ["AAAA-111"], ft);
    expect(await main(["attachments", "--snapshot", out, "--tree", "9NMM-TEST"], fakeTools(researcherTree(ft)))).toBe(0);
    await expect(main(["attachments", "--snapshot", out], fakeTools(ft))).rejects.toThrow(/needs --tree/);
    await expect(main(["baseline", "--snapshot", out, "--tree", "9NMM-TEST"])).rejects.toThrow(/does not take --tree/);
  });
});

// ─── baseline ───────────────────────────────────────────────────────────────

describe("baseline", () => {
  it("baseline joins a person_quality conflict URI to its audit source across https, www and ark: spellings", async () => {
    const out = mkTmp();
    const conflict = (uri: string) => ({ field: "Birth", values: ["1850", "1860"], sources: [{ title: "x", uri, agrees: false }] });
    const w = world({
      persons: { "AAAA-111": person("AAAA-111", { personas: ["P1", "P2", "P3"] }) },
      records: { [ark("P1")]: record("P1"), [ark("P2")]: record("P2"), [ark("P3")]: record("P3") },
      quality: {
        "AAAA-111": {
          detail: {
            facts: [],
            conflicts: [conflict("https://familysearch.org/ark:/61903/1:1:P1"), conflict("https://www.familysearch.org/ark:/61903/1:1:P2"), conflict("ark:/61903/1:1:P3")],
          },
        },
      },
    });
    await snap(out, pidsFile(out, ["AAAA-111"]), w);
    const { rows, summary } = runBaseline(out);
    expect(rows.filter((r) => r.signal === "person_quality_conflict").map((r) => r.ark).sort()).toEqual([ark("P1"), ark("P2"), ark("P3")]);
    expect(summary.join_checks.person_quality_conflict_uris_unmatched).toBe(0);
  });

  it("baseline skips and counts a person whose read failed for good", async () => {
    const out = mkTmp();
    const w = world({ persons: { "AAAA-111": person("AAAA-111", { personas: ["P1"] }) }, records: { [ark("P1")]: record("P1") } });
    await snap(out, pidsFile(out, ["AAAA-111", "GONE-111"]), w);
    const { summary } = runBaseline(out);
    expect(summary.counts).toMatchObject({ persons: 1, person_read_failed: 1 });
  });

  it("baseline counts a subject-level ARK returned unattached", async () => {
    const out = mkTmp();
    const w = world({
      persons: { "AAAA-111": person("AAAA-111", { personas: ["P1", "P2"] }) },
      records: { [ark("P1")]: record("P1"), [ark("P2")]: record("P2") },
      attach: { [ark("P1")]: [{ personId: "AAAA-111", tags: [] }] },
    });
    await snap(out, pidsFile(out, ["AAAA-111"]), w);
    expect(runBaseline(out).summary.join_checks.subject_persona_arks_unattached).toBe(1);
  });

  it("flags a low same_person score and a persona attached to two tree persons", async () => {
    const out = mkTmp();
    const w = world({
      persons: { "AAAA-111": person("AAAA-111", { personas: ["P1", "P2"] }), "OTHR-111": person("OTHR-111") },
      records: { [ark("P1")]: record("P1"), [ark("P2")]: record("P2") },
      attach: { [ark("P1")]: [{ personId: "AAAA-111", tags: [] }], [ark("P2")]: [{ personId: "AAAA-111", tags: [] }, { personId: "OTHR-111", tags: [] }] },
      scores: { [ark("P1")]: 0.2 },
    });
    await snap(out, pidsFile(out, ["AAAA-111"]), w);
    expect(existsSync(join(out, "persons", "AAAA-111", "others", "OTHR-111.json"))).toBe(true);
    const sig = runBaseline(out).rows.map((r) => `${r.signal}:${r.ark}`).sort();
    expect(sig).toEqual([`multi_attached:${ark("P2")}`, `same_person_low:${ark("P1")}`]);
  });
});

// ─── plant ──────────────────────────────────────────────────────────────────

function plantWorld(): World {
  return world({
    persons: { "HOST-111": person("HOST-111", { personas: ["P1"] }), "DONR-OWN": person("DONR-OWN", { personas: ["DONR-111"] }) },
    records: { [ark("P1")]: record("P1"), [ark("DONR-111")]: record("DONR-111", "Jacob", "Brown") },
    attach: { [ark("P1")]: [{ personId: "HOST-111", tags: [] }], [ark("DONR-111")]: [{ personId: "DONR-OWN", tags: [] }] },
    scores: { [ark("DONR-111")]: 0.1 },
  });
}

const spec = (fixtures: FixtureSpec["fixtures"]): FixtureSpec => ({ fixtures });

describe("plant", () => {
  it("two fixtures on one host produce two copies and two row sets", async () => {
    const out = mkTmp();
    const w = plantWorld();
    w.records[ark("DON2-111")] = record("DON2-111", "Peter", "Gray");
    w.scores![ark("DON2-111")] = 0.1;
    await runPlant(
      spec([
        { id: "fx_a", type: "easy_wrong_person", host: "HOST-111", donor_ark: ark("DONR-111") },
        { id: "fx_b", type: "hard_wrong_person", host: "HOST-111", donor_ark: ark("DON2-111") },
      ]),
      out,
      fakeTools(w),
    );
    const run = readJson(join(out, "run.json"));
    expect(Object.keys(run.plants).sort()).toEqual(["HOST-111.unplanted", "fx_a", "fx_b"]);
    const rows = runBaseline(out).rows.filter((r) => r.signal === "same_person_low");
    expect(rows.map((r) => `${r.copy_key}:${r.ark}`).sort()).toEqual([`fx_a:${ark("DONR-111")}`, `fx_b:${ark("DON2-111")}`]);
  });

  it("wrong-person plant builds a tree-style title, adds the host id to attachments, and reads the donor's other attached persons", async () => {
    const out = mkTmp();
    const w = plantWorld();
    await runPlant(spec([{ id: "fx_a", type: "easy_wrong_person", host: "HOST-111", donor_ark: ark("DONR-111") }]), out, fakeTools(w));
    const dir = join(out, "persons", "fx_a");
    const read = readJson(join(dir, "person-read.json"));
    const added = read.sources.find((s: Json) => s.url === url("DONR-111"));
    expect(added.title).toBe('Jacob Brown, "Ohio, Births, 1800-1900"');
    expect(added.id).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{3}$/);
    expect(read.persons[0].sources).toContainEqual({ ref: added.id });
    expect(readJson(join(dir, "tree.gedcomx.json")).sources.some((s: Json) => s.id === added.id)).toBe(true);
    expect(readJson(join(dir, "audit.json")).entries.find((e: Json) => e.ark === ark("DONR-111"))).toMatchObject({ level: "subject", class: "persona" });
    expect(readJson(join(dir, "attachments.json")).attachments[ark("DONR-111")].map((p: Json) => p.personId)).toEqual(["DONR-OWN", "HOST-111"]);
    expect(existsSync(join(dir, "others", "DONR-OWN.json"))).toBe(true);
    expect(readJson(join(out, "persons", unplantedKey("HOST-111"), "person-read.json")).sources.some((s: Json) => s.url === url("DONR-111"))).toBe(false);
  });

  it("indexing plant changes exactly one field, in the copy's own records/, and the .unplanted copy still reads the original", async () => {
    const out = mkTmp();
    const w = plantWorld();
    await runPlant(
      spec([{ id: "fx_i", type: "indexing_error", host: "HOST-111", edit: { persona_ark: ark("P1"), field: "Birth.date", value: "1805" } }]),
      out,
      fakeTools(w),
    );
    const planted = readRecord(out, "fx_i", "P1");
    const original = readRecord(out, unplantedKey("HOST-111"), "P1");
    expect(planted.persons[0].facts[0].date).toBe("1805");
    expect(original.persons[0].facts[0].date).toBe("1850");
    const diff = (a: Json, b: Json, path = ""): string[] =>
      typeof a !== "object" || a === null
        ? a === b ? [] : [path]
        : [...new Set([...Object.keys(a), ...Object.keys(b ?? {})])].flatMap((k) => diff(a[k], b?.[k], `${path}.${k}`));
    expect(diff(planted, original)).toEqual([".persons.0.facts.0.date"]);
    expect(existsSync(join(out, "persons", "fx_i", "records", "P1.json"))).toBe(true);
  });

  it("refuses a donor already on the host and a must-not-flag source the host does not carry", async () => {
    await expect(
      runPlant(spec([{ id: "fx_a", type: "easy_wrong_person", host: "HOST-111", donor_ark: ark("P1") }]), mkTmp(), fakeTools(plantWorld())),
    ).rejects.toThrow(/already attached to host/);
    await expect(
      runPlant(spec([{ id: "ok_a", type: "nickname", host: "HOST-111", source_ark: ark("NOPE-111") }]), mkTmp(), fakeTools(plantWorld())),
    ).rejects.toThrow(/not attached to host/);
    const out = mkTmp();
    await runPlant(spec([{ id: "ok_b", type: "nickname", host: "HOST-111", source_ark: ark("P1") }]), out, fakeTools(plantWorld()));
    expect(Object.keys(readJson(join(out, "run.json")).plants)).toEqual(["HOST-111.unplanted"]);
  });

  it("refuses a living host, and still writes the plant ledger", async () => {
    const out = mkTmp();
    const w = plantWorld();
    w.persons["HOST-111"] = person("HOST-111", { living: true, personas: ["P1"] });
    await expect(runPlant(spec([{ id: "fx_a", type: "easy_wrong_person", host: "HOST-111", donor_ark: ark("DONR-111") }]), out, fakeTools(w))).rejects.toThrow(/is living/);
    expect(readdirSync(join(out, "runs")).some((f) => f.startsWith("plant-"))).toBe(true);
  });

  it("applyIndexingPlant refuses an edit that changes nothing", () => {
    expect(() => applyIndexingPlant(record("P1"), { persona_ark: ark("P1"), field: "Birth.date", value: "1850" })).toThrow(/already reads/);
  });

  it("applyWrongPersonPlant and addHostAttachment do not mutate their input", () => {
    const read = person("HOST-111", { personas: ["P1"] });
    const docs = { read, tree: structuredClone(read), audit: buildAuditList(read) };
    const snapshot = JSON.stringify(docs);
    applyWrongPersonPlant(docs, record("DONR-111"), ark("DONR-111"), "ABCD-EFG");
    expect(JSON.stringify(docs)).toBe(snapshot);
    const att = { attachments: {}, unattached: [ark("DONR-111")] };
    expect(addHostAttachment(att, ark("DONR-111"), [], "HOST-111").unattached).toEqual([]);
    expect(att.unattached).toEqual([ark("DONR-111")]);
  });
});

// ─── score ──────────────────────────────────────────────────────────────────

describe("score", () => {
  const SPEC = spec([
    { id: "wp1", type: "hard_wrong_person", host: "H1", donor_ark: ark("DON1") },
    { id: "wp2", type: "hard_wrong_person", host: "H1", donor_ark: ark("DON2") },
    { id: "ix1", type: "indexing_error", host: "H2", edit: { persona_ark: ark("REC2"), field: "Birth.date", value: "1" } },
    { id: "ix2", type: "indexing_error", host: "H3", edit: { persona_ark: ark("REC3"), field: "Birth.date", value: "1" } },
    { id: "nf1", type: "nickname", host: "H4", source_ark: ark("NICK") },
    { id: "nf2", type: "nickname", host: "H5", source_ark: ark("NICK5") },
    { id: "nf3", type: "patronymic", host: "H6", source_ark: ark("PAT") },
  ]);
  const row = (copy_key: string, a: string | null, kind: string, signal = "judge"): FindingRow => ({ copy_key, ark: a, kind, signal });
  const present = (missing: string[] = [], harnessMiss: string[] = []) => (c: string) => ({ present: !missing.includes(c), harnessMiss: harnessMiss.includes(c) });
  const byType = (scores: ReturnType<typeof scoreFindings>) => Object.fromEntries(scores.map((s) => [s.type, s]));

  it("counts misattributed as caught and indexing separately", () => {
    const s = byType(scoreFindings(SPEC, { path: "judge.jsonl", step: "judge", rows: [row("wp1", ark("DON1"), "misattributed"), row("wp2", ark("DON2"), "indexing")] }, present()));
    expect(s.hard_wrong_person).toMatchObject({ caught: 1, scored: 2, misses: ["wp2"], indexing_on_planted: 1 });
  });

  it("ignores a row already in the .unplanted copy, and reports an indexing fixture whose .unplanted copy already has an indexing finding as confounded", () => {
    const s = byType(
      scoreFindings(
        SPEC,
        {
          path: "judge.jsonl",
          step: "judge",
          rows: [
            row("wp1", ark("DON1"), "misattributed"),
            row("H1.unplanted", ark("DON1"), "misattributed"),
            row("ix1", ark("REC2"), "indexing"),
            row("H2.unplanted", ark("REC2"), "indexing"),
            row("ix2", ark("REC3"), "indexing"),
          ],
        },
        present(),
      ),
    );
    expect(s.hard_wrong_person.caught).toBe(0);
    expect(s.indexing_error).toMatchObject({ caught: 1, scored: 1, confounded: ["ix1"] });
  });

  it("counts false alarms on the named source only, including a person_quality conflict on a must-not-flag host, and not an unchecked finding", () => {
    const s = byType(
      scoreFindings(
        SPEC,
        {
          path: "baseline.jsonl",
          step: "baseline",
          rows: [
            row("H4.unplanted", ark("NICK"), "source_conflict", "person_quality_conflict"),
            row("H4.unplanted", ark("ELSEWHERE"), "misattributed", "same_person_low"),
            row("H5.unplanted", ark("NICK5"), "unchecked"),
            row("H5.unplanted", ark("ELSEWHERE"), "misattributed", "same_person_low"),
          ],
        },
        present(),
      ),
    );
    expect(s.nickname).toMatchObject({ false_alarms: 1, scored: 2, false_alarm_ids: ["nf1"], rate: 0.5, false_alarm_signals: { person_quality_conflict: 1 } });
  });

  it("scores a must-not-flag fixture on <host_id>.unplanted even when identical .unplanted rows are present", () => {
    const s = byType(scoreFindings(SPEC, { path: "judge.jsonl", step: "judge", rows: [row("H6.unplanted", ark("PAT"), "misattributed")] }, present()));
    expect(s.patronymic).toMatchObject({ false_alarms: 1, scored: 1 });
  });

  it("reports a fixture with no judge file as missing", () => {
    const s = byType(scoreFindings(SPEC, { path: "judge.jsonl", step: "judge", rows: [] }, present(["wp1", "H4.unplanted"])));
    expect(s.hard_wrong_person).toMatchObject({ missing: ["wp1"], scored: 1, misses: ["wp2"] });
    expect(s.nickname).toMatchObject({ missing: ["nf1"], scored: 1, false_alarms: 0 });
  });

  it("reports blind on planted copies and n/a for empty types", () => {
    const s = byType(
      scoreFindings(
        SPEC,
        {
          path: "baseline.jsonl",
          step: "baseline",
          rows: [
            row("wp1", null, "warning", "person_warnings"),
            row("wp1", ark("DON1"), "source_conflict", "person_quality_conflict"),
            row("wp1", ark("DON1"), "misattributed", "multi_attached"),
            row("wp2", ark("DON2"), "misattributed", "same_person_low"),
          ],
        },
        present(),
      ),
    );
    expect(s.hard_wrong_person).toMatchObject({ blind: 2, by_construction: 1, caught: 1, misses: ["wp1"] });
    expect(s.easy_wrong_person).toMatchObject({ fixtures: 0, rate: null });
  });

  it("excludes harness_miss", () => {
    const s = byType(scoreFindings(SPEC, { path: "judge.jsonl", step: "judge", rows: [row("wp1", ark("DON1"), "misattributed")] }, present([], ["wp1"])));
    expect(s.hard_wrong_person).toMatchObject({ harness_miss: ["wp1"], scored: 1, caught: 0, misses: ["wp2"] });
  });

  it("excludes a judge copy whose findings block did not parse, rather than scoring it clean", () => {
    const presence = (c: string) => ({ present: true, harnessMiss: false, parseError: c === "H4.unplanted" || c === "wp1" });
    const s = byType(scoreFindings(SPEC, { path: "judge.jsonl", step: "judge", rows: [] }, presence));
    expect(s.nickname).toMatchObject({ parse_error: ["nf1"], scored: 1, false_alarms: 0 });
    expect(s.hard_wrong_person).toMatchObject({ parse_error: ["wp1"], scored: 1, misses: ["wp2"] });
  });

  it("lists every miss", () => {
    const s = byType(scoreFindings(SPEC, { path: "judge.jsonl", step: "judge", rows: [] }, present()));
    expect(s.hard_wrong_person.misses).toEqual(["wp1", "wp2"]);
    expect(s.indexing_error.misses).toEqual(["ix1", "ix2"]);
  });

  it("reads judge rows by source_url and finds a copy's judge file next to judge.jsonl", () => {
    const dir = mkTmp();
    writeFileSync(join(dir, "judge.jsonl"), JSON.stringify({ copy_key: "wp1", source_url: "https://familysearch.org/ark:/61903/1:1:DON1", kind: "misattributed", signal: "judge" }) + "\n", "utf8");
    writeJson(join(dir, "judge", "wp1.json"), { harness_miss: false });
    const file = readFindings(join(dir, "judge.jsonl"));
    const s = byType(scoreFindings(SPEC, file));
    expect(s.hard_wrong_person).toMatchObject({ caught: 1, scored: 1, missing: ["wp2"] });
  });
});

describe("the committed fixture spec", () => {
  it("loads, and holds no id the type rules reject", () => {
    expect(() => loadSpec(SPEC_PATH)).not.toThrow();
  });
});
