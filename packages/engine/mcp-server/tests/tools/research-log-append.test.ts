import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { single } from "../helpers/narrow.js";
import { mkdtemp, writeFile, readFile, rm, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { researchLogAppend } from "../../src/tools/research-log-append.js";
import { stageSearchResults, STAGING_SUBDIR } from "../../src/utils/results-staging.js";
import { validateProject } from "../../src/validation/validator.js";

function baseResearch(log: any[] = []) {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [],
    plans: [],
    log,
    sources: [],
    assertions: [],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
  };
}
const minimalTree = { persons: [], relationships: [], sources: [] };

function logEntry(n: number) {
  return {
    id: `log_${String(n).padStart(3, "0")}`,
    plan_item_id: null,
    performed: "2026-01-01T00:00:00.000Z",
    tool: "record_search",
    query: {},
    outcome: "negative",
    results_examined: 0,
    external_site: null,
    results_ref: null,
  };
}

describe("research_log_append", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "log-append-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(research: any, tree: any = minimalTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readJson = async (name: string) => JSON.parse(await readFile(join(dir, name), "utf-8"));
  const exists = async (rel: string) => access(join(dir, rel)).then(() => true, () => false);

  it("defaults `query` from the staged payload when the caller omits it", async () => {
    await writeProject(baseResearch());
    const echoed = { surname: "Stephens", residencePlace: "Shelby, Tennessee, United States" };
    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: { query: echoed, results: [{ recordId: "A" }] },
    });

    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      // no `query` — the staged payload already carries the producing tool's echo
      outcome: "positive",
      resultsExamined: 1,
      planItemId: "pli_001",
      stagedResultsRef: handle!.resultsRef,
    } as any);

    expect(result.ok).toBe(true);
    const research = await readJson("research.json");
    expect(research.log[0].query).toEqual(echoed);
  });

  it("finalizes a staged image_transcribe transcription — a one-element results[] — into the sidecar (#2048)", async () => {
    // The acquisition producers stage through the search channel unchanged: one
    // element, `returned_count` recomputed to 1, the staged file consumed, and the
    // log entry's `query` filled from the envelope (no re-serialization by the model).
    await writeProject(baseResearch());
    const element = {
      id: "capture:obit",
      source: { file: "uploads/obit.jpg" },
      content_type: "image/jpeg",
      size_bytes: 46767,
      model: "google/gemini-3.7-flash",
      transcription: "Obituary of David Albert Mays, b. 1851",
      found: "FOUND",
    };
    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "image_transcribe",
      response: { query: { file: "uploads/obit.jpg", lookingFor: "Mays" }, results: [element] },
    });
    expect(handle).not.toBeNull();

    const result = await researchLogAppend({
      projectPath: dir,
      tool: "image_transcribe",
      outcome: "positive",
      resultsExamined: 1,
      planItemId: "pli_001",
      stagedResultsRef: handle!.resultsRef,
    } as any);

    expect(result.ok).toBe(true);
    if (!result.ok || !("logId" in result)) throw new Error("expected a single-op success");
    expect(result.returnedCount).toBe(1);
    const research = await readJson("research.json");
    expect(research.log[0].tool).toBe("image_transcribe");
    expect(research.log[0].results_ref).toBe(`results/${result.logId}.json`);
    expect(research.log[0].query).toEqual({ file: "uploads/obit.jpg", lookingFor: "Mays" });
    const sidecar = await readJson(`results/${result.logId}.json`);
    expect(sidecar.tool).toBe("image_transcribe");
    expect(sidecar.returned_count).toBe(1);
    expect(sidecar.payload.results).toEqual([element]);
    expect(await exists(handle!.resultsRef)).toBe(false); // consumed
  });

  it("prefers an explicit `query` over the staged payload's echo", async () => {
    await writeProject(baseResearch());
    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: { query: { surname: "FromPayload" }, results: [{ recordId: "A" }] },
    });

    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: { surname: "FromCaller" },
      outcome: "positive",
      resultsExamined: 1,
      planItemId: "pli_001",
      stagedResultsRef: handle!.resultsRef,
    });

    expect(result.ok).toBe(true);
    const research = await readJson("research.json");
    expect(research.log[0].query).toEqual({ surname: "FromCaller" });
  });

  it("strips projectPath/subjectId from the defaulted query — they are host plumbing", async () => {
    await writeProject(baseResearch());
    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: {
        // echoQuery copies EVERY defined input, plumbing included.
        query: { surname: "Grice", projectPath: "/private/var/folders/tv/xyz", subjectId: "I1" },
        results: [{ recordId: "A" }],
      },
    });

    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      outcome: "positive",
      resultsExamined: 1,
      planItemId: "pli_001",
      stagedResultsRef: handle!.resultsRef,
    } as any);

    expect(result.ok).toBe(true);
    const research = await readJson("research.json");
    // research.json travels between machines; an absolute host path in it is
    // meaningless anywhere else.
    expect(research.log[0].query).toEqual({ surname: "Grice" });
  });

  it("unlinks the sidecar when the single-op form throws after finalizing it", async () => {
    await writeProject(baseResearch());
    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_read",
      // No `query` in the payload, so nothing can default it → the op throws
      // AFTER the sidecar has been finalized.
      response: { results: [{ recordId: "A" }] },
    });

    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_read",
      outcome: "positive",
      resultsExamined: 1,
      planItemId: "pli_001",
      stagedResultsRef: handle!.resultsRef,
    } as any);

    expect(result.ok).toBe(false);
    // The sidecar must NOT survive: nothing in research.json references it, the
    // staged file it came from is already unlinked, and the next
    // validate_research_schema hard-fails on an orphan with no way to recover.
    expect(await exists("results/log_001.json")).toBe(false);
    const research = await readJson("research.json");
    expect(research.log).toEqual([]);
  });

  it("fails loudly when `query` is omitted and nothing staged supplies one", async () => {
    await writeProject(baseResearch());

    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_read",
      outcome: "positive",
      resultsExamined: 1,
      planItemId: "pli_001",
    } as any);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/`query` is required/);
    // nothing persisted
    const research = await readJson("research.json");
    expect(research.log).toEqual([]);
  });

  it("appends a positive search with a finalized sidecar (staging round-trip)", async () => {
    await writeProject(baseResearch());
    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: { query: { surname: "Smith" }, results: [{ recordId: "A" }, { recordId: "B" }] },
    });

    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: { surname: "Smith" },
      outcome: "positive",
      resultsExamined: 2,
      planItemId: "pli_001",
      stagedResultsRef: handle!.resultsRef,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(single(result).logId).toBe("log_001");
    expect(single(result).resultsRef).toBe("results/log_001.json");
    expect(single(result).returnedCount).toBe(2);
    expect(result.filesWritten).toEqual(["research.json", "results/log_001.json"]);

    // sidecar materialized; staged file consumed.
    const sidecar = await readJson("results/log_001.json");
    expect(sidecar).toMatchObject({ log_id: "log_001", returned_count: 2 });
    expect(await exists(handle!.resultsRef)).toBe(false);

    // entry persisted in snake_case.
    const research = await readJson("research.json");
    expect(research.log).toHaveLength(1);
    expect(research.log[0]).toMatchObject({
      id: "log_001",
      plan_item_id: "pli_001",
      results_examined: 2,
      results_ref: "results/log_001.json",
    });

    // project still validates.
    expect((await validateProject(dir)).valid).toBe(true);
  });

  it("logs a nil search with no sidecar", async () => {
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: {},
      outcome: "negative",
      resultsExamined: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(single(result).resultsRef).toBeNull();
    expect(single(result).returnedCount).toBeNull();
    expect(result.filesWritten).toEqual(["research.json"]);
    const research = await readJson("research.json");
    expect(research.log[0].results_ref).toBeNull();
  });

  it("logs an external-site search and rejects when externalSite is missing", async () => {
    await writeProject(baseResearch());
    const ok = await researchLogAppend({
      projectPath: dir,
      tool: "external_site",
      query: { url: "https://ancestry.com/search" },
      outcome: "partial",
      resultsExamined: 3,
      externalSite: { site: "ancestry", urlGenerated: "https://ancestry.com/search", captureReceived: false },
    });
    expect(ok.ok).toBe(true);
    const research = await readJson("research.json");
    expect(research.log[0].external_site).toEqual({
      site: "ancestry",
      url_generated: "https://ancestry.com/search",
      capture_received: false,
    });

    // missing externalSite for an external_site tool → input error.
    const bad = await researchLogAppend({
      projectPath: dir,
      tool: "external_site",
      query: {},
      outcome: "negative",
      resultsExamined: 0,
    });
    expect(bad.ok).toBe(false);
  });

  it("rejects externalSite supplied for a non-external_site tool", async () => {
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: {},
      outcome: "negative",
      resultsExamined: 0,
      externalSite: { site: "ancestry", urlGenerated: "x", captureReceived: false },
    });
    expect(result.ok).toBe(false);
  });

  it("coerces a stringified externalSite and query back into objects", async () => {
    // Some models emit nested-object args as JSON strings; the tool should
    // parse them rather than fail with "externalSite.site 'undefined'".
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "external_site",
      query: JSON.stringify({ surname: "Flynn", birthplace: "Pennsylvania" }) as any,
      outcome: "partial",
      resultsExamined: 0,
      externalSite: JSON.stringify({
        site: "ancestry",
        urlGenerated: "https://ancestry.com/search?name=Flynn",
        captureReceived: false,
      }) as any,
    });
    expect(result.ok).toBe(true);
    const research = await readJson("research.json");
    expect(research.log[0].external_site).toEqual({
      site: "ancestry",
      url_generated: "https://ancestry.com/search?name=Flynn",
      capture_received: false,
    });
    expect(research.log[0].query).toEqual({ surname: "Flynn", birthplace: "Pennsylvania" });
  });

  it("returns a clear error when a stringified externalSite is not valid JSON", async () => {
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "external_site",
      query: {},
      outcome: "partial",
      resultsExamined: 0,
      externalSite: "site=ancestry" as any,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/externalSite must be an object/);
  });

  it('coerces a literal "null" planItemId string back to null', async () => {
    // Some models emit planItemId as the string "null" instead of JSON null;
    // stored verbatim it fails id-reference validation
    // ("plan_item_id 'null' not found"). The tool should persist it as null.
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: { surname: "Flynn" },
      outcome: "negative",
      resultsExamined: 0,
      planItemId: "null" as any,
    });
    expect(result.ok).toBe(true);
    const research = await readJson("research.json");
    expect(research.log[0].plan_item_id).toBeNull();
    expect((await validateProject(dir)).valid).toBe(true);
  });

  it('treats a literal "null" on every nullable arg the way JSON null is treated', async () => {
    // The same models that send planItemId: "null" send it on its siblings, and
    // there the cost is higher: each of these carries a validator, so before the
    // shared mapping a single stringly-typed argument refused the WHOLE append.
    // resultsAvailable failed the non-negative-integer bound, stagedResultsRef
    // failed the staging-path check, and externalSite failed coerceObjectArg —
    // discarding the entry the caller actually wrote. Fixing planItemId alone
    // was the same class the integer bound itself had to be widened for.
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: { surname: "Flynn" },
      outcome: "negative",
      resultsExamined: 0,
      resultsAvailable: "null" as any,
      stagedResultsRef: "null" as any,
      externalSite: "null" as any,
    });
    expect(result.ok).toBe(true);
    const research = await readJson("research.json");
    // Identical to JSON null: the field is absent, not present-and-null. Writing
    // an explicit null would make "null" behave differently from null.
    expect(research.log[0].results_available).toBeUndefined();
    expect(research.log[0].results_ref).toBeNull();
    expect((await validateProject(dir)).valid).toBe(true);
  });

  it("still rejects a genuinely invalid resultsAvailable", async () => {
    // The other direction: the "null" mapping must not widen the bound itself.
    await writeProject(baseResearch());
    for (const bad of ["abc", -1, 1.5]) {
      const result = await researchLogAppend({
        projectPath: dir,
        tool: "record_search",
        query: { surname: "Flynn" },
        outcome: "negative",
        resultsExamined: 0,
        resultsAvailable: bad as any,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.join(" ")).toMatch(/resultsAvailable must be a non-negative integer/);
    }
  });

  it("rejects a non-pli_ planItemId (e.g. a question id) with an actionable error", async () => {
    // Models sometimes stuff a question id (q_...) or free text into planItemId.
    // Persisted verbatim it silently fails the JSON-Schema validator downstream
    // (hard fail). Reject it at the boundary so the caller can supply a pli_ or
    // null — do NOT silently null it (that would discard the caller's intent).
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: { surname: "Flynn" },
      outcome: "negative",
      resultsExamined: 0,
      planItemId: "q_001" as any,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/planItemId 'q_001'/);
    expect(result.errors.join(" ")).toMatch(/pli_/);
    // nothing persisted on rejection
    const research = await readJson("research.json");
    expect(research.log).toHaveLength(0);
  });

  it("rejects an external_links_search entry logged negative despite returning results", async () => {
    // This entry grades the curated-links FETCH, not the search: a model
    // that recognizes none of the returned links fit the target site/record
    // type has been observed logging outcome "negative" anyway — collapsing
    // "FamilySearch curates nothing here" and "curates plenty, none
    // relevant" into the same value, which loses the distinction permanently
    // in the audit trail. Enforced here rather than left to the model, since
    // it was a repeat, measured miss in practice.
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "external_links_search",
      query: { standardPlace: "Pennsylvania, United States", host: "findagrave.com" },
      outcome: "negative",
      resultsExamined: 2,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/outcome must be 'positive'/);
    const research = await readJson("research.json");
    expect(research.log).toHaveLength(0);
  });

  it("accepts an external_links_search entry logged positive when it returned results", async () => {
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "external_links_search",
      query: { standardPlace: "Pennsylvania, United States", host: "findagrave.com" },
      outcome: "positive",
      resultsExamined: 2,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts an external_links_search entry logged negative when it genuinely returned nothing", async () => {
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "external_links_search",
      query: { standardPlace: "Pennsylvania, United States", host: "findagrave.com" },
      outcome: "negative",
      resultsExamined: 0,
    });
    expect(result.ok).toBe(true);
  });

  it.each([NaN, -3, 1.5])(
    "rejects resultsExamined=%s instead of silently bypassing the outcome check (review finding)",
    async (bad) => {
      // NaN and negative values both make `resultsExamined > 0` false in JS,
      // so the outcome-consistency check above silently passed a bad
      // outcome/resultsExamined pair through — this must be caught before
      // that check ever runs.
      await writeProject(baseResearch());
      const result = await researchLogAppend({
        projectPath: dir,
        tool: "external_links_search",
        query: { standardPlace: "Pennsylvania, United States", host: "findagrave.com" },
        outcome: "negative",
        resultsExamined: bad,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.join(" ")).toMatch(/resultsExamined must be a non-negative integer/);
      const research = await readJson("research.json");
      expect(research.log).toEqual([]);
    },
  );

  it.each([NaN, -3, 1.5])(
    "rejects resultsAvailable=%s, the same bound its sibling gets (review round 5)",
    async (bad) => {
      // The schema declares `results_available` as `integer, minimum: 0`, and
      // `validator.ts` carried it in field-name allow-lists with no type check
      // — so NaN (which persists as `null`), a negative or a fraction reached
      // the document unchallenged. Guarding `results_examined` and not this was
      // the second instance of one class; CLAUDE.md asks for one shared guard.
      await writeProject(baseResearch());
      const result = await researchLogAppend({
        projectPath: dir,
        tool: "record_search",
        query: { surname: "Flynn" },
        outcome: "positive",
        resultsExamined: 3,
        resultsAvailable: bad,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.join(" ")).toMatch(/resultsAvailable must be a non-negative integer/);
      const research = await readJson("research.json");
      expect(research.log).toEqual([]);
    },
  );

  it("still accepts a null and an omitted resultsAvailable, which the schema allows", async () => {
    await writeProject(baseResearch());
    for (const value of [null, undefined]) {
      const result = await researchLogAppend({
        projectPath: dir,
        tool: "record_search",
        query: { surname: "Flynn" },
        outcome: "positive",
        resultsExamined: 3,
        ...(value === undefined ? {} : { resultsAvailable: value }),
      });
      expect(result.ok).toBe(true);
    }
  });

  it("coerces a stringified resultsExamined the way resultsAvailable already is, rather than rejecting it", async () => {
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: { surname: "Flynn" },
      outcome: "negative",
      resultsExamined: "5" as any,
    });
    expect(result.ok).toBe(true);
    const research = await readJson("research.json");
    expect(research.log[0].results_examined).toBe(5);
  });

  it("rejects an externalSite.urlGenerated that is not an absolute http(s) URL (review finding)", async () => {
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "external_site",
      query: { name: "Patrick Flynn" },
      outcome: "partial",
      resultsExamined: 0,
      externalSite: { site: "ancestry", urlGenerated: "javascript:alert(1)", captureReceived: false, captureFilename: null },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/urlGenerated .* is not an absolute http\(s\) URL/);
    const research = await readJson("research.json");
    expect(research.log).toEqual([]);
  });

  it("accepts a null planItemId (opportunistic search) and a valid pli_ id", async () => {
    await writeProject(baseResearch());
    const optOut = await researchLogAppend({
      projectPath: dir, tool: "record_search", query: { surname: "Flynn" },
      outcome: "negative", resultsExamined: 0, planItemId: null,
    });
    expect(optOut.ok).toBe(true);
    const withPli = await researchLogAppend({
      projectPath: dir, tool: "record_search", query: { surname: "Flynn" },
      outcome: "negative", resultsExamined: 0, planItemId: "pli_007",
    });
    expect(withPli.ok).toBe(true);
    const research = await readJson("research.json");
    expect(research.log.map((e: any) => e.plan_item_id)).toEqual([null, "pli_007"]);
  });

  it("assigns the next id as max + 1, not count + 1", async () => {
    // log_001..log_003 then a gap to log_009 → next is log_010.
    const log = [logEntry(1), logEntry(2), logEntry(3), logEntry(9)];
    await writeProject(baseResearch(log));
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: {},
      outcome: "negative",
      resultsExamined: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(single(result).logId).toBe("log_010");
  });

  it("is append-only: existing entries are byte-unchanged", async () => {
    const log = [logEntry(1), logEntry(2)];
    await writeProject(baseResearch(log));
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: {},
      outcome: "negative",
      resultsExamined: 0,
    });
    expect(result.ok).toBe(true);
    const research = await readJson("research.json");
    expect(research.log.slice(0, 2)).toEqual(log);
    expect(research.log).toHaveLength(3);
  });

  it("a pre-existing unrelated error rides as a warning and does not block the append (#1572)", async () => {
    // subject_person_ids points at a person absent from the tree — a pre-existing
    // project error this append never touches. Before #1572 it froze the append
    // (and every other writing tool); now the append succeeds and the drift is
    // surfaced as a warning, not a block. Rollback + sidecar cleanup on a GENUINE
    // (call-introduced) failure is covered by the batch invalid-outcome test below.
    const research = baseResearch();
    (research.project as any).subject_person_ids = ["GHOST"];
    await writeProject(research);

    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: { results: [{ recordId: "A" }] },
    });

    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: {},
      outcome: "positive",
      resultsExamined: 1,
      stagedResultsRef: handle!.resultsRef,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The pre-existing drift is surfaced as a summary line (count + pointer),
    // not swallowed and not a per-error wall.
    expect(result.validation.warnings.join(" ")).toMatch(/1 pre-existing schema error/);
    expect(result.validation.warnings.join(" ")).toMatch(/validate_research_schema/);
    // ...and the entry was written with its sidecar finalized, not rolled back.
    expect((await readJson("research.json")).log).toHaveLength(1);
    expect(await exists("results/log_001.json")).toBe(true);
  });

  it("rejects a stagedResultsRef outside results/.staging/", async () => {
    await writeProject(baseResearch());
    // A staged-looking file at the project root (not under results/.staging/).
    await writeFile(join(dir, "loose.json"), "{}", "utf-8");
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: {},
      outcome: "positive",
      resultsExamined: 1,
      stagedResultsRef: "loose.json",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/not inside results\/\.staging/);
  });

  it("leaves an un-finalized staged file invisible to the validator orphan check", async () => {
    await writeProject(baseResearch());
    await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: { results: [{ recordId: "A" }] },
    });
    // A staged file exists under results/.staging/ but is referenced by no log
    // entry; the orphan check (top-level, non-recursive) must not flag it.
    expect(await exists(STAGING_SUBDIR)).toBe(true);
    const result = await validateProject(dir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // ── Batch form (`ops[]`) — mirrors materialize-facts.test.ts/tree-edit.test.ts's batch suites ──

  it("(batch) logs multiple entries in one validate-once/write-once call", async () => {
    await writeProject(baseResearch());
    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: { results: [{ recordId: "A" }] },
    });

    const result = await researchLogAppend({
      projectPath: dir,
      ops: [
        { tool: "record_search", query: { surname: "Flynn" }, outcome: "negative", resultsExamined: 0 },
        {
          tool: "record_search",
          query: { surname: "Smith" },
          outcome: "positive",
          resultsExamined: 1,
          stagedResultsRef: handle!.resultsRef,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !("results" in result)) return;
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ logId: "log_001", resultsRef: null });
    expect(result.results[1]).toMatchObject({ logId: "log_002", resultsRef: "results/log_002.json" });
    expect(result.filesWritten).toEqual(["research.json", "results/log_002.json"]);

    const research = await readJson("research.json");
    expect(research.log).toHaveLength(2);
    expect(research.log[1].results_ref).toBe("results/log_002.json");
    expect((await validateProject(dir)).valid).toBe(true);
  });

  it("(batch) all-or-nothing: op[1] failing writes NOTHING and cleans up op[0]'s sidecar", async () => {
    await writeProject(baseResearch());
    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: { results: [{ recordId: "A" }] },
    });
    const before = await readFile(join(dir, "research.json"), "utf-8");

    const result = await researchLogAppend({
      projectPath: dir,
      ops: [
        {
          tool: "record_search",
          query: {},
          outcome: "positive",
          resultsExamined: 1,
          stagedResultsRef: handle!.resultsRef,
        }, // op 0: stages a real sidecar
        { tool: "record_search", query: {}, outcome: "not-a-real-outcome", resultsExamined: 0 }, // op 1: invalid outcome
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/^ops\[1\]:/);
    // Nothing written to research.json...
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
    // ...and op 0's sidecar (already written to disk before op 1 ran) is cleaned up too —
    // not just "the failing op's own" sidecar.
    expect(await exists("results/log_001.json")).toBe(false);
  });

  it("(batch) id-allocator continuity: three entries in one call get sequential ids", async () => {
    await writeProject(baseResearch([logEntry(1)]));
    const result = await researchLogAppend({
      projectPath: dir,
      ops: [
        { tool: "record_search", query: {}, outcome: "negative", resultsExamined: 0 },
        { tool: "record_search", query: {}, outcome: "negative", resultsExamined: 0 },
        { tool: "record_search", query: {}, outcome: "negative", resultsExamined: 0 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !("results" in result)) return;
    expect(result.results.map((r) => r.logId)).toEqual(["log_002", "log_003", "log_004"]);
  });

  it("(batch) a JSON-stringified `ops` array is coerced", async () => {
    await writeProject(baseResearch());
    const opsArray = [{ tool: "record_search", query: {}, outcome: "negative", resultsExamined: 0 }];
    const result = await researchLogAppend({ projectPath: dir, ops: JSON.stringify(opsArray) as any });
    expect(result.ok).toBe(true);
    if (!result.ok || !("results" in result)) return;
    expect(result.results).toHaveLength(1);
  });

  it("(batch) rejects an empty ops array", async () => {
    await writeProject(baseResearch());
    const result = await researchLogAppend({ projectPath: dir, ops: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/non-empty/);
  });

  // Retention gap: a staging-capable search that HAD results and kept none.
  // Observed across 10 alpha feedback bundles (2026-08-05..08-07): 16 of 32
  // logged record_search entries had results_available > 0 and results_ref null,
  // so the verbatim response was unrecoverable at triage time.
  describe("unretained-results warning", () => {
    const warnOf = (r: any) => (r.ok ? r.validation.warnings.join(" ") : "");

    it("warns when a search reports available results but retains none", async () => {
      await writeProject(baseResearch());
      const result = await researchLogAppend({
        projectPath: dir,
        tool: "record_search",
        query: { surname: "Ward" },
        outcome: "positive",
        resultsExamined: 5,
        resultsAvailable: 42,
        planItemId: null,
      });

      expect(result.ok).toBe(true);
      expect(warnOf(result)).toMatch(/retained none/);
      expect(warnOf(result)).toMatch(/log_001/);
      // The entry is still written — the warning must not cost the log line.
      const research = await readJson("research.json");
      expect(research.log).toHaveLength(1);
      expect(research.log[0].results_ref).toBeNull();
    });

    it("stays silent for a nil search — nothing was available to retain", async () => {
      await writeProject(baseResearch());
      const result = await researchLogAppend({
        projectPath: dir,
        tool: "record_search",
        query: { surname: "Nobody" },
        outcome: "negative",
        resultsExamined: 0,
        resultsAvailable: 0,
        planItemId: null,
      });

      expect(result.ok).toBe(true);
      expect(warnOf(result)).not.toMatch(/retained none/);
    });

    it("stays silent when resultsAvailable is absent", async () => {
      await writeProject(baseResearch());
      const result = await researchLogAppend({
        projectPath: dir,
        tool: "record_search",
        query: { surname: "Unknown" },
        outcome: "negative",
        resultsExamined: 0,
        planItemId: null,
      });

      expect(result.ok).toBe(true);
      expect(warnOf(result)).not.toMatch(/retained none/);
    });

    it("stays silent when the results were staged and retained", async () => {
      await writeProject(baseResearch());
      const handle = await stageSearchResults({
        projectPath: dir,
        tool: "record_search",
        response: { query: { surname: "Ward" }, results: [{ recordId: "A" }] },
      });

      const result = await researchLogAppend({
        projectPath: dir,
        tool: "record_search",
        outcome: "positive",
        resultsExamined: 1,
        resultsAvailable: 42,
        planItemId: null,
        stagedResultsRef: handle!.resultsRef,
      } as any);

      expect(result.ok).toBe(true);
      expect(warnOf(result)).not.toMatch(/retained none/);
    });

    it("stays silent for a non-staging tool", async () => {
      // `record_read` was this test's example until it became a staging producer
      // (#2048); `person_read` stages nothing and never will — a tree read has
      // no sidecar.
      await writeProject(baseResearch());
      const result = await researchLogAppend({
        projectPath: dir,
        tool: "person_read",
        query: { personId: "KWCJ-RN4" },
        outcome: "positive",
        resultsExamined: 1,
        resultsAvailable: 1,
        planItemId: null,
      });

      expect(result.ok).toBe(true);
      expect(warnOf(result)).not.toMatch(/retained none/);
    });

    it("warns for image_transcribe and record_read too — the two acquisition producers stage now (#2048)", async () => {
      for (const [tool, query] of [
        ["image_transcribe", { imageArk: "ark:/61903/3:1:XXXX-XXX" }],
        ["record_read", { recordId: "ark:/61903/1:1:XXXX-XXX" }],
      ] as const) {
        await writeProject(baseResearch());
        const result = await researchLogAppend({
          projectPath: dir,
          tool,
          query,
          outcome: "positive",
          resultsExamined: 1,
          resultsAvailable: 1,
          planItemId: null,
        });
        expect(result.ok).toBe(true);
        expect(warnOf(result)).toMatch(new RegExp(`${tool} reported 1 available result\\(s\\) but retained none`));
      }
    });

    it("(batch) surfaces one warning per offending op", async () => {
      await writeProject(baseResearch());
      const result = await researchLogAppend({
        projectPath: dir,
        ops: [
          {
            tool: "record_search",
            query: { surname: "A" },
            outcome: "positive",
            resultsExamined: 2,
            resultsAvailable: 10,
            planItemId: null,
          },
          {
            tool: "fulltext_search",
            query: { text: "B" },
            outcome: "positive",
            resultsExamined: 3,
            resultsAvailable: 7,
            planItemId: null,
          },
          {
            tool: "record_search",
            query: { surname: "C" },
            outcome: "negative",
            resultsExamined: 0,
            resultsAvailable: 0,
            planItemId: null,
          },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const retention = result.validation.warnings.filter((w) => /retained none/.test(w));
      expect(retention).toHaveLength(2);
      expect(retention[0]).toMatch(/log_001/);
      expect(retention[1]).toMatch(/log_002/);
    });
  });
});

describe("research_log_append — logging-without-persistence nudge (#1478)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "log-append-1478-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const write = async (research: any, tree: any = minimalTree) => {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  };
  const pos = (n: number) => ({ ...logEntry(n), outcome: "positive" });
  const warnOf = (r: any) => (r.ok ? r.validation.warnings.join(" ") : "");
  const NUDGE = /logged with a positive outcome but no sources or assertions/;

  it("warns once ≥3 positive searches are logged with no sources or assertions", async () => {
    // Two positive searches already logged; this call makes the third.
    await write(baseResearch([pos(1), pos(2)]));
    const r = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: { surname: "Ashby" },
      outcome: "positive",
      resultsExamined: 1,
      planItemId: null,
    });
    expect(r.ok).toBe(true);
    expect(warnOf(r)).toMatch(NUDGE);
    expect(warnOf(r)).toContain("3 search(es)");
    // never blocks: the log entry still lands
    const research = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
    expect(research.log).toHaveLength(3);
  });

  it("stays silent below the threshold", async () => {
    await write(baseResearch([pos(1)]));
    const r = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: { surname: "Ashby" },
      outcome: "positive",
      resultsExamined: 1,
      planItemId: null,
    });
    expect(r.ok).toBe(true);
    expect(warnOf(r)).not.toMatch(NUDGE);
  });

  it("stays silent once a source has been persisted", async () => {
    const validSource = {
      id: "src_001",
      gedcomx_source_description_id: "SD-001",
      citation: "1850 U.S. Census",
      citation_detail: {
        who: "Census enumerator",
        what: "1850 U.S. Census",
        when_created: "1850",
        when_accessed: "2026-01-01",
        where: "Schuylkill County, Pennsylvania",
        where_within: "dwelling 201",
      },
      source_classification: "original",
      repository: "NARA",
      access_date: "2026-01-01",
    };
    const treeWithSD = { persons: [], relationships: [], sources: [{ id: "SD-001", title: "1850 U.S. Census" }] };
    await write({ ...baseResearch([pos(1), pos(2), pos(3)]), sources: [validSource] }, treeWithSD);
    const r = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: { surname: "Ashby" },
      outcome: "positive",
      resultsExamined: 1,
      planItemId: null,
    });
    expect(r.ok).toBe(true);
    expect(warnOf(r)).not.toMatch(NUDGE);
  });
});
