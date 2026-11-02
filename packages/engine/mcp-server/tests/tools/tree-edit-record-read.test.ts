import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LOCAL } from "../../src/auth/principal.js";

// Only the token and the network are replaced: FamilySearch's record API answers
// with a saved body, and the Places API with its recorded answers. Everything
// from the record read to the tree runs as written.
vi.mock("../../src/auth/refresh.js", () => ({ getValidToken: vi.fn(async () => "test-token") }));
vi.mock("../../src/utils/place-api.js");

import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { recordReadTool } from "../../src/tools/record-read.js";
import { runExtractionAppend } from "../../src/tools/extraction-append.js";
import { treeEdit } from "../../src/tools/tree-edit.js";
import { getPlaceById, getPlaceReps, searchPlace } from "../../src/utils/place-api.js";
import { __clearPlaceResolverCachesForTests } from "../../src/utils/place-resolver.js";
import type { GedcomX } from "../../src/types/gedcomx.js";
import { writeProjectFile } from "../helpers/project-files.js";

/** FamilySearch's record API body for persona 6J8F-6678, saved 2026-10-26: Marie
 *  Catherine Sabattier's death registered 3 Apr 1874 at "Olne, Liège, Belgique". */
const BODY: GedcomX = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "record-read", "6J8F-6678.recapi.json"), "utf8"),
);
const DECEASED = "p_296982812853";
const OLNE = "Olne, Liège, Belgique";

/** The Places API's answers to the calls record_read makes for that body,
 *  recorded 2026-10-29 (Accept-Language: en): the descriptions of the place
 *  FamilySearch chose and of the coverage places, and that place's listing. */
const DESCRIPTIONS: Record<string, Awaited<ReturnType<typeof getPlaceById>>> = {
  "418460": {
    placeId: "1959431", placeRepId: "418460", name: "Olne", fullName: "Olne, Prince-Bishopric of Liège, Holy Roman Empire",
    type: "Municipality", latitude: 50.5907, longitude: 5.749, dateRange: "/+1795", parentPlaceRepId: "10922185",
  },
  "2069": {
    placeId: "1928607", placeRepId: "2069", name: "Liège", fullName: "Liège, Belgium",
    type: "Province", latitude: 50.6, longitude: 5.7, dateRange: "+1830/", parentPlaceRepId: "224",
  },
  "10922185": {
    placeId: "1928607", placeRepId: "10922185", name: "Prince-Bishopric of Liège", fullName: "Prince-Bishopric of Liège, Holy Roman Empire",
    type: "Principality or Emirate", latitude: 50.627, longitude: 5.5846, dateRange: "+985/+1795", parentPlaceRepId: "10564386",
  },
};
const LISTINGS: Record<string, Awaited<ReturnType<typeof getPlaceReps>>> = {
  "1959431": [
    { placeRepId: "12441861", fullName: "Olne, Liège, Belgium", dateRange: "+1830/", names: ["Olne"] },
    { placeRepId: "12441860", fullName: "Olne, Liège, Netherlands", dateRange: "+1815/+1830", names: ["Olne"] },
    { placeRepId: "12441859", fullName: "Olne, L'Ourthe, France", dateRange: "+1795/+1815", names: ["Olne"] },
    { placeRepId: "418460", fullName: "Olne, Prince-Bishopric of Liège, Holy Roman Empire", dateRange: "/+1795", names: ["Olne"] },
  ],
};

