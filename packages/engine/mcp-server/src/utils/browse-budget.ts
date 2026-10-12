/**
 * The hard image cap (issue #3010, spec image-transcribe §5.8): at most
 * `IMAGE_BROWSE_CAP` distinct images from one image group in one project.
 * `image_read`, `image_transcribe` and `volume_bisect` share ONE count, because
 * all three take the same `imageId` — a hunt that alternates between them must
 * hit one bound or the bound means nothing.
 *
 * Each tool calls `checkImageBrowseCap` before it fetches the scan (and, for
 * image_transcribe, before the OCR) — volume_bisect's `image_search` listing
 * runs first because it is what names the probe's imageId — and
 * `recordImageBrowse` only once the read succeeded: after the fetch for
 * image_read and image_transcribe, after the probe's OCR for volume_bisect.
 * A failed fetch spends no budget. Calls running in parallel can overshoot by
 * however many are in flight; accepted.
 *
 * The count lives in the project store as `results/image-browse.jsonl` (`.jsonl`
 * because `results-staging.ts` scans `results/*.json`), so it survives a
 * restart. Best-effort in both directions: a log that cannot be read or written
 * falls back to the in-process count, and never refuses or fails a read on its
 * own. A call whose `projectPath` (or, on the shared-process http entrypoint,
 * the bound store's `anchorPath`) is not a project counts in memory only.
 *
 * Not counted: an `ark` that carries no group (a 3:1:/3:2: ARK — a DGS
 * distribution URL passed as `ark` embeds its imageId and IS counted), `file`
 * and `memoryArtifactUrl` inputs.
 *
 * On the file backend (no bound `projectId`) a call without `projectPath` cannot
 * say which project it belongs to, so its check also counts every in-process
 * read of that group, and a call with one also counts the group's no-path reads.
 * Without that, a subagent called without `projectPath` would get a second 20.
 */
import { getProjectStore } from "../store/project-store.js";
import { classifyProjectPath } from "./project-io.js";
import { projectScope } from "./image-store.js";
import { dgsImageId, imageViewerUrl } from "./ark.js";

export const IMAGE_BROWSE_CAP = 20;

const LOG_REF = "results/image-browse.jsonl";

export type CapTool = "image_read" | "image_transcribe" | "volume_bisect";

// Distinct imageIds per `${projectScope(projectPath)}\0${group}` — the scope is
// the bound store's patron-isolating projectId on http (#2771), else the
// normalized projectPath, else `<no-project>`.
const seenInProcess = new Map<string, Set<string>>();
// Keys recorded under a bound store (a `projectId`): a patron's own count, never
// pooled into an unbound call's.
const boundKeys = new Set<string>();

/** Test-only reset of the in-process count (a restart, as far as the cap can tell). */
export function __clearImageBrowseMemoryForTests(): void {
  seenInProcess.clear();
  boundKeys.clear();
}

export interface BrowseTicket {
  imageId: string;
  group: string;
  tool: CapTool;
  memKey: string;
  /** Checked under a bound store (`projectId` set). */
  bound: boolean;
  /** The project to append to, when the call resolved to one. */
  persistPath?: string;
  /** Already in the persisted log — recording it again would be a duplicate line. */
  inLog: boolean;
}

function inProcessSeen(memKey: string, group: string, projectPath: string | undefined): string[] {
  if (getProjectStore().projectId !== undefined) return [...(seenInProcess.get(memKey) ?? [])];
  const noPath = `${projectScope(undefined)}\0${group}`;
  const ids: string[] = [];
  for (const [key, set] of seenInProcess) {
    if (boundKeys.has(key)) continue;
    const sameGroup = key.endsWith(`\0${group}`);
    if (key === memKey || (sameGroup && (projectPath === undefined || key === noPath))) ids.push(...set);
  }
  return ids;
}

