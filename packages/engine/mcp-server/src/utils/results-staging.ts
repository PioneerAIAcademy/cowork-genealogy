// results-staging — the host-side payload transport for search-result sidecars
// (Option B). A search tool stages its verbatim response to results/.staging/
// and returns a small handle; research_log_append later finalizes that staged
// file into results/<log_id>.json. The big payload travels search-tool → disk →
// log-append and never round-trips through the model.
//
// Specs: search-result-staging-spec.md (producer + finalize), research-log-
// editor-spec.md §5–§6 (consumer).

import { writeFile, readFile, readdir, stat, unlink, mkdir } from "fs/promises";
import { join, resolve, dirname } from "path";
import { randomUUID } from "node:crypto";
import { isInsideProject, assertInsideProject, readProjectJson } from "./project-io.js";

/** The mandatory staging subdirectory. Invisible to the validator orphan check
 *  (which scans results/ non-recursively for top-level *.json). */
export const STAGING_SUBDIR = "results/.staging";

/** Un-finalized staging files older than this are pruned opportunistically. */
const STAGING_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The tools that stage, and therefore the only tools whose log entries can carry
 * a `results_ref`. Lives here rather than in `research-log-append.ts` because
 * `unloggedStagedSearches` below needs the same predicate, and a
 * `utils/` → `tools/` import is against CLAUDE.md's no-util→tool rule. The log
 * appender imports it from here; a second copy would drift.
 */
export const STAGING_CAPABLE_TOOLS = new Set([
  "record_search",
  "fulltext_search",
  "external_links_search",
]);

/**
 * The subset of STAGING_CAPABLE_TOOLS whose sidecar results carry a GedcomX
 * persona document, so `research_append`'s D2 / the validator's D5 can resolve
 * or auto-fill `record_persona_id`. A whitelist, not a blacklist: the next
 * staging producer added is treated as persona-less until it is listed here,
 * which fails safe rather than silently matching nothing on a `recordId` field
 * it does not carry (#2038). `record_search` results key on `recordId`; the
 * persona-less producers (`fulltext_search`, `external_links_search`) key on
 * `id`. Mirrors `personaReachable` in research-append.ts and `_persona_reachable`
 * in the eval harness.
 */
export const PERSONA_BEARING_PRODUCERS = new Set(["record_search"]);

export interface StagedHandle {
  resultsRef: string;
  returnedCount: number;
}

/** The on-disk staging envelope (snake_case — it is persisted project state). */
interface StagingEnvelope {
  tool: string;
  retrieved: string;
  returned_count: number;
  payload: { results?: unknown[] };
}

/**
 * Stage a search tool's verbatim `response` to results/.staging/<uuid>.json and
 * return the handle. Returns `null` for a nil search (no results) — nothing is
 * retained. Throws on an I/O failure; the caller treats that as non-fatal
 * (results still returned, `staged: null` + a stagingError note).
 */
