/**
 * Bisect a browse-only image volume toward a target year, ONE probe per call.
 *
 * Stateless by design: Cowork's device bridge aborts every MCP call at 60s, and
 * ten sequential OCR probes is p50 ~190s, so a host-side loop would be aborted
 * with its result discarded in the one environment the plugin ships into. See
 * docs/specs/volume-bisect-tool-spec.md §2.
 */
import type { Principal } from "../auth/principal.js";
import { getOpenRouterApiKey, getOpenRouterModel } from "../auth/config.js";
import { imageSearchTool } from "./image-search.js";
import { resolveFsImageInput, fetchFsImageBytes } from "../utils/fs-image-fetch.js";
import { runOcr } from "../utils/ocr.js";
import { recordBrowseAndCheckBudget } from "../utils/browse-budget.js";
import type {
  VolumeBisectInput,
  VolumeBisectReading,
  VolumeBisectResult,
  VolumeBisectBracket,
} from "../types/volume-bisect.js";

/** A split Natural Group: `{prefix}_{part}_{naturalId}`. A bare prefix names a
 *  whole film, across which year is NOT monotone (spec §3). */
const SPLIT_GROUP = /^\d+_\d+_[A-Za-z0-9-]+$/;

/** Register years. The ceiling is load-bearing: every archival target card on
 *  this corpus carries a "DEC 2 . 1952" filming stamp, which a wider range reads
 *  as the page year (spec §6). */
const YEAR_MIN = 1500;
const YEAR_MAX = 1950;

/** Three legs must sum under Cowork's 60s abort (spec §8). Bounds, not measured
 *  latencies, except the OCR one, which is now measured: 14.7-18.3s over five
 *  caps on one page (`dev/probe-volume-bisect-token-cap.ts`), so the 20s it
 *  carried first was inside the observed spread rather than above it.
 *
 *  **Two of the three legs retry, so the sum is per ATTEMPT, not per leg.** The
 *  first version of this budget multiplied one of them and not the other and
 *  claimed 55s against a real 70s, over the ceiling the section exists to respect.
 *  Each count below names the call site that justifies it; `probe-budget.test.ts`
 *  asserts the total, so adding an attempt anywhere reds a test rather than
 *  silently spending the bridge's abort. */
const IMAGE_SEARCH_TIMEOUT_MS = 6_000;
const DOWNLOAD_TIMEOUT_MS = 10_000;
const PROBE_OCR_TIMEOUT_MS = 30_000;

/** Two. `image-search.ts` re-requests once when the response was defective
 *  (`if (best.dropped > 0)`). Each of those costs `IMAGE_SEARCH_TIMEOUT_MS` only
 *  because that call site caps `fetchWithRetry`'s retry BUDGET as well as the
 *  per-request timeout; without that cap the default 10s budget stands and each
 *  attempt costs 10s regardless of the number here (measured, 2026-09-30). A
 *  count is not enough on its own — the duration it multiplies has to be real. */
export const IMAGE_SEARCH_ATTEMPTS = 2;
/** One. `fs-image-fetch.ts` CAN issue a fallback after the primary, but only
 *  when `resolveFsImageInput` produced a `fallbackUrl`, and it does that for the
 *  `ark` shape alone. This tool always passes an `imageId`, so the fallback is
 *  unreachable here. Raise this the moment the tool resolves an ark. */
export const DOWNLOAD_ATTEMPTS = 1;
/** `ocr.ts` retries a transport failure, but never a timeout — a full-budget
 *  first attempt is the worst case, so this leg counts once. */
export const OCR_ATTEMPTS = 1;

/** Cowork's device bridge aborts every MCP call at this (spec §8). */
export const COWORK_CALL_ABORT_MS = 60_000;

/** What one `volume_bisect` call can cost when every attempt runs to its bound. */
export const PROBE_WORST_CASE_MS =
  IMAGE_SEARCH_ATTEMPTS * IMAGE_SEARCH_TIMEOUT_MS +
  DOWNLOAD_ATTEMPTS * DOWNLOAD_TIMEOUT_MS +
  OCR_ATTEMPTS * PROBE_OCR_TIMEOUT_MS;

/** Measured, not reasoned (`dev/probe-volume-bisect-token-cap.ts`, 2026-09-30,
 *  `google/gemini-3.7-flash` on 004516861_00027). The first value here was 32, on
 *  the reasoning that a year is a handful of tokens. It is not: reasoning tokens
 *  count against `max_tokens`, and at 32 AND at 128 the model returned the
 *  truncated string "18" for a page reading 1821. That is the dangerous shape —
 *  not an error but a short answer, which `parseProbeYear` reads as NO YEAR, so a
 *  dated page is recorded null and three of them end the hunt on the blank-run
 *  rule. 256 was the first cap to return "1821"; 512 is that with margin. */
