// waiting-pages — which held records have had their page read but not kept.
//
// A page read with `image_transcribe` is staged, and nothing puts it on the
// source of the indexed record it shows. This joins the two, read-only:
// `project_context` lists the matches and `extraction_append` attaches them.
// Spec: docs/specs/research-append-tool-spec.md, "Attaching waiting pages".

import { arkToBareId } from "./ark.js";
import { listStagedEnvelopes } from "./results-staging.js";

/** A held record's source and the staged page that shows it. */
export interface WaitingPage {
  sourceId: string;
  ref: string;
}

/** What selects one image inside a waypoint ARK. `cc` does not, so it is ignored. */
const IMAGE_SELECTORS = ["i", "groupId"] as const;

/**
 * One image's identity. The bare id alone is not enough: a waypoint ARK with
 * `i=15` is a different image from the same ARK with no `i=`, and attaching it
 * would put the wrong page on a source with nothing to flag it.
 */
export function pageKey(ark: string): string {
  const q = ark.indexOf("?");
  const params = new URLSearchParams(q === -1 ? "" : ark.slice(q + 1));
  return [arkToBareId(ark), ...IMAGE_SELECTORS.map((k) => params.get(k) ?? "")].join("|");
}

/**
 * Sources with a known image and no page, each joined to the oldest staged read
 * of that image, so a repeat read cannot displace the first. An expired page drops
 * out by itself and an attached source stops qualifying, so nothing here can loop.
 */
export async function waitingPages(projectPath: string, research: any): Promise<WaitingPage[]> {
  const sources = (Array.isArray(research?.sources) ? research.sources : []).filter(
    (s: any) => typeof s?.id === "string" && typeof s?.image_ark === "string" && s.image_ark !== "" && !s.transcription,
  );
  if (sources.length === 0) return [];

  const staged = await listStagedEnvelopes(projectPath, "image_transcribe");
  const oldestRead = new Map<string, string>();
  for (const entry of [...staged].reverse()) {
    const ark = (entry.envelope.payload as { query?: { ark?: unknown } } | undefined)?.query?.ark;
    if (typeof ark !== "string" || ark === "") continue;
    const key = pageKey(ark);
    if (!oldestRead.has(key)) oldestRead.set(key, entry.ref);
  }

  const out: WaitingPage[] = [];
  for (const s of sources) {
    const ref = oldestRead.get(pageKey(s.image_ark));
    if (ref) out.push({ sourceId: s.id, ref });
  }
  return out;
}