export async function stageSearchResults<TResponse extends { results?: unknown[] }>(args: {
  projectPath: string;
  tool: string;
  // Generic, not a closed `{ results?: unknown[] }`. This function persists the
  // response verbatim (`payload: response` below) and reads only `results`, for
  // a count — the spec says it "persists exactly what it is handed and knows
  // nothing about any caller's field names" (search-result-staging-spec.md § 1).
  // A closed type contradicted that: an object literal carrying the
  // `query`/`totalMatches` keys every real caller sends failed excess-property
  // checking. Named interfaces slipped through (they are exempt from that
  // check), which is why only tests tripped it — and nothing typechecked tests.
  //
  // Two rejected alternatives: `Record<string, unknown>` demands an index
  // signature that interfaces like `FulltextSearchResponse` lack; a bare
  // `object` compiles but hides `results` from callers that legitimately read
  // the staged argument back (three external-links-search tests do).
  response: TResponse;
}): Promise<StagedHandle | null> {
  const { projectPath, tool, response } = args;
  const results = Array.isArray(response.results) ? response.results : [];
  if (results.length === 0) return null; // nil search retains nothing

  // A missing or non-directory projectPath is a staging failure (§8) — never
  // silently scaffold a bogus directory tree under a typo'd path. Throwing here
  // surfaces to the producer as `staged: null` + a stagingError note.
  let st;
  try {
    st = await stat(projectPath);
  } catch {
    throw new Error(`projectPath '${projectPath}' does not exist`);
  }
  if (!st.isDirectory()) {
    throw new Error(`projectPath '${projectPath}' is not a directory`);
  }

  const stagingDir = join(projectPath, STAGING_SUBDIR);
  await mkdir(stagingDir, { recursive: true });

  // Opportunistic prune of stale staging files (best-effort; runs before the
  // fresh write so it never deletes the file we are about to create).
  await pruneStale(stagingDir);

  const filename = `${randomUUID()}.json`;
  const envelope: StagingEnvelope = {
    tool,
    retrieved: new Date().toISOString(),
    returned_count: results.length,
    payload: response,
  };
  await writeFile(
    join(stagingDir, filename),
    JSON.stringify(envelope, null, 2),
    "utf-8",
  );

  return {
    resultsRef: `${STAGING_SUBDIR}/${filename}`,
    returnedCount: results.length,
  };
}

/**
 * Finalize a staged file into the real sidecar results/<logId>.json: guard the
 * ref, read the staged envelope, verify its tool matches the log entry, recompute
 * returned_count from the payload (authoritative), write the sidecar, and unlink
 * the staged file. A host-side byte move — the model never serializes the payload.
 *
 * @throws on a traversal/outside-staging ref, a missing/invalid staged file, a
 *   tool mismatch, or a payload with no results[] (all surfaced as log-append
 *   input errors that write nothing).
 */
export async function finalizeStagedResults(args: {
  projectPath: string;
  stagedResultsRef: string;
  logId: string;
  expectedTool: string;
}): Promise<{
  resultsRef: string;
  returnedCount: number;
  /** The producing tool's own echo of its query, when the staged payload
   *  carries one (`record_search` sets it via `echoQuery`). Lets
   *  `research_log_append` fill `query` host-side so the model never
   *  re-serializes an ARK-dense object it can only get wrong. Undefined when
   *  the payload has no `query`. */
  payloadQuery?: Record<string, unknown>;
}> {
  const { projectPath, stagedResultsRef, logId, expectedTool } = args;

  // 1. Path-traversal guard, then require the ref to live under results/.staging/.
  const abs = assertInsideProject(projectPath, stagedResultsRef);
  const stagingDir = join(projectPath, STAGING_SUBDIR);
  if (!isInsideProject(stagingDir, abs)) {
    throw new Error(
      `stagedResultsRef '${stagedResultsRef}' is not inside ${STAGING_SUBDIR}/`,
    );
  }

  // 2. Read the staged envelope.
  let envelope: StagingEnvelope;
  try {
    envelope = JSON.parse(await readFile(abs, "utf-8"));
  } catch {
    throw new Error(
      `stagedResultsRef '${stagedResultsRef}' does not exist or is invalid JSON`,
    );
  }

  // 3. Verify the staged tool matches the log entry's tool.
  if (envelope.tool !== expectedTool) {
    throw new Error(
      `staged file tool '${envelope.tool}' does not match log entry tool '${expectedTool}'`,
    );
  }

  // 4. Recompute returned_count from the payload (never trust the staged count).
  const payload = envelope.payload;
  if (!payload || !Array.isArray(payload.results)) {
    throw new Error("staged payload has no 'results' array");
  }
  const returnedCount = payload.results.length;

  // 5. Write the real sidecar.
  const resultsRef = `results/${logId}.json`;
  const sidecar = {
    log_id: logId,
    tool: envelope.tool,
    retrieved: envelope.retrieved,
    returned_count: returnedCount,
    payload,
  };
  await mkdir(join(projectPath, "results"), { recursive: true });
  await writeFile(
    join(projectPath, resultsRef),
    JSON.stringify(sidecar, null, 2),
    "utf-8",
  );

  // 6. Consume the staged file (best-effort; a lost race is harmless).
  await unlink(abs).catch(() => {});

  // The producer's echoed query, if it recorded one. Guarded on a plain object
  // so a malformed payload degrades to "no default" rather than persisting a
  // string or array into a field the schema types as an object.
  const rawQuery = (payload as { query?: unknown }).query;
  let payloadQuery: Record<string, unknown> | undefined;
  if (rawQuery !== null && typeof rawQuery === "object" && !Array.isArray(rawQuery)) {
    // `echoQuery` copies EVERY defined input, which includes plumbing the log
    // entry must not carry: `projectPath` is an absolute host path (it landed
    // in 11 of 24 entries of a real run before this filter) and `subjectId` is
    // a tree id, not a search parameter. `research.json` is shared project
    // state that moves between machines — a `/private/var/folders/...` in it is
    // meaningless anywhere else. Strip them from the DEFAULT only; a caller who
    // passes `query` explicitly still owns its contents.
    const { projectPath: _p, subjectId: _s, ...rest } = rawQuery as Record<string, unknown>;
    payloadQuery = rest;
  }

  return { resultsRef, returnedCount, payloadQuery };
}

