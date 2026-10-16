/**
 * dev/source-screen.ts (issue #3408, steps 1-2). Every network stage runs over
 * a fake `Tools`, except the error-classification test, which runs the real
 * tool functions over a stubbed `fetch` so the messages are the ones the tools
 * actually throw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from "fs";
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
  readFindings,
  readJson,
  readRecord,
  relationshipNoteCount,
  REPO_ROOT,
  runBaseline,
  runPlant,
  runSnapshot,
  scoreFindings,
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
    const audit = buildAuditList(read);
    const by = Object.fromEntries(audit.entries.map((e) => [e.source_ids[0], [e.level, e.class]]));
    expect(by).toEqual({
      s_P1: ["subject", "persona"],
      s_rec: ["subject", "record_only"],
      s_book: ["subject", "no_index"],
      r_E1: ["relationship", "persona"],
      s_mem: ["subject", "no_index"],
    });
    expect(audit.entries.some((e) => e.source_ids.includes("k_K1"))).toBe(false);
  });

  it("a source cited by the subject and a relationship is level subject", () => {
    const read = person("AAAA-111", { personas: ["P1"], relSources: ["P1"] });
    const audit = buildAuditList(read);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({ ark: ark("P1"), level: "subject", source_ids: ["s_P1", "r_P1"] });
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
      ["deleted person", () => fetchMock.mockResolvedValue(res(410)), () => tools.personRead("KWCB-QZ3"), "permanent"],
      ["tombstoned quality", () => fetchMock.mockResolvedValue(res(200, { isValid: true, visibility: "TOMBSTONED" })), () => tools.personQuality("KWCB-QZ4"), "permanent"],
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
  }, 30_000);

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

  it("relationship-level sources get no same_person row and are counted relationship_unscored", async () => {
    const out = mkTmp();
    const w = world({
      persons: { "AAAA-111": person("AAAA-111", { personas: ["P1"], relSources: ["E1", "E2"] }) },
      records: { [ark("P1")]: record("P1"), [ark("E1")]: record("E1"), [ark("E2")]: record("E2") },
    });
    await snap(out, pidsFile(out, ["AAAA-111"]), w);
    const rows = readJson(join(out, "persons", "AAAA-111", "same-person.json"));
    expect(rows.map((r: Json) => r.ark)).toEqual([ark("P1")]);
    expect(readJson(join(out, "persons", "AAAA-111", "meta.json")).relationship_unscored).toBe(2);
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
            row("wp1", ark("HOSTOWN"), "misattributed"),
            row("H1.unplanted", ark("HOSTOWN"), "misattributed"),
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
          ],
        },
        present(),
      ),
    );
    expect(s.nickname).toMatchObject({ false_alarms: 1, scored: 2, false_alarm_ids: ["nf1"], rate: 0.5 });
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
