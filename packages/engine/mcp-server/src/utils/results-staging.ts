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
import { isInsideProject, assertInsideProject } from "./project-io.js";

/** The mandatory staging subdirectory. Invisible to the validator orphan check
 *  (which scans results/ non-recursively for top-level *.json). */
export const STAGING_SUBDIR = "results/.staging";

/** Un-finalized staging files older than this are pruned opportunistically. */
const STAGING_TTL_MS = 24 * 60 * 60 * 1000;

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