/**
 * Emitted when this project holds staged search responses with no `research.json`
 * log entry behind them (issue #2056). `{n}` is substituted host-side.
 *
 * Mirrored byte-for-byte in `eval/harness/harness/mock_mcp.py` — grep
 * UNLOGGED_SEARCHES_NOTE to find both copies when editing either.
 */
export const UNLOGGED_SEARCHES_NOTE =
  "{n} earlier staged search response(s) in this project have no research.json log " +
  "entry: {refs}. Call `research_log_append` for each, passing that ref as " +
  "`stagedResultsRef` — the staged file holds the search's own query, so the entry " +
  "is filled in host-side and needs no reconstruction from memory. Log each as you " +
  "go rather than batching them at the end. A search with no log entry is a search " +
  "that did not happen, and the staged response is deleted 24h after it was made.";

/** How many refs the note names before it summarises the remainder. */
const UNLOGGED_REFS_SHOWN = 5;

/**
 * Render the `{refs}` slot. Mirrored in `mock_mcp.py` — a trivial join, unlike the
 * pairing rule, which the harness calls out of the compiled build rather than
 * restating.
 */
export function formatUnloggedRefs(refs: string[]): string {
  const shown = refs.slice(0, UNLOGGED_REFS_SHOWN).join(", ");
  const rest = refs.length - UNLOGGED_REFS_SHOWN;
  return rest > 0 ? `${shown}, and ${rest} more` : shown;
}

/**
 * Emitted on a `projectPath`-carrying search that returned nothing. A nil search
 * stages no file, so the note above can never see it — this is the only signal for
 * the case a reasonably exhaustive search is most obliged to record.
 *
 * The wording is load-bearing and was corrected in review. `negative` records what
 * the search RETURNED, never that the record is absent: `search-records/SKILL.md`
 * says so at `:223`, `:72` and `:593`, and this note reaches an agent that by
 * construction has not read any of them. The nils behind the motivating case were
 * an index-coverage gap (`:593`), which is exactly the reading the earlier "a nil
 * result is evidence" phrasing invited.
 *
 * Mirrored byte-for-byte in `eval/harness/harness/mock_mcp.py` — grep
 * NIL_SEARCH_NEEDS_LOG_NOTE to find both copies when editing either.
 */
export const NIL_SEARCH_NEEDS_LOG_NOTE =
  "Nothing returned, and nothing staged. A nil search is a finding and must be " +
  "recorded: log it with `research_log_append`, `outcome: \"negative\"` — which " +
  "records what the search returned, not that the record is absent — the exact " +
  "parameters used, and no `stagedResultsRef`.";

