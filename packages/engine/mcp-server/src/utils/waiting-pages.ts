// waiting-pages — which held records have had their page read but not kept.
//
// A page read with `image_transcribe` is staged, or logged, which moves it to a
// sidecar, and nothing puts it on the source of the indexed record it shows. This
// joins the two, read-only: `project_context` lists the matches and
// `extraction_append` attaches them.
// Spec: docs/specs/research-append-tool-spec.md, "Attaching waiting pages".

import { arkToBareId } from "./ark.js";
import { isLiveAssertion } from "./assertion-liveness.js";
import { listStagedEnvelopes, readStagedResults } from "./results-staging.js";

/** One live index assertion of a waiting page's record, as record-structurer
 *  names it: what it disputes or whose new fact it adds (#4286). */
export interface WaitingPageIndexEntry {
  assertionId: string;
  role: string;
  factType: string;
  value: string;
}

/** A held record's source and the staged or logged page that shows it. */
export interface WaitingPage {
  sourceId: string;
  ref: string;
  /** The record's index: its source's live assertions. */
  index: WaitingPageIndexEntry[];
}

/** What selects one image inside a waypoint ARK. `cc` does not, so it is ignored. */
const IMAGE_SELECTORS = ["i", "groupId"] as const;

/**
 * The image an ARK names, or null when `i=` or `groupId=` picks one of several. A
 * read that fails on those falls back to the bare URL, which can land on any image,
 * so what it read cannot be trusted as that page. `cc` selects nothing.
 */
export function pageKey(ark: string): string | null {
  const q = ark.indexOf("?");
  const params = new URLSearchParams(q === -1 ? "" : ark.slice(q + 1));
  return IMAGE_SELECTORS.some((k) => params.has(k)) ? null : arkToBareId(ark);
}

/** Whether a logged page holds text. Only those that do are listed: a logged page
 *  never expires, so one that could not be attached would be listed forever. */
async function loggedPageHasText(projectPath: string, ref: string): Promise<boolean> {
  try {
    const rows = await readStagedResults(projectPath, ref);
    return rows.some((r: any) => typeof r?.transcription === "string" && r.transcription !== "");
  } catch {
    return false;
  }
}

/**
 * Sources with a known image and no page, each joined to the oldest logged read of
 * that image, else the oldest staged one, so a repeat read cannot displace the
 * first. An expired page drops out by itself and an attached source stops
 * qualifying, so nothing here can loop. Only a logged read a source waits for has
 * its sidecar read.
 */
export async function waitingPages(projectPath: string, research: any): Promise<WaitingPage[]> {
  const sources = (Array.isArray(research?.sources) ? research.sources : []).filter(
    (s: any) => typeof s?.id === "string" && typeof s?.image_ark === "string" && s.image_ark !== "" && !s.transcription,
  );
  if (sources.length === 0) return [];

  const wanted = new Set(sources.map((s: any) => pageKey(s.image_ark)));
  const oldestRead = new Map<string, string>();
  for (const e of Array.isArray(research?.log) ? research.log : []) {
    if (e?.tool !== "image_transcribe" || typeof e?.results_ref !== "string") continue;
    const ark = e.query?.ark ?? e.query?.imageArk;
    if (typeof ark !== "string" || ark === "") continue;
    const key = pageKey(ark);
    if (key === null || !wanted.has(key) || oldestRead.has(key)) continue;
    if (await loggedPageHasText(projectPath, e.results_ref)) oldestRead.set(key, e.results_ref);
  }

  const staged = await listStagedEnvelopes(projectPath, "image_transcribe");
  for (const entry of [...staged].reverse()) {
    const ark = (entry.envelope.payload as { query?: { ark?: unknown } } | undefined)?.query?.ark;
    if (typeof ark !== "string" || ark === "") continue;
    const key = pageKey(ark);
    if (key !== null && !oldestRead.has(key)) oldestRead.set(key, entry.ref);
  }

  const out: WaitingPage[] = [];
  const assertions: any[] = Array.isArray(research?.assertions) ? research.assertions : [];
  for (const s of sources) {
    const key = pageKey(s.image_ark);
    const ref = key === null ? undefined : oldestRead.get(key);
    if (!ref) continue;
    const index = assertions
      .filter((a) => a?.source_id === s.id && typeof a?.id === "string" && isLiveAssertion(a))
      .map((a) => ({
        assertionId: a.id as string,
        role: String(a.record_role ?? ""),
        factType: String(a.fact_type ?? ""),
        value: String(a.value ?? ""),
      }));
    out.push({ sourceId: s.id, ref, index });
  }
  return out;
}
