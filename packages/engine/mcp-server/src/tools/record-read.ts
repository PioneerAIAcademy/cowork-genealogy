import type { Principal } from "../auth/principal.js";
import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { fetchWithRetry } from "../utils/http.js";
import { toSimplified } from "../utils/gedcomx-convert.js";
import { repIdToStandardPlace } from "../utils/place-resolver.js";
import { readStagedResults, stageSearchResults } from "../utils/results-staging.js";
import { toArk, arkToBareId, isDocumentImageArk } from "../utils/ark.js";
import { extractImageContextQuery } from "../utils/fs-image-fetch.js";
import type { GedcomX, SimplifiedGedcomX } from "../types/gedcomx.js";
import type { RecordSearchResult } from "../types/record-search.js";
import type { RecordReadInput, RecordReadResult } from "../types/record-read.js";

const RECAPI_BASE =
  "https://sg30p0.familysearch.org/service/cds/recapi/records/persona";

// ─── MCP schema ───────────────────────────────────────────────────────────

export const recordReadSchema = {
  name: "record_read",
  description:
    "Fetch a FamilySearch historical record by its ARK and return it as " +
    "simplified GEDCOMX. Pass a record-persona ARK " +
    '(e.g., "ark:/61903/1:1:QVS9-DHDB") — the `recordId` returned by ' +
    "record_search. A bare entity ID (e.g., \"QVS9-DHDB\") is also accepted. " +
    "Only the 1:1: persona form is accepted: a 1:2: record ARK " +
    "(record_search's `recordArk`, or a tree source's `url`) and a 3:1:/3:2: " +
    "document-image ARK are refused, not silently resolved. " +
    "When the record carries a page-image source, the response includes an " +
    "`imageArk` field (a 3:1:/3:2: document-image ARK) for use with " +
    "image_read or image_transcribe — do not construct an image ARK from " +
    "the record ARK. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      recordId: {
        type: "string",
        description:
          "FamilySearch record-persona ARK like " +
          '"ark:/61903/1:1:QVS9-DHDB" (feed record_search\'s `recordId` ' +
          'directly). A bare entity ID like "QVS9-DHDB" is also accepted. ' +
          "Must be the 1:1: persona form. Do NOT pass `recordArk` — that is " +
          "the 1:2: household/record ARK, a different entity whose id suffix " +
          "is unrelated to any persona's; it is refused with an error. A " +
          "3:1:/3:2: document-image ARK is refused too (use image_read or " +
          "image_transcribe). Required.",
      },
      resultsRef: {
        type: "string",
        description:
          "Optional. A `staged.resultsRef` handle from record_search (or a " +
          "finalized results/<log_id>.json ref) — read this record from that " +
          "sidecar host-side, WITHOUT a live FamilySearch fetch. For the person " +
          "you searched, the sidecar carries the same facts, the source citation, " +
          "and standardized places from the search stage (a live read keeps only " +
          "the record's own normalized places, never resolver-derived ones). It returns OTHER household members " +
          "(co-residents) with reduced facts — so omit this (live read) when you " +
          "need a co-resident's full facts, or for a record that was not part of a " +
          "staged search. Requires `projectPath`.",
      },
      projectPath: {
        type: "string",
        description:
          "Absolute path to the active project directory. Required when " +
          "`resultsRef` is given (the sidecar lives under the project's results/ dir). " +
          "On a live read it also stages the fetched record host-side and returns " +
          "`staged.resultsRef` — hand it to research_log_append as stagedResultsRef.",
      },
    },
    required: ["recordId"],
  },
} as const;

// ─── Entry point ──────────────────────────────────────────────────────────