const PROBE_MAX_TOKENS = 512;

/** Consecutive blank leaves before the tool stops rather than walking forever. */
const MAX_CONSECUTIVE_NULL_READINGS = 3;

const PROBE_PROMPT =
  "Read only the year this register page covers. Look for a year heading, a " +
  "column header, or the year written at the head of the first entry. Reply " +
  "with that year as four digits and nothing else. If the page shows no year " +
  "— a cover, a blank leaf, an index, a filming target card — reply exactly " +
  "NO YEAR.";

/**
 * Scan maximal digit runs left to right and take the FIRST whose value is in
 * range, ignoring runs outside it — not "the first run, rejected if out of
 * range", which differ on any page whose heading follows a page number. Never
 * `Number.parseInt`, which reads 16 out of "16xx".
 */
export function parseProbeYear(text: string): number | null {
  for (const m of text.matchAll(/\d+/g)) {
    if (m[0].length !== 4) continue;
    const n = Number(m[0]);
    if (n >= YEAR_MIN && n <= YEAR_MAX) return n;
  }
  return null;
}

function validateReadings(
  readings: VolumeBisectReading[],
  imageIds: string[],
): void {
  const seen = new Set<number>();
  for (const r of readings) {
    if (!Number.isInteger(r.position) || r.position < 0 || r.position >= imageIds.length) {
      throw new Error(
        `A reading names position ${r.position}, which is outside this sub-volume's ` +
          `${imageIds.length} images. Positions index the sub-volume's own ordered list.`,
      );
    }
    if (seen.has(r.position)) {
      throw new Error(`Position ${r.position} appears twice in readings.`);
    }
    seen.add(r.position);
    if (imageIds[r.position] !== r.imageId) {
      throw new Error(
        `The volume list changed between calls, re-seed: position ${r.position} was ` +
          `probed as ${r.imageId} and now names ${imageIds[r.position]}. Discard the ` +
          `readings and start again from an empty list.`,
      );
    }
    if (r.year !== null) {
      if (!Number.isInteger(r.year) || r.year < YEAR_MIN || r.year > YEAR_MAX) {
        throw new Error(
          `A reading carries year ${r.year}, outside ${YEAR_MIN}-${YEAR_MAX}. Use null ` +
            `for a page with no year rather than a sentinel value.`,
        );
      }
    }
  }
}

/** The bracket the dated readings imply, seeded from the sub-volume's own ends
 *  (spec §9) rather than from volume_search's catalogue span. */
function bracketFrom(
  readings: VolumeBisectReading[],
  targetYear: number,
  lastPosition: number,
): VolumeBisectBracket {
  const dated = readings
    .filter((r): r is VolumeBisectReading & { year: number } => r.year !== null)
    .sort((a, b) => a.position - b.position);
  let low: VolumeBisectReading & { year: number } | undefined;
  let high: VolumeBisectReading & { year: number } | undefined;
  for (const r of dated) {
    if (r.year <= targetYear) low = r;
    if (r.year >= targetYear && high === undefined) high = r;
  }
  return {
    lowPosition: low?.position ?? 0,
    lowYear: low?.year ?? null,
    highPosition: high?.position ?? lastPosition,
    highYear: high?.year ?? null,
  };
}

/** A dated reading that contradicts the bracket it falls inside. Inside one
 *  sub-volume that means year headings are not resolving the volume, and another
 *  probe cannot fix it (spec §6). */
function firstContradiction(
  readings: VolumeBisectReading[],
): [VolumeBisectReading, VolumeBisectReading] | undefined {
  const dated = readings
    .filter((r): r is VolumeBisectReading & { year: number } => r.year !== null)
    .sort((a, b) => a.position - b.position);
  for (let i = 1; i < dated.length; i++) {
    if (dated[i].year < dated[i - 1].year) return [dated[i - 1], dated[i]];
  }
  return undefined;
}

/** The midpoint, stepped outward to the first position not already probed, so a
 *  run of blank leaves walks instead of re-probing one image. */
function nextPosition(
  bracket: VolumeBisectBracket,
  probed: Set<number>,
  lastPosition: number,
): number | undefined {
  const mid = Math.floor((bracket.lowPosition + bracket.highPosition) / 2);
  for (let step = 0; step <= lastPosition; step++) {
    for (const cand of [mid - step, mid + step]) {
      if (cand >= 0 && cand <= lastPosition && !probed.has(cand)) return cand;
    }
  }
  return undefined;
}

