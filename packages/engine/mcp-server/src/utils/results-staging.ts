// results-staging — the host-side payload transport for search-result sidecars
// (Option B). A search tool stages its verbatim response to results/.staging/
// and returns a small handle; research_log_append later finalizes that staged
// file into results/<log_id>.json. The big payload travels search-tool → disk →
// log-append and never round-trips through the model.
//
// Specs: search-result-staging-spec.md (producer + finalize), research-log-
// editor-spec.md §5–§6 (consumer).

import { writeFile, readFile, readdir, stat, unlink, mkdir } from "fs/promises";
import { join, resolve } from "path";
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
export async function stageSearchResults(args: {
  projectPath: string;
  tool: string;
  response: { results?: unknown[] };
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
}): Promise<{ resultsRef: string; returnedCount: number }> {
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

  return { resultsRef, returnedCount };
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
