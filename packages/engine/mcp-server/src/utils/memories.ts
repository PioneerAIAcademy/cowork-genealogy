/**
 * FamilySearch Memories: fetch, filter, rank.
 *
 * Shape and behaviour are measured, not assumed — `dev/probe-memories.ts` is the
 * evidence trail, run live 2026-09-14/15 over 221 memories on three persons.
 * The filter is the lead's ruling of 2026-09-15 (issue #1689).
 */
import { getValidToken } from "../auth/refresh.js";
import type { Principal } from "../auth/principal.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { fetchWithRetry } from "./http.js";
import { isMemoryArtifactUrl } from "./fs-image-fetch.js";

const API_BASE = "https://api.familysearch.org/platform/tree/persons";
const ACCEPT_HEADER = "application/x-fs-v1+json";

/** Cap on pages walked. The largest person sampled carried 116 memories (5
 *  pages at 25); 40 is headroom, not a expected limit. */
const MAX_PAGES = 40;

export interface Memory {
  id: string;
  /** User-visible memory URL, not the API `about` URI: `research.json`'s `url`
   *  is what a citation shows a person. */
  url?: string;
  /** Bytes URL. Needs NEITHER the bearer token NOR BROWSER_USER_AGENT — public
   *  memory artifacts served 200 with no auth header at all, unlike the `$dist`
   *  scans behind Imperva. */
  artifactUrl?: string;
  title: string;
  /** A story's `descriptions[].value` is a 200-CHARACTER PREVIEW cut mid-word,
   *  not the full text. The single-memory fetch returns the same 200. */
  descriptionPreview?: string;
  mediaType: string;
  kind: "Photo" | "Document" | "Story" | "unknown";
  sizeBytes?: number;
  filename?: string;
}

interface Json {
  [k: string]: unknown;
}

/**
 * Record-document language. Widens the filter, never narrows it — the arm the
 * 2026-08-19 ruling rejected was keywords as THE filter, where a non-English
 * tree silently gets nothing. Here PDF and media kind are a language-independent
 * floor underneath, so on a German tree this arm fires on nothing and every PDF
 * and Document still lands.
 *
 * Deliberately NOT tuned against the probe corpus. `certificate` stays in even
 * though it produced three false positives there (award certificates); death and
 * birth certificates are core evidence and that sample is not representative.
 */
const RECORD_LANGUAGE = new RegExp(
  "\\b(?:" +
    [
      // Suffix genuinely varies, so the wildcard earns its place:
      // obituary/obituaries, baptism/baptised, naturalization/naturalized.
      "obituar\\w*",
      "baptis\\w*",
      "naturaliz\\w*",
      "enlist\\w*",
      "probat\\w*",
      "certificat\\w*",
      "christening\\w*",
      "registrat\\w*",
      "deposition\\w*",
      // Matched whole, plural only. A trailing wildcard on these short stems
      // matches INSIDE ordinary words, and the words it hits are names: `will`
      // in William/Willie/Willa, `deed` in Deedee, `birth` in Birthday,
      // `muster` in Mustering, `register` in Registered. William is among the
      // commonest Anglophone given names, so the blanket `\w*` kept a family
      // snapshot on any tree carrying one -- and ranked it AHEAD of the census
      // page for the 40s OCR budget. That is acceptance 3, twice over.
      "wills?",
      "deeds?",
      // Record CLASSES, not tuning against the probe sample -- same footing as
      // `certificate`. A photographed family-Bible register page is a classic
      // memory-only source and is almost always filed under Photos, so it
      // falls through the PDF arm, the kind arm and the keyword arm alike.
      "bibles?",
      "cemeter(?:y|ies)",
      "census(?:es)?",
      "marriages?",
      "births?",
      "deaths?",
      "burials?",
      "registers?",
      "registry",
      "newspapers?",
      "clippings?",
      "passports?",
      "pensions?",
      "headstones?",
      "gravestones?",
      "tombstones?",
      "musters?",
      "manifests?",
      "passengers?",
      "affidavits?",
      "draft cards?",
      "land patents?",
    ].join("|") +
    ")\\b",
  "i",
);

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: ACCEPT_HEADER,
    "Accept-Language": "en",
    "User-Agent": BROWSER_USER_AGENT,
  };
}