/**
 * How many staged search responses in this project have no log entry behind them
 * (issue #2056). Advisory only — the callers surface it as a model-facing note and
 * refuse nothing.
 *
 * **A leftover staged file is a candidate, not proof.** `research_log_append` only
 * WARNS when a staging-capable tool logs `results_available > 0` with no
 * `stagedResultsRef` (research-log-append.ts), so `finalizeStagedResults` never runs
 * for that entry and its staged file survives the full TTL though the search was
 * logged. Measured over the committed corpus, that is ~10% of non-nil staging-capable
 * entries — high enough that a raw file count is a nag, not a signal.
 *
 * So each staged file consumes at most one *unattached* log entry of the same tool
 * whose `performed` is at or after the file's `retrieved`; only unpaired files count.
 * Count subtraction is wrong here and was the first design: the unattached population
 * also contains searches that ran with no `projectPath` at all, which stage nothing,
 * so subtracting the whole set silently zeroes a real backlog.
 *
 * **Returns the unpaired handles, not a count.** The backlog exists precisely
 * because the session lost track of its refs, so a note that says "pass the
 * `staged.resultsRef` that search returned" asks for something the agent no longer
 * has. Its cheapest escape then is to log WITHOUT the ref and hand-transcribe
 * `query` — a 20%-failure-rate transcription (`research-log-append.ts`), and an
 * entry of exactly the shape the pairing below tolerates, so the count would drop
 * to zero while the raw response was lost for good. Handing back the refs makes the
 * obligation satisfiable from disk, and `research_log_append` then fills `query`
 * from the staged payload verbatim.
 *
 * Never throws, and returns an empty array on any failure — a missing project,
 * unreadable research.json, corrupt envelope. This runs inside a successful search;
 * a project-state read that cannot complete must not turn that search into an error
 * (same reasoning as record-search.ts's silent tree read).
 */
export interface UnloggedStagedSearch {
  /** Project-relative ref, ready to pass back as `stagedResultsRef`. */
  ref: string;
  tool: string;
  /** ISO timestamp from the staged envelope. */
  retrieved: string;
}

export async function unloggedStagedSearches(
  projectPath: string,
): Promise<UnloggedStagedSearch[]> {
  // An explicit `projectPath: null` reaches here: all three callers gate on
  // `!== undefined`, and `join(null, …)` is a raw TypeError, which would turn an
  // already-successful search into a failure — the one thing the docstring above
  // promises cannot happen. Guarded here rather than at the three call sites so a
  // fourth caller inherits it. `""` is folded in for the same reason
  // `stageSearchResults` treats a bogus path as a staging failure rather than
  // scaffolding one.
  if (typeof projectPath !== "string" || projectPath === "") return [];

  const stagingDir = join(projectPath, STAGING_SUBDIR);

  let names: string[];
  try {
    names = (await readdir(stagingDir)).filter((n) => n.endsWith(".json"));
  } catch {
    return []; // no staging dir yet — nothing staged, nothing owed
  }
  if (names.length === 0) return [];

  // Same cutoff `pruneStale` uses, but do NOT read this as "about to be deleted":
  // `pruneStale` is called from one place — inside `stageSearchResults`, AFTER its
  // nil early-return — so a stale file survives any number of nil searches and is
  // swept only by the next search that actually stages. The cutoff is here because
  // a file past the TTL is past the window in which finalizing it is guaranteed to
  // work, not because deletion is imminent.
  const cutoff = Date.now() - STAGING_TTL_MS;
  const staged: { ref: string; tool: string; retrieved: number; iso: string }[] = [];
  for (const n of names) {
    const p = resolve(stagingDir, n);
    try {
      const s = await stat(p);
      if (s.mtimeMs < cutoff) continue;
      const envelope = JSON.parse(await readFile(p, "utf-8")) as StagingEnvelope;
      const parsed = Date.parse(envelope.retrieved);
      const fallback = Number.isNaN(parsed);
      staged.push({
        ref: `${STAGING_SUBDIR}/${n}`,
        tool: typeof envelope.tool === "string" ? envelope.tool : "",
        // mtime is the fallback for an envelope whose `retrieved` is missing or
        // unparseable: it is the same clock, one write later.
        retrieved: fallback ? s.mtimeMs : parsed,
        iso: fallback ? new Date(s.mtimeMs).toISOString() : envelope.retrieved,
      });
    } catch {
      continue; // unreadable or corrupt: not counted, never fatal
    }
  }
  if (staged.length === 0) return [];

  let research: unknown;
  try {
    research = await readProjectJson(projectPath, "research.json");
  } catch {
    return [];
  }
  const log = (research as { log?: unknown })?.log;
  const unattached = (Array.isArray(log) ? log : [])
    .filter(
      (e): e is { tool: string; performed: string } =>
        !!e &&
        typeof e === "object" &&
        STAGING_CAPABLE_TOOLS.has((e as { tool?: unknown }).tool as string) &&
        typeof (e as { results_available?: unknown }).results_available === "number" &&
        ((e as { results_available: number }).results_available as number) > 0 &&
        !(e as { results_ref?: unknown }).results_ref,
    )
    .map((e) => ({ tool: e.tool, performed: Date.parse(e.performed) }))
    .filter((e) => !Number.isNaN(e.performed))
    .sort((a, b) => a.performed - b.performed);

  // Oldest file first against oldest eligible entry, so one late entry cannot
  // absorb the pairing an earlier file had a better claim to.
  staged.sort((a, b) => a.retrieved - b.retrieved);
  const consumed = new Array<boolean>(unattached.length).fill(false);
  const unpaired: UnloggedStagedSearch[] = [];
  for (const file of staged) {
    const i = unattached.findIndex(
      (e, idx) => !consumed[idx] && e.tool === file.tool && e.performed >= file.retrieved,
    );
    if (i === -1) unpaired.push({ ref: file.ref, tool: file.tool, retrieved: file.iso });
    else consumed[i] = true;
  }
  return unpaired;
}