export async function recordReadTool(
  input: RecordReadInput,
  principal: Principal,
): Promise<RecordReadResult> {
  const { recordId, resultsRef, projectPath } = input;
  if (typeof recordId !== "string" || recordId.trim() === "") {
    throw new Error(
      'The record_read tool requires a non-empty recordId string ' +
        '(e.g., "QVS9-DHDB" or "ark:/61903/1:1:QVS9-DHDB").',
    );
  }

  // Sidecar mode: resolve the record from a staged/finalized search sidecar
  // instead of a live FS fetch (no network round-trip). The staged gedcomx
  // carries the same persons, facts, and relationships as a live read (verified),
  // and it already carries standardized places from the search stage
  // (record_search runs standardizePlaces) — so we return it as-is and do NOT
  // re-standardize here. A live read (omit `resultsRef`) additionally guarantees
  // the authoritative source citation.
  if (resultsRef !== undefined) {
    return await readFromSidecar(recordId.trim(), resultsRef, projectPath);
  }

  const entityId = extractEntityId(recordId.trim());
  const token = await getValidToken(principal);

  // TODO: implement fetch + convert logic
  // 1. Build URL: `${RECAPI_BASE}/${encodeURIComponent(entityId)}.json`
  // 2. Fetch with Bearer token and BROWSER_USER_AGENT
  // 3. Handle 401, 403, 404, 429, and generic errors
  // 4. Parse response body as GedcomX and call toSimplified(body)
  // 5. Return the simplified result

  const url = `${RECAPI_BASE}/${encodeURIComponent(entityId)}.json`;

  const res = await fetchWithRetry(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });

  if (res.status === 401) {
    throw new Error(
      "FamilySearch rejected the access token (401). The session may have " +
        "expired or been revoked — call the login tool to re-authenticate.",
    );
  }
  if (res.status === 403) {
    throw new Error(
      `Record ${entityId} is restricted and cannot be viewed.`,
    );
  }
  if (res.status === 404) {
    throw new Error(
      `Record ${entityId} was not found in FamilySearch historical records.`,
    );
  }
  if (res.status === 429) {
    throw new Error(
      "FamilySearch rate limit reached and did not clear within the retry budget. " +
        "Wait a minute and try again.",
    );
  }
  if (!res.ok) {
    throw new Error(`FamilySearch recapi error: ${res.status}`);
  }

  const body = (await res.json()) as GedcomX;
  // Use toSimplified, NOT toSimplifiedStandardized. toSimplified keeps whatever
  // standard_place the record's own `normalized` value supplies and never falls
  // back to the resolver; toSimplifiedStandardized would additionally resolve any
  // free-text place NAME the record left un-normalized, and the resolver
  // mis-places ambiguous names. Ruled to stay this way on a live re-probe
  // (issue #1908 Phase 2, Option 4, decided 2026-09-12). Do not flip it on the
  // two cross-country examples that motivated the original rule (observed
  // 2026-07-08: "Southampton, NY" -> "Southampton, England"; "Rochdale, England"
  // -> "Rochdale, South Africa") — neither was among the re-probe's 28
  // observations, but the run surfaced an intra-country mis-resolution that
  // countryConsistency cannot detect: "Eye Town" -> "Eye, Suffolk", where the
  // same record's fully-qualified fact reads Northamptonshire. 0 of the 28
  // carried a `normalized` place at all, so the live path filled no
  // standard_place for any probed record. Measurement and rationale:
  // docs/record-read-sidecar-scope.md; re-measure with
  // dev/probe-record-read-places.ts. Records reached via the search sidecar
  // already carry the search stage's standardized place.
  const simplified = toSimplified(body);

  await resolveCoveragePlaces(simplified);

  const imageArk = extractImageArk(simplified, entityId);
  // `imageArk` rides on the RESPONSE only — what gets staged below is the
  // record document itself, and readFromSidecar re-extracts the ark from that
  // on the way back out, so the two paths cannot disagree.
  const withImageArk: RecordReadResult = imageArk
    ? { ...simplified, imageArk }
    : simplified;

  // Stage the fetched record when the caller named the project (issue #2048 /
  // #2489): until now a record fetched by ARK was retained nowhere, so its full
  // text crossed the conversation and was lost. The element carries the same
  // `{ recordId, gedcomx }` shape record_search stages, so `readFromSidecar`
  // above reads it back unchanged and `research_log_append` finalizes it with
  // `tool: "record_read"`. Best-effort: a staging failure never fails the read.
  if (typeof projectPath === "string" && projectPath.trim() !== "") {
    let staged: RecordReadResult["staged"];
    let stagingError: string | undefined;
    try {
      staged = await stageSearchResults({
        projectPath,
        tool: "record_read",
        response: {
          query: { recordId: recordId.trim() },
          results: [{ recordId: entityId, gedcomx: simplified }],
        },
      });
    } catch (error) {
      staged = null;
      stagingError = error instanceof Error ? error.message : String(error);
    }
    return {
      ...withImageArk,
      staged,
      ...(stagingError !== undefined ? { stagingError } : {}),
    };
  }

  return withImageArk;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