/** The bisect has gone as far as the volume allows: both ends of the bracket are
 *  dated readings and no image lies between them. `nextPosition` steps outward
 *  from the midpoint across the whole sub-volume, so without this it walks OUT of
 *  a closed bracket and bills an OCR probe per call that cannot narrow anything —
 *  and the agent is told to keep calling. Both ends must be dated: an unseeded
 *  bracket defaults to 0/lastPosition, which is not a reading. */
function isClosed(bracket: VolumeBisectBracket): boolean {
  return (
    bracket.lowYear !== null &&
    bracket.highYear !== null &&
    bracket.highPosition - bracket.lowPosition <= 1
  );
}

function closedMessage(bracket: VolumeBisectBracket): string {
  return (
    `The target falls between position ${bracket.lowPosition} (${bracket.lowYear}) and ` +
    `position ${bracket.highPosition} (${bracket.highYear}), which are adjacent — no ` +
    `image lies between them, so no further probe can narrow this. Read those pages.`
  );
}

/** A sentence for the stop message when every dated reading sits on ONE side of
 *  the target, i.e. nothing read so far covers the year asked for.
 *
 *  Not keyed on the bracket being outside `[lowYear, highYear]`: `bracketFrom`
 *  picks the ends AROUND the target, so whenever both are dated the target is
 *  inside them by construction and that test can never fire. The one-sided case
 *  is the one that happens — `004516861_001_M9S4-SQB` covers 1815-1821 and a
 *  1690s target walks to the front of the book and stops (spec §9).
 *
 *  Advisory only, appended to a stop the tool was already making. It does NOT
 *  stop the bisect early: positions below the lowest reading may still be
 *  unprobed, and a register whose first pages are out of order would otherwise
 *  be abandoned on a guess. */
function coverageHint(
  readings: VolumeBisectReading[],
  targetYear: number,
): string | undefined {
  const years = readings
    .map((r) => r.year)
    .filter((y): y is number => y !== null);
  if (years.length === 0) return undefined;
  const low = Math.min(...years);
  const high = Math.max(...years);
  if (targetYear >= low && targetYear <= high) return undefined;
  const side = targetYear < low ? "earlier than" : "later than";
  return (
    ` Every page read so far dates to ${low}-${high}, and ${targetYear} is ` +
    `${side} that — this may be the wrong sub-volume. Check volume_search for ` +
    `another Natural Group on this film.`
  );
}

function trailingNullRun(readings: VolumeBisectReading[]): number {
  let n = 0;
  for (let i = readings.length - 1; i >= 0 && readings[i].year === null; i--) n++;
  return n;
}

