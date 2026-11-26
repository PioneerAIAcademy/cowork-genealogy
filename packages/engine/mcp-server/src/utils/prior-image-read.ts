// The project's own earlier reading of a page, which image_transcribe returns
// instead of fetching and reading the page again
// (docs/specs/image-transcribe-tool-spec.md, "A page already read").

import { readProjectJson } from "./project-io.js";
import { sidecarReader } from "./results-staging.js";
import type { StagedTranscription } from "../types/image-transcribe.js";

export interface PriorImageRead {
  /** The log entry that holds the earlier reading. */
  logId: string;
  element: StagedTranscription;
}

/**
 * The newest logged, complete reading of the page `id` names, or null.
 *
 * `id` is the staged element's id (`StagedTranscription.id`). `sameInput` is
 * asked about each image_transcribe log entry's `query` first, so only an entry
 * that could be this page has its sidecar read. A truncated reading is never
 * returned: a fresh read may reach the rest of the page. Whether the reading's
 * retained scan (`image_ref`) is still in the project is the caller's check
 * (`refreshSourceImage`).
 *
 * Never throws: an unreadable log or sidecar is no earlier reading.
 */
export async function priorImageRead(
  projectPath: string,
  id: string,
  sameInput: (query: Record<string, unknown>) => boolean,
): Promise<PriorImageRead | null> {
  let log: unknown;
  try {
    log = (await readProjectJson(projectPath, "research.json"))?.log;
  } catch {
    return null;
  }
  if (!Array.isArray(log)) return null;
  const readSidecar = sidecarReader(projectPath);
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (!entry || typeof entry !== "object" || entry.tool !== "image_transcribe") continue;
    if (typeof entry.id !== "string" || typeof entry.results_ref !== "string") continue;
    const query = entry.query;
    if (!query || typeof query !== "object" || Array.isArray(query)) continue;
    let candidate = false;
    try {
      candidate = sameInput(query as Record<string, unknown>);
    } catch {
      candidate = false;
    }
    if (!candidate) continue;
    const envelope = await readSidecar(entry.results_ref);
    const element = envelope?.payload?.results?.[0] as StagedTranscription | undefined;
    if (!element || typeof element !== "object" || element.id !== id) continue;
    if (element.truncated === true) continue;
    if (typeof element.transcription !== "string" || element.transcription === "") continue;
    return { logId: entry.id, element };
  }
  return null;
}