// Find the first page-image source whose url is a 3:1:/3:2: document-image ARK
// and return it. This surfaces the page-image ark as a named field so the agent
// does not have to derive one from the record ark.
//
// `resource_type` is a NEGATIVE filter, not a requirement. A live read carries
// it (`DigitalArtifact`, or FamilySearch's own `DigitalArtifact#FamilySearch`
// variant), but a record_search-staged source does not: simplifySourceDescription
// sets it only when the upstream response carries `resourceType`, and a search
// response does not — every staged `sd_da1` is a bare `{ id, url }`. Requiring
// an exact match therefore returned undefined on the SIDECAR path, which is the
// path the motivating run used for all 8 of its record_read calls. A source that
// names some other type is still skipped.
//
// The url is returned with its image-context params (i=/cc=/groupId=) intact
// when it has any — 22 of the 538 document-image source urls in the corpus do.
// Those disambiguate a waypoint ark into a multi-image film, and dropping them
// can resolve to a neighbouring page with no error at all. image_read and
// image_transcribe both accept the full URL and fall back to the bare ark.
//
// `personId`, when given, is the persona the caller asked for. A record can
// carry several page-image sources — the corpus holds sd_da2/sd_da3/sd_da4 and
// one sd_da8 — and in a household spanning two scans the co-resident's entry is
// not on the first one. Returning document-order "first" would hand that caller
// a scan its person is not on, and nothing errors: the agent OCRs the wrong page
// and writes assertions from it. So the persona's OWN source refs are tried
// first, in its order, and document order is only the fallback for a record
// whose persons carry no refs.
export function extractImageArk(
  doc: SimplifiedGedcomX,
  personId?: string,
): string | undefined {
  const sources = doc.sources ?? [];

  const arkFrom = (sd: (typeof sources)[number]): string | undefined => {
    if (!sd.url) return undefined;
    if (
      sd.resource_type !== undefined &&
      !sd.resource_type.startsWith("DigitalArtifact")
    ) {
      return undefined;
    }
    const ark = toArk(sd.url);
    if (!isDocumentImageArk(ark)) return undefined;
    return ark + extractImageContextQuery(sd.url);
  };

  if (personId) {
    const wanted = arkToBareId(personId);
    const person = doc.persons?.find(
      (pp) =>
        pp.id === wanted ||
        (typeof pp.ark === "string" && arkToBareId(pp.ark) === wanted),
    );
    for (const ref of person?.sources ?? []) {
      if (!ref.ref) continue;
      const sd = sources.find((cand) => cand.id === ref.ref);
      const ark = sd && arkFrom(sd);
      if (ark) return ark;
    }
  }

  for (const sd of sources) {
    const ark = arkFrom(sd);
    if (ark) return ark;
  }
  return undefined;
}

// Resolve one record's gedcomx from a staged/finalized search sidecar by id,
// returning it as-is. The staged search result already carries standardized
// places from the search stage; this path does not re-standardize (and a live
// record_read does not standardize either — it uses pure toSimplified).
async function readFromSidecar(
  recordId: string,
  resultsRef: string,
  projectPath: string | undefined,
): Promise<RecordReadResult> {
  if (typeof projectPath !== "string" || projectPath.trim() === "") {
    throw new Error(
      "record_read with `resultsRef` also requires `projectPath` — the sidecar " +
        "lives under the project's results/ directory.",
    );
  }
  // Validate the CALLER's id before reading the sidecar, so a 1:2:/3:1: ARK is
  // refused on this path too rather than only on the live one.
  const wanted = extractEntityId(recordId);
  const results = (await readStagedResults(
    projectPath,
    resultsRef,
  )) as RecordSearchResult[];
  // Reduce each STAGED id with the lenient arkToBareId, not the validating
  // extractEntityId above. These values are stored data, not caller input: a
  // record_search sidecar carries 1:1: personas, but if one ever did not, a
  // throw inside this predicate would fail the whole read with an error naming
  // a record the caller never asked for. Collapsing the type segment is safe
  // *here* specifically because the comparison is within a single sidecar,
  // where two entities sharing an id suffix cannot both be present — the same
  // reasoning that makes arkToBareId correct for the record_id → sidecar join
  // in validator.ts.
  const match = results.find(
    (r) => typeof r?.recordId === "string" && arkToBareId(r.recordId) === wanted,
  );
  if (!match || !match.gedcomx) {
    throw new Error(
      `record '${recordId}' was not found in staged results '${resultsRef}'. ` +
        "Do a live read (omit `resultsRef`) instead, or verify the ref/id.",
    );
  }
  // Return the staged record as-is. Its standard_place values are a mixture set
  // at search time: FS-normalized where the search response supplied a
  // `normalized` value (via toSimplified), resolver-derived where it did not (via
  // record_search's standardizePlaces, whose filter fills only facts that lack a
  // standard_place). We do NOT re-run standardizePlaces here — that same filter
  // skips every fact that already has a standard_place, so a re-run cannot change
  // any value already set; it could only retry the few that resolved to null or
  // hit the soft cap, spending FS round-trips on the one path whose purpose is to
  // avoid them. A live record_read (omit resultsRef) does not resolver-standardize
  // at all: it uses pure toSimplified (see the comment above), keeping only the
  // record's own normalized places — never resolving an ambiguous place NAME and
  // mis-placing it (see the toSimplified comment above for the observed
  // mis-resolutions).
  // The staged source DOES carry the page-image ark, as a bare `{ id, url }`
  // with no resource_type (a search response does not set `resourceType`), so
  // extractImageArk must not require that label — see its comment. This is the
  // path the motivating run used for all 8 of its record_read calls.
  const staged = match.gedcomx as SimplifiedGedcomX;
  const imageArk = extractImageArk(staged, wanted);
  return imageArk ? { ...staged, imageArk } : staged;
}