async function persistTarget(projectPath: string | undefined): Promise<string | undefined> {
  const target = projectPath ?? getProjectStore().anchorPath;
  if (target === undefined) return undefined;
  try {
    return (await classifyProjectPath(target)) === "project" ? target : undefined;
  } catch {
    return undefined;
  }
}

async function loggedIds(projectPath: string, group: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let text: string;
  try {
    text = await getProjectStore().readText(projectPath, LOG_REF);
  } catch {
    return ids;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { image_group?: unknown; image_id?: unknown };
      if (entry.image_group === group && typeof entry.image_id === "string") ids.add(entry.image_id);
    } catch {
      // A torn or hand-edited line is skipped, never fatal.
    }
  }
  return ids;
}

function refusal(tool: CapTool, imageId: string, group: string, bracket?: string): Error {
  const link = imageViewerUrl({ imageId });
  const where = link ? ` (${link})` : "";
  const withLink = link ? " with this link" : "";
  const bisect =
    tool === "volume_bisect"
      ? ` Report the bracket your readings reached so far as the browse's result${bracket ? ` (${bracket})` : ""}.`
      : " To find one year's page in a browse-only volume, run volume_bisect first, then read the narrowed range.";
  return new Error(
    `Image cap reached: ${IMAGE_BROWSE_CAP} distinct images from image group ${group} have already ` +
      `been read in this project (or in this server session, for reads with no projectPath), so ` +
      `${imageId}${where} was not fetched. Re-reading any of those ` +
      `${IMAGE_BROWSE_CAP} still works.${bisect} Log this browse as partial with research_log_append ` +
      `(the group, the pages you read, what you were looking for), move to other routes ` +
      `(record_search, fulltext_search, other collections), and name the unfinished browse in your ` +
      `final summary${withLink} so the researcher can continue it by hand.`,
  );
}

/**
 * Refuse (throw) when `imageId` is new and its group already holds
 * `IMAGE_BROWSE_CAP` distinct images in this project. Returns the ticket to pass
 * to `recordImageBrowse` once the fetch succeeds, or `undefined` for an
 * uncounted call (no `imageId`). `bracket` is volume_bisect's bracket so far,
 * quoted in its refusal.
 */
export async function checkImageBrowseCap(
  input: { imageId?: string; ark?: string },
  projectPath: string | undefined,
  tool: CapTool,
  bracket?: string,
): Promise<BrowseTicket | undefined> {
  const imageId = input.imageId || (input.ark ? dgsImageId(input.ark) : undefined);
  if (!imageId) return undefined;
  const group = imageId.split("_")[0];
  const memKey = `${projectScope(projectPath)}\0${group}`;
  const persistPath = await persistTarget(projectPath);
  const logged = persistPath ? await loggedIds(persistPath, group) : new Set<string>();
  const seen = new Set([...inProcessSeen(memKey, group, projectPath), ...logged]);
  if (!seen.has(imageId) && seen.size >= IMAGE_BROWSE_CAP) {
    throw refusal(tool, imageId, group, bracket);
  }
  const bound = getProjectStore().projectId !== undefined;
  return { imageId, group, tool, memKey, bound, persistPath, inLog: logged.has(imageId) };
}

/** Count the image: in process always, and in the project's log when it is not there yet. */
export async function recordImageBrowse(ticket: BrowseTicket | undefined): Promise<void> {
  if (!ticket) return;
  let seen = seenInProcess.get(ticket.memKey);
  if (!seen) {
    seen = new Set<string>();
    seenInProcess.set(ticket.memKey, seen);
  }
  seen.add(ticket.imageId);
  if (ticket.bound) boundKeys.add(ticket.memKey);
  if (!ticket.persistPath || ticket.inLog) return;
  const line = JSON.stringify({
    image_group: ticket.group,
    image_id: ticket.imageId,
    tool: ticket.tool,
    at: new Date().toISOString(),
  });
  try {
    await getProjectStore().appendText(ticket.persistPath, LOG_REF, `${line}\n`);
  } catch {
    // Best-effort: the in-process count still holds for this process.
  }
}