async function pruneStale(stagingDir: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(stagingDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - STAGING_TTL_MS;
  await Promise.all(
    names
      .filter((n) => n.endsWith(".json"))
      .map(async (n) => {
        const p = resolve(stagingDir, n);
        try {
          const s = await stat(p);
          if (s.mtimeMs < cutoff) await unlink(p);
        } catch {
          // best-effort: ignore ENOENT / races / stat failures
        }
      }),
  );
}

/**
 * Read a staged/finalized sidecar's `payload.results` array (read-only — NEVER
 * unlinks, so a staged handle can still be finalized afterward). Accepts EITHER
 * a staged handle under `results/.staging/` OR a finalized top-level
 * `results/<log_id>.json` sidecar — both envelope shapes expose `payload.results`.
 * Shared by `rank_search_matches` and `record_read`'s sidecar mode; callers cast
 * the elements to their own result type.
 */
export async function readStagedResults(
  projectPath: string,
  stagedResultsRef: string,
): Promise<unknown[]> {
  const abs = assertInsideProject(projectPath, stagedResultsRef);
  const stagingDir = join(projectPath, STAGING_SUBDIR);
  const resultsDir = resolve(projectPath, "results");
  const underStaging = isInsideProject(stagingDir, abs);
  const topLevelSidecar = dirname(abs) === resultsDir && abs.endsWith(".json");
  if (!underStaging && !topLevelSidecar) {
    throw new Error(
      `stagedResultsRef '${stagedResultsRef}' must be a staged handle under ` +
        `${STAGING_SUBDIR}/ or a finalized results/<log_id>.json sidecar.`,
    );
  }
  let envelope: { payload?: { results?: unknown[] } };
  try {
    envelope = JSON.parse(await readFile(abs, "utf-8"));
  } catch {
    throw new Error(
      `stagedResultsRef '${stagedResultsRef}' does not exist or is invalid JSON.`,
    );
  }
  const results = envelope?.payload?.results;
  if (!Array.isArray(results)) {
    throw new Error(
      `stagedResultsRef '${stagedResultsRef}' envelope has no payload.results array.`,
    );
  }
  return results;
}