function kindOf(am: Json[] | undefined): Memory["kind"] {
  const s = JSON.stringify(am ?? []);
  if (s.includes("/Photo")) return "Photo";
  if (s.includes("/Document")) return "Document";
  if (s.includes("/Story")) return "Story";
  return "unknown";
}

function toMemory(sd: Json): Memory {
  const am = (sd.artifactMetadata as Json[] | undefined) ?? [];
  const first = (am[0] ?? {}) as Json;
  const links = (sd.links ?? {}) as Record<string, { href?: string }>;
  const titles = (sd.titles as Array<{ value?: string }> | undefined) ?? [];
  const descs = (sd.descriptions as Array<{ value?: string }> | undefined) ?? [];
  const filename = typeof first.filename === "string" ? first.filename : undefined;
  const title =
    titles.map((t) => t.value ?? "").find((v) => v.trim()) ??
    filename ??
    `FamilySearch memory ${String(sd.id)}`;
  return {
    id: String(sd.id),
    ...(links.memory?.href ? { url: links.memory.href } : {}),
    ...(typeof sd.about === "string" ? { artifactUrl: sd.about } : {}),
    title,
    ...(descs.length ? { descriptionPreview: descs.map((d) => d.value ?? "").join(" ") } : {}),
    mediaType: String(sd.mediaType ?? ""),
    kind: kindOf(am),
    ...(typeof first.size === "number" ? { sizeBytes: first.size } : {}),
    ...(filename ? { filename } : {}),
  };
}

/**
 * Every memory on a person, paged to completion.
 *
 * The last page is a **204 with an EMPTY BODY**, not an absent `next` link, so
 * status and emptiness are both checked before parsing. A pager that calls
 * `.json()` unconditionally throws on the final hop — the probe's first version
 * did exactly that.
 *
 * Paging to completion is the ruling's reading of acceptance 7: it forbids a
 * fetch PER RELATIVE, not more than one page for the subject.
 */
export async function fetchMemories(personId: string, principal: Principal): Promise<Memory[]> {
  const token = await getValidToken(principal);
  let url: string | undefined = `${API_BASE}/${encodeURIComponent(personId)}/memories`;
  const out: Memory[] = [];
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res = await fetchWithRetry(url, { headers: headers(token) });
    if (res.status !== 200) {
      // Without this line an outage is byte-identical to "this person has no
      // memories": `break` returns [], nothing throws, so `mergeMemories`'
      // catch never runs and the spec's promise of "one line to stderr" is kept
      // only on the throw path. The read still degrades silently on purpose --
      // this makes it observable, not fatal.
      process.stderr.write(
        `person_read: memories fetch for ${personId} returned ${res.status} ` +
          `on page ${page}; continuing with the tree sources alone.\n`,
      );
      break;
    }
    const raw = await res.text();
    if (!raw) break;
    let body: Json;
    try {
      body = JSON.parse(raw) as Json;
    } catch {
      break;
    }
    for (const sd of ((body.sourceDescriptions as Json[] | undefined) ?? [])) out.push(toMemory(sd));
    const links = body.links as Record<string, { href?: string }> | undefined;
    url = links?.next?.href;
  }
  return out;
}

const isAudioVideo = (m: Memory): boolean => /^(audio|video)\//i.test(m.mediaType);

/** Free text the keyword arm reads. */
const textOf = (m: Memory): string => `${m.title} ${m.descriptionPreview ?? ""}`.trim();

export function hasRecordLanguage(m: Memory): boolean {
  return RECORD_LANGUAGE.test(textOf(m));
}

/**
 * The ruled filter. TWO STAGES, and the exclusion runs first.
 *
 * Stage 1 drops audio/video and the designated portrait unconditionally, whatever
 * else matches. Audio is never a record: three of the five Story-qualified
 * memories in the probe corpus are MP3s carrying description text a keyword arm
 * would happily match, and acceptance 3 requires personal audio to be absent from
 * the response entirely — so a keyword arm able to resurrect one fails an
 * existing criterion.
 *
 * Stage 2 keeps on ANY of: PDF, media kind Document or Story, or record language
 * in the title/description WHATEVER the kind. That last arm is what recovers the
 * record scans uploaders file under Photo — on the probe corpus a WWII draft
 * card, a 1950 census page, a marriage licence, an obituary and two headstones.
 */
