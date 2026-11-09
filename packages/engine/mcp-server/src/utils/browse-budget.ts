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
 *
 * A connector call naming no project (self-hosted beta E1/E5, issue #3996) does
 * NOT join that shared no-path bucket: `checkImageBrowseCap` takes the
 * `Principal`, and when the STORE IS UNBOUND and it names a connector caller
 * (`connectorUserId`, `utils/user-limits.ts`) the no-project scope is that
 * caller's own id, so one connector user's unbound reads never advance another
 * connector user's count, and a LOCAL/worker no-project read never advances a
 * connector's either (`connectorScopedKeys` below). Gated on the store's own
 * bound-ness, not on whether this call's `projectPath` argument happens to be
 * undefined: a worker call always binds a project (`http-server.ts` from
 * `X-Genealogy-Project-Id`), and a connector call that named a project normally
 * does too — but `imageTranscribeMcpTool` strips `projectPath` for a brand-new,
 * not-yet-created project while the door's store stays bound, so the
 * `projectPath` argument alone cannot tell "no project at all" apart from
 * "this project, before `project_create` ran". LOCAL and the file backend keep
 * today's single shared bucket, because there is only ever one user in that
 * process.
 */
import type { Principal } from "../auth/principal.js";
import { connectorUserId } from "./user-limits.js";
import { getProjectStore } from "../store/project-store.js";
import { classifyProjectPath } from "./project-io.js";
import { projectScope } from "./image-store.js";
import { dgsImageId, imageViewerUrl } from "./ark.js";

export const IMAGE_BROWSE_CAP = 20;

const LOG_REF = "results/image-browse.jsonl";

export type CapTool = "image_read" | "image_transcribe" | "volume_bisect";

// Distinct imageIds per `${projectScope(projectPath)}\0${group}` — the scope is
// the bound store's patron-isolating projectId on http (#2771), else the
// normalized projectPath, else `<no-project>` (optionally `:${connectorUserId}`
// suffixed — see `connectorScopedKeys` below).
const seenInProcess = new Map<string, Set<string>>();
// Keys recorded under a bound store (a `projectId`): a patron's own count, never
// pooled into an unbound call's.
const boundKeys = new Set<string>();
// Keys recorded for a connector's own no-project reads (#3996): never pooled
// into the general LOCAL/file-backend union below, the same way `boundKeys`
// is excluded from it — a connector key happens to also end with `\0${group}`,
// so without this exclusion a LOCAL (or any other no-project, non-connector)
// call's broad union would inherit a connector user's count.
const connectorScopedKeys = new Set<string>();

/** Test-only reset of the in-process count (a restart, as far as the cap can tell). */
export function __clearImageBrowseMemoryForTests(): void {
  seenInProcess.clear();
  boundKeys.clear();
  connectorScopedKeys.clear();
}

export interface BrowseTicket {
  imageId: string;
  group: string;
  tool: CapTool;
  memKey: string;
  /** Checked under a bound store (`projectId` set). */
  bound: boolean;
  /** A connector caller's own no-project scope (#3996) — never a bound store,
   *  never LOCAL/the file backend. */
  connectorScoped: boolean;
  /** The project to append to, when the call resolved to one. */
  persistPath?: string;
  /** Already in the persisted log — recording it again would be a duplicate line. */
  inLog: boolean;
}

function inProcessSeen(
  memKey: string,
  group: string,
  projectPath: string | undefined,
  connectorUser: string | undefined,
): string[] {
  // A bound store (`projectId` set) or a connector's own no-project scope is
  // already exact-scoped by `memKey` — the bound projectId, or this
  // connector's own id — so an exact lookup is enough for either; never run
  // the broad union below for them.
  if (getProjectStore().projectId !== undefined || connectorUser !== undefined) {
    return [...(seenInProcess.get(memKey) ?? [])];
  }
  const noPath = `${projectScope(undefined)}\0${group}`;
  const ids: string[] = [];
  for (const [key, set] of seenInProcess) {
    if (boundKeys.has(key) || connectorScopedKeys.has(key)) continue;
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

/** Distinct imageIds per group in the project's log; empty when it cannot be read. */
async function loggedIdsByGroup(projectPath: string): Promise<Map<string, Set<string>>> {
  const byGroup = new Map<string, Set<string>>();
  let text: string;
  try {
    text = await getProjectStore().readText(projectPath, LOG_REF);
  } catch {
    return byGroup;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { image_group?: unknown; image_id?: unknown };
      if (typeof entry.image_group !== "string" || typeof entry.image_id !== "string") continue;
      let ids = byGroup.get(entry.image_group);
      if (!ids) {
        ids = new Set<string>();
        byGroup.set(entry.image_group, ids);
      }
      ids.add(entry.image_id);
    } catch {
      // A torn or hand-edited line is skipped, never fatal.
    }
  }
  return byGroup;
}

async function loggedIds(projectPath: string, group: string): Promise<Set<string>> {
  return (await loggedIdsByGroup(projectPath)).get(group) ?? new Set<string>();
}

/**
 * Image groups (film numbers) whose cap is spent in this project, from the
 * persisted log only — in-process counts for reads that named no project are
 * not seen. Sorted by group; `[]` when the log is absent or unreadable.
 */
export async function exhaustedImageGroups(
  projectPath: string,
): Promise<{ imageGroup: string; imagesRead: number }[]> {
  const out: { imageGroup: string; imagesRead: number }[] = [];
  for (const [imageGroup, ids] of await loggedIdsByGroup(projectPath)) {
    if (ids.size >= IMAGE_BROWSE_CAP) out.push({ imageGroup, imagesRead: ids.size });
  }
  return out.sort((a, b) => a.imageGroup.localeCompare(b.imageGroup));
}

/** `"project"`: the count came from the project's persisted log. `"connector"`:
 *  no project, but a connector caller — scoped to that caller, never "this
 *  server session" (misleading on a process a connector call shares with every
 *  other user). `"session"`: no project and no connector caller (LOCAL/the file
 *  backend) — the pre-#3996 shared-process wording. */
type RefusalScope = "project" | "connector" | "session";

function refusal(
  tool: CapTool,
  imageId: string,
  group: string,
  scope: RefusalScope,
  bracket?: string,
): Error {
  const link = imageViewerUrl({ imageId });
  const where = link ? ` (${link})` : "";
  const withLink = link ? " with this link" : "";
  const bisect =
    tool === "volume_bisect"
      ? ` Report the bracket your readings reached so far as the browse's result${bracket ? ` (${bracket})` : ""}.`
      : " Reads in other films are not affected; to find one year's page in another browse-only volume, run volume_bisect first if you hold it, then read the narrowed range.";
  const scopeText =
    scope === "project"
      ? `been read in this project, so ${imageId}${where} was not fetched. The cap is per film, per ` +
        `project: every sub-volume of film ${group} shares it, and nothing resets it, not a new agent ` +
        `and not a new session.`
      : scope === "connector"
        ? `been read without a project under your account, so ${imageId}${where} was not fetched. ` +
          `A new agent does not reset it.`
        : `been read in this server session, because this read named no project, so ` +
          `${imageId}${where} was not fetched. A new agent does not reset it.`;
  return new Error(
    `Image cap reached: ${IMAGE_BROWSE_CAP} distinct images from image group ${group} have already ` +
      `${scopeText} Re-reading any of those ` +
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
 * uncounted call (no `imageId`). `principal` scopes a no-project connector call
 * to its own caller (#3996, module docstring). `bracket` is volume_bisect's
 * bracket so far, quoted in its refusal.
 */
export async function checkImageBrowseCap(
  input: { imageId?: string; ark?: string },
  projectPath: string | undefined,
  tool: CapTool,
  principal: Principal,
  bracket?: string,
): Promise<BrowseTicket | undefined> {
  const imageId = input.imageId || (input.ark ? dgsImageId(input.ark) : undefined);
  if (!imageId) return undefined;
  const group = imageId.split("_")[0];
  // Gate on the STORE'S bound-ness, not on whether this call's own
  // `projectPath` argument happens to be undefined: a connector call that
  // named a project is normally routed to a *bound* store by http-server.ts
  // before this ever runs, but `imageTranscribeMcpTool` strips `projectPath`
  // for a brand-new, not-yet-created project (`classifyProjectPath` ===
  // "no_project") while the door's store stays bound to that project's real
  // `projectId` — so `projectPath === undefined` alone would wrongly apply the
  // connector suffix to an already project-scoped key and split one project's
  // count into two depending on whether it had been `project_create`d yet.
  const bound = getProjectStore().projectId !== undefined;
  const connectorUser = bound ? undefined : connectorUserId(principal);
  const keyScope = projectScope(projectPath);
  const memKey = connectorUser !== undefined ? `${keyScope}:${connectorUser}\0${group}` : `${keyScope}\0${group}`;
  const persistPath = await persistTarget(projectPath);
  const logged = persistPath ? await loggedIds(persistPath, group) : new Set<string>();
  const seen = new Set([...inProcessSeen(memKey, group, projectPath, connectorUser), ...logged]);
  if (!seen.has(imageId) && seen.size >= IMAGE_BROWSE_CAP) {
    const refusalScope: RefusalScope =
      persistPath !== undefined ? "project" : connectorUser !== undefined ? "connector" : "session";
    throw refusal(tool, imageId, group, refusalScope, bracket);
  }
  return {
    imageId,
    group,
    tool,
    memKey,
    bound,
    connectorScoped: connectorUser !== undefined,
    persistPath,
    inLog: logged.has(imageId),
  };
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
  if (ticket.connectorScoped) connectorScopedKeys.add(ticket.memKey);
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