describe("tree_edit: a fact citing a record read takes FamilySearch's standard place from it", () => {
  let dir: string;
  const fetched: string[] = [];

  beforeEach(async () => {
    __clearPlaceResolverCachesForTests();
    fetched.length = 0;
    dir = await mkdtemp(join(tmpdir(), "tree-edit-record-read-"));
    await writeFile(
      join(dir, "research.json"),
      JSON.stringify({
        project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
        questions: [], plans: [], log: [], sources: [], assertions: [], person_evidence: [], conflicts: [],
        hypotheses: [], timelines: [], proof_summaries: [], evaluations: [],
      }),
    );
    await writeFile(
      join(dir, "tree.gedcomx.json"),
      JSON.stringify({
        persons: [{ id: "I1", gender: "Female", names: [{ id: "N1", given: "Marie Catherine", surname: "Sabattier", preferred: true }], facts: [] }],
        relationships: [],
        sources: [],
      }),
    );
    vi.mocked(getPlaceById).mockImplementation(async (id: string) => DESCRIPTIONS[id] ?? null);
    vi.mocked(getPlaceReps).mockImplementation(async (placeId: string) => LISTINGS[placeId] ?? []);
    vi.mocked(searchPlace).mockRejectedValue(new Error("no place search is expected"));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  /** record_read on `body` (staged), extraction_append writing the record, the
   *  researcher's link of the deceased's assertions to I1, then a tree_edit
   *  add_fact of her death registration at `place`, citing the record's source. */
  const readLinkAndAdd = async (body: GedcomX, place = OLNE) => {
    vi.stubGlobal("fetch", async (input: unknown) => {
      const url = String(input);
      fetched.push(url);
      if (url.endsWith("/recapi/records/persona/6J8F-6678.json")) return new Response(JSON.stringify(body), { status: 200 });
      throw new Error(`unexpected fetch ${url}`);
    });
    const read = { readRecord: (input: { recordId: string; projectPath?: string }) => recordReadTool(input, LOCAL) };
    const extracted = await runExtractionAppend({ projectPath: dir, recordIds: ["6J8F-6678"] }, read as never, LOCAL);
    expect(extracted.ok, JSON.stringify(extracted)).toBe(true);
    const research = JSON.parse(await readFile(join(dir, "research.json"), "utf8"));
    expect(research.log.map((e: any) => [e.tool, e.results_ref])).toEqual([["record_read", "results/log_001.json"]]);
    research.person_evidence = research.assertions
      .filter((a: any) => a.record_persona_id === DECEASED)
      .map((a: any, i: number) => ({
        id: `pe_${String(i + 1).padStart(3, "0")}`, assertion_id: a.id, person_id: "I1", confidence: "probable",
        rationale: "the deceased is I1", match_score: 0.9, created: "2026-01-01", superseded_by: null,
      }));
    await writeProjectFile(join(dir, "research.json"), JSON.stringify(research));
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_fact",
      personId: "I1",
      fact: { type: "DeathRegistration", date: "3 Apr 1874", place, sources: [{ ref: "S1" }] },
    } as never);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const tree = JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf8"));
    return { r: r as any, fact: tree.persons[0].facts[0], staged: JSON.parse(await readFile(join(dir, "results", "log_001.json"), "utf8")) };
  };

  it("fills the fact with the standard place record_read named for its text, and looks nothing up", async () => {
    const { r, fact, staged } = await readLinkAndAdd(BODY);
    // record_read's own conversion named the fact for its 1874 date, in English.
    const own = staged.payload.results[0].gedcomx.persons.find((p: any) => p.id === DECEASED).facts;
    expect(own.filter((f: any) => f.place).map((f: any) => [f.type, f.place, f.standard_place])).toEqual([
      ["DeathRegistration", OLNE, "Olne, Liège, Belgium"],
    ]);
    expect(fact).toMatchObject({ type: "DeathRegistration", place: OLNE, standard_place: "Olne, Liège, Belgium" });
    expect(r.validation.warnings.filter((w: string) => /standard_place/.test(w))).toEqual([]);
    expect(vi.mocked(searchPlace)).not.toHaveBeenCalled();
    expect(fetched).toEqual(["https://sg30p0.familysearch.org/service/cds/recapi/records/persona/6J8F-6678.json"]);
  });

  it("fills none when the record gives the text two standard places, and looks nothing up", async () => {
    // The same body with a second registration at the same place in 1790, which
    // record_read names for its own date: the record disagrees with itself.
    const body: GedcomX = structuredClone(BODY);
    const deceased = body.persons!.find((p) => p.id === DECEASED)!;
    const registration = deceased.facts!.find((f) => String(f.type).endsWith("DeathRegistration"))!;
    deceased.facts!.push({ ...structuredClone(registration), id: undefined, date: { original: "1790", formal: "+1790" } } as never);
    const { r, fact, staged } = await readLinkAndAdd(body);
    const own = staged.payload.results[0].gedcomx.persons.find((p: any) => p.id === DECEASED).facts;
    expect(own.filter((f: any) => f.place).map((f: any) => f.standard_place)).toEqual([
      "Olne, Liège, Belgium",
      "Olne, Prince-Bishopric of Liège, Holy Roman Empire",
    ]);
    expect(fact).not.toHaveProperty("standard_place");
    expect(r.validation.warnings).toContain(
      `could not resolve standard_place for '${OLNE}' (left unset): FamilySearch standardized it differently on the record ` +
        "it cites (Olne, Liège, Belgium; Olne, Prince-Bishopric of Liège, Holy Roman Empire)",
    );
    expect(vi.mocked(searchPlace)).not.toHaveBeenCalled();
  });
});