export function filterSourceStyle(memories: Memory[], portraitId: string | null): Memory[] {
  return memories.filter((m) => {
    if (isAudioVideo(m)) return false;
    if (portraitId && m.id === portraitId) return false;
    if (m.mediaType.toLowerCase() === "application/pdf") return true;
    if (m.kind === "Document" || m.kind === "Story") return true;
    return hasRecordLanguage(m);
  });
}

/**
 * Record-language first, then smallest first.
 *
 * Rank order is the point, not a ceiling: the OCR phase runs under one wall-clock
 * budget, so without ranking the budget gets spent on five family histories while
 * the census page goes untranscribed. Size breaks the tie so a 7MB journal does
 * not starve three one-page scans.
 */
export function rankForTranscription(kept: Memory[]): Memory[] {
  return [...kept].sort((a, b) => {
    const ar = hasRecordLanguage(a) ? 0 : 1;
    const br = hasRecordLanguage(b) ? 0 : 1;
    if (ar !== br) return ar - br;
    return (a.sizeBytes ?? Number.MAX_SAFE_INTEGER) - (b.sizeBytes ?? Number.MAX_SAFE_INTEGER);
  });
}

/** The person's designated portrait, which stage 1 drops. Returns null on any
 *  failure: a portrait lookup must never fail the read. */
export async function fetchPortraitId(personId: string, principal: Principal): Promise<string | null> {
  try {
    const token = await getValidToken(principal);
    const res = await fetchWithRetry(
      `${API_BASE}/${encodeURIComponent(personId)}/portrait`,
      { headers: headers(token), redirect: "manual" },
    );
    const loc = res.headers.get("location");
    if (!loc) return null;
    const m = /\/memories\/(?:memories\/)?(\d+)/.exec(loc);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** A story artifact is small text, not a multi-MB scan; it needs none of the
 *  image legs' headroom. */
const STORY_TEXT_TIMEOUT_MS = 15_000;

/**
 * A story's full text, straight off its artifact.
 *
 * The payload's own `descriptions[].value` is a 200-CHARACTER PREVIEW cut
 * mid-word, and the single-memory fetch returns the same 200, so the artifact is
 * the only route to the whole story. Measured 2026-09-15 across the probe
 * corpus: 5 of 6 text/plain artifacts served (311..12239 chars against that flat
 * 200) and 1 404'd. So this is worth doing and MUST fail soft per story -- one
 * missing artifact cannot cost the other five their text.
 *
 * Returns null rather than the preview on failure, deliberately: a 200-character
 * fragment cut mid-word, handed back in the same `text` field that elsewhere
 * carries a full transcription, reads as a complete short story to anyone (and
 * anything) downstream. Absent beats silently truncated.
 */
export async function fetchStoryText(m: Memory): Promise<string | null> {
  if (!m.artifactUrl) return null;
  // Same host check the image leg runs on the same upstream field. Silent
  // null rather than a throw: a story we cannot verify is a story we do not
  // have, which is exactly how every other failure on this path degrades.
  if (!isMemoryArtifactUrl(m.artifactUrl)) return null;
  try {
    // No credential: memory artifacts are public (measured -- no headers at all
    // returns 200), and nothing should hand a token to a URL that arrived
    // inside a response body.
    const res = await fetchWithRetry(m.artifactUrl, {}, STORY_TEXT_TIMEOUT_MS);
    if (res.status !== 200) return null;
    const text = (await res.text()).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** Media the OCR leg can read. Measured 2026-09-15: the model transcribes a PDF
 *  handed to it as an ordinary image_url data URL, so PDFs belong here -- they
 *  are 29 of the 221-memory corpus and carry the wills and certificates. */
export function isTranscribable(m: Memory): boolean {
  const t = m.mediaType.toLowerCase();
  return t.startsWith("image/") || t === "application/pdf";
}

/** A story carries its own words; it is fetched, not OCR'd. */
export function isStoryText(m: Memory): boolean {
  return m.mediaType.toLowerCase() === "text/plain";
}