export async function volumeBisectTool(
  input: VolumeBisectInput,
  principal: Principal,
): Promise<VolumeBisectResult> {
  const groupName = (input.imageGroupNumber ?? "").trim();
  if (!SPLIT_GROUP.test(groupName)) {
    throw new Error(
      `"${groupName}" is not a sub-volume name. A bare image-group prefix names a whole ` +
        `film, which concatenates bound books — year is not monotone across it, so a ` +
        `bisect converges on the wrong book with a plausible reading at every step. Call ` +
        `volume_search for this film and pass one of its Natural Group names ` +
        `(e.g. 004516861_001_M9S4-SQB).`,
    );
  }
  if (
    !Number.isInteger(input.targetYear) ||
    input.targetYear < YEAR_MIN ||
    input.targetYear > YEAR_MAX
  ) {
    throw new Error(`targetYear must be an integer in ${YEAR_MIN}-${YEAR_MAX}.`);
  }

  // Resolve credentials BEFORE reading bytes, so a missing key fails fast rather
  // than after a download.
  const apiKey = await getOpenRouterApiKey(principal);
  const model = await getOpenRouterModel(principal);

  const { imageIds } = await imageSearchTool(
    { imageGroupNumber: groupName },
    principal,
    { timeoutMs: IMAGE_SEARCH_TIMEOUT_MS },
  );
  if (imageIds.length === 0) {
    throw new Error(`${groupName} returned no images.`);
  }
  const lastPosition = imageIds.length - 1;

  const readings = input.readings ?? [];
  validateReadings(readings, imageIds);

  const contradiction = firstContradiction(readings);
  if (contradiction) {
    const [a, b] = contradiction;
    return {
      bracket: bracketFrom(readings, input.targetYear, lastPosition),
      confidence: "non-monotonic",
      stopped:
        `Position ${a.position} reads ${a.year} but the later position ${b.position} ` +
        `reads ${b.year}. Year headings are not resolving this sub-volume, so a further ` +
        `probe cannot narrow it — read the bracket by hand or pivot to the indexed route.`,
    };
  }

  if (trailingNullRun(readings) >= MAX_CONSECUTIVE_NULL_READINGS) {
    return {
      bracket: bracketFrom(readings, input.targetYear, lastPosition),
      confidence: "inconclusive",
      stopped:
        `${MAX_CONSECUTIVE_NULL_READINGS} consecutive probes found no year (covers, ` +
        `blank leaves or target cards). Stopping rather than walking the volume a page ` +
        `at a time.` + (coverageHint(readings, input.targetYear) ?? ""),
    };
  }

  const probed = new Set(readings.map((r) => r.position));
  const bracketBefore = bracketFrom(readings, input.targetYear, lastPosition);
  if (isClosed(bracketBefore)) {
    return {
      bracket: bracketBefore,
      confidence: "resolved",
      stopped: closedMessage(bracketBefore),
    };
  }
  const position = nextPosition(bracketBefore, probed, lastPosition);
  if (position === undefined) {
    return {
      bracket: bracketBefore,
      confidence: "resolved",
      stopped:
        "Every image in this sub-volume has been probed." +
        (coverageHint(readings, input.targetYear) ?? ""),
    };
  }

  const imageId = imageIds[position];
  const resolved = resolveFsImageInput({ imageId }, "volume_bisect");
  const fetched = await fetchFsImageBytes(
    resolved.url,
    resolved.fallbackUrl,
    principal,
    resolved.memoryShape,
    { timeoutMs: DOWNLOAD_TIMEOUT_MS },
  );
  const ocr = await runOcr({
    bytes: fetched.bytes,
    contentType: fetched.contentType,
    sizeBytes: fetched.bytes.length,
    prompt: PROBE_PROMPT,
    apiKey,
    model,
    timeoutMs: PROBE_OCR_TIMEOUT_MS,
    maxTokens: PROBE_MAX_TOKENS,
  });

  const reading: VolumeBisectReading = {
    position,
    imageId,
    year: parseProbeYear(ocr.text),
  };
  const all = [...readings, reading];
  const bracket = bracketFrom(all, input.targetYear, lastPosition);
  const browseBudget = recordBrowseAndCheckBudget(imageId, input.projectPath, "bisect");

  const after = firstContradiction(all);
  if (after) {
    const [a, b] = after;
    return {
      bracket,
      confidence: "non-monotonic",
      reading,
      ...(browseBudget ? { browseBudget } : {}),
      stopped:
        `Position ${a.position} reads ${a.year} but the later position ${b.position} ` +
        `reads ${b.year}. Year headings are not resolving this sub-volume.`,
    };
  }

  if (isClosed(bracket)) {
    return {
      bracket,
      confidence: "resolved",
      reading,
      ...(browseBudget ? { browseBudget } : {}),
      stopped: closedMessage(bracket),
    };
  }

  const nextPos = nextPosition(bracket, new Set(all.map((r) => r.position)), lastPosition);
  return {
    bracket,
    confidence: reading.year === null ? "inconclusive" : "converging",
    reading,
    ...(nextPos !== undefined ? { nextImageId: imageIds[nextPos] } : {}),
    ...(browseBudget ? { browseBudget } : {}),
  };
}

export const volumeBisectSchema = {
  name: "volume_bisect",
  description:
    "Bisect a browse-only image volume toward a target year. Reads ONE page per " +
    "call and returns the narrowed year bracket plus the next image to read — " +
    "echo the returned `reading` back in `readings` on the next call. Takes a " +
    "sub-volume (Natural Group) name from volume_search, never a bare image-group " +
    "prefix: year is not monotone across a whole film.",
  inputSchema: {
    type: "object" as const,
    properties: {
      imageGroupNumber: {
        type: "string",
        description:
          "A split Natural Group name from volume_search, e.g. 004516861_001_M9S4-SQB.",
      },
      targetYear: { type: "number", description: "The year to reach (1500-1950)." },
      readings: {
        type: "array",
        description: "Probes so far; echo each returned `reading` back here.",
        items: {
          type: "object",
          properties: {
            position: { type: "number" },
            imageId: { type: "string" },
            year: { type: ["number", "null"] },
          },
          required: ["position", "imageId", "year"],
        },
      },
      projectPath: {
        type: "string",
        description: "Charges the browse budget to this project.",
      },
    },
    required: ["imageGroupNumber", "targetYear"],
  },
};