async function resolveCoveragePlaces(doc: SimplifiedGedcomX): Promise<void> {
  for (const sd of doc.sources ?? []) {
    if (!sd.coverage?.place_rep_id) continue;
    const name = await repIdToStandardPlace(sd.coverage.place_rep_id);
    if (name) sd.coverage.standard_place = name;
  }
}

// Normalise the caller-supplied record ID to a bare entity ID, refusing any ARK
// that is not a record *persona* (`1:1:`).
//
//   "ark:/61903/1:1:QVS9-DHDB"                          → "QVS9-DHDB"
//   "https://www.familysearch.org/ark:/61903/1:1:QVS9-DHDB" → "QVS9-DHDB"
//   "QVS9-DHDB"                                         → "QVS9-DHDB"
//   "ark:/61903/1:2:HSJG-CLNF"                          → throws
//   "ark:/61903/3:1:3Q9M-CSNL-S98H-M"                   → throws
//
// Why this validates instead of just splitting on the last colon: FamilySearch
// ARK types are independent id spaces, so `1:1:M8GR-TJY` and `1:2:M8GR-TJY` are
// different entities that merely share a suffix. Discarding the type segment
// meant a `1:2:` record ARK was looked up in the persona namespace and the
// lookup SUCCEEDED against the wrong entity — a real person, real census, wrong
// continent, returned as a clean success with no error and no warning.
//
// Reproduced in this repo, no live call needed:
// `eval/runlogs/e2e/mary-mcandrew-son/run-2026-08-05_20-48-08.json` passes
// `ark:/61903/1:2:M8GR-TJY` (a 1920 Detroit household) and gets back persona
// `ark:/61903/1:1:M8GR-TJY` — Isaac Tremble, 1880 census, District 124,
// Richmond, Georgia, with a wife, a couple relationship and a full citation.
// Different person, decade, state and collection. That same response also shows
// the collision is structural rather than a one-off: the returned persona's own
// record ARK is `1:2:M413-54G`, so a persona's `1:1:` suffix and its record's
// `1:2:` suffix are unrelated id spaces (#2061).
//
// Rejecting is the whole fix. Widening record_read to accept `1:2:` and resolve
// it correctly is deliberately out of scope — there is no
// `…/recapi/records/record/{id}` fetcher in this codebase and nobody has probed
// for one.
//
// The returned value stays a BARE id for every accepted shape. readFromSidecar
// compares this against a staged record's own id, so returning a type-prefixed
// value here would make every sidecar read miss and silently downgrade to a live
// fetch — the round-trip the sidecar exists to avoid.
export function extractEntityId(recordId: string): string {
  const trimmed = recordId.trim();
  // toArk first, so a resolver URL and a bare `1:2:X` are inspected as ARKs
  // rather than slipping through a check anchored on a literal "ark:/" prefix.
  const typed = toArk(trimmed).match(/^ark:\/61903\/(\d:\d):(.+)$/);

  // Not an ARK at all — a bare entity id, which the schema documents as valid.
  if (!typed) return trimmed;

  const [, arkType, entityId] = typed;
  if (arkType === "1:1") return entityId;

  if (arkType === "1:2") {
    throw new Error(
      `"${trimmed}" is a 1:2: record ARK — the household/record entity, not a ` +
        "person. record_read takes the record PERSONA ARK (1:1:). A 1:2: ARK " +
        "reaches this tool as record_search's `recordArk` or as a tree source's " +
        "`url`; its id suffix is unrelated to any persona's, so it cannot be " +
        "converted here. Pass the `recordId` from the same record_search result " +
        "instead — for the household as a whole, the individual personas are its " +
        "`persons` entries.",
    );
  }

  if (arkType === "3:1" || arkType === "3:2") {
    throw new Error(
      `"${trimmed}" is a ${arkType}: document-image ARK, not a record persona. ` +
        "record_read returns indexed record data and cannot read an image. Use " +
        "image_read to fetch the image, or image_transcribe to OCR it.",
    );
  }

  throw new Error(
    `"${trimmed}" is a ${arkType}: ARK, which record_read does not accept. ` +
      'Pass a record-persona ARK ("ark:/61903/1:1:QVS9-DHDB") — the `recordId` ' +
      "returned by record_search — or a bare entity ID.",
  );
}

// Re-export input type for index.ts wiring.
export type { RecordReadInput };
