// match-engine — the shared FamilySearch `matchTwoExamples` pair scorer.
//
// Lifted verbatim from `same-person.ts` (which now re-imports `scorePair`) so a
// second consumer — `rank_search_matches` — can score one subject against many
// candidates in a bounded host-side fan-out without duplicating the anchoring,
// id-mint, and error-handling logic. `same_person`'s public contract is
// unchanged: it still exports `samePerson` / `samePersonSchema` and behaves
// identically.
//
// This is a *closure*: `scorePair` pulls `throwForBadStatus`, `parseArkFromTitle`,
// the `URL` const, and the `SamePersonApiResponse`/`SamePersonResult` types;
// `buildRawWithAnchor` pulls `toValidFsArk`, `randomFsId`, and the
// `FS_ID_ALPHABET`/`VALID_FS_ID_RE`/`DEFAULT_ARK_TYPE`/`PERSISTENT_ID` consts.
//
// Spec: docs/specs/rank-search-matches-tool-spec.md (Files §).

import { BROWSER_USER_AGENT } from "../constants.js";
import { toGedcomX } from "./gedcomx-convert.js";
import { toArk } from "./ark.js";
import type { GedcomX, SimplifiedGedcomX } from "../types/gedcomx.js";
import type {
  SamePersonApiResponse,
  SamePersonResult,
} from "../types/same-person.js";

const URL =
  "https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples";

// ─── Single-pair scoring ─────────────────────────────────────────────────────

/**
 * Score one (id1, id2) pair against FamilySearch matchTwoExamples, anchoring
 * each side's full document on the given id. `same_person`'s single-pair path,
 * its relatives-mode pairs, and `rank_search_matches`' fan-out all go through
 * this one function.
 */
export async function scorePair(
  gedcomx1: SimplifiedGedcomX,
  id1: string,
  gedcomx2: SimplifiedGedcomX,
  id2: string,
  token: string,
): Promise<SamePersonResult> {
  const raw1 = buildRawWithAnchor(gedcomx1, id1);
  const raw2 = buildRawWithAnchor(gedcomx2, id2);

  let response: Response;
  try {
    response = await fetch(URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": BROWSER_USER_AGENT,
      },
      body: JSON.stringify({
        entries: [
          { content: { gedcomx: raw1 } },
          { content: { gedcomx: raw2 } },
        ],
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach FamilySearch matchTwoExamples API: ${message}.`,
    );
  }

  if (!response.ok) {
    await throwForBadStatus(response);
  }

  const body = (await response.json()) as SamePersonApiResponse;

  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    throw new Error(
      "matchTwoExamples API returned no entries[]; this is unexpected per FS behavior.",
    );
  }

  const entry = body.entries[0];
  const result: SamePersonResult = {
    matched: entry.confidence !== undefined,
    score: entry.score,
    queryArk: parseArkFromTitle(body.title),
    candidateArk: toArk(entry.id),
    apiTitle: body.title,
    updated: body.updated,
  };
  if (entry.confidence !== undefined) {
    result.confidence = entry.confidence;
  }
  return result;
}

// ─── Raw-document assembly + FS-id mint ──────────────────────────────────────

const PERSISTENT_ID = "http://gedcomx.org/Persistent";

// FamilySearch persona ids are 4-char-3-char (e.g. "KGS8-LY1") drawn from
// A-Z0-9 minus the vowels A/E/I/O/U. matchTwoExamples requires the Persistent
// identifier in full canonical ARK form (`ark:/61903/n:n:<id>`) — a bare id is
// rejected as "M2E Invalid Feed supplied". For ids that aren't already in valid
// FS format (made-up local ids, stubs), we mint a random conforming id so the
// API never chokes on a malformed id (per Dallan/Richard, 2026-06-23). The
// score is unaffected — FS matches on the document content, and relatives-mode
// results report the caller's local ids, not these FS-facing ones.
const FS_ID_ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ0123456789"; // A-Z0-9 minus AEIOU
const VALID_FS_ID_RE = /^[BCDFGHJKLMNPQRSTVWXYZ0-9]{4}-[BCDFGHJKLMNPQRSTVWXYZ0-9]{3}$/;
const DEFAULT_ARK_TYPE = "1:1"; // record-persona type, used when none is known

function randomFsId(): string {
  const pick = (n: number): string =>
    Array.from(
      { length: n },
      () => FS_ID_ALPHABET[Math.floor(Math.random() * FS_ID_ALPHABET.length)],
    ).join("");
  return `${pick(4)}-${pick(3)}`;
}

// Normalize a person's `ark` to a full canonical ARK whose id segment is a
// valid FS persona id, minting a random conforming id when it isn't.
function toValidFsArk(ark: string): string {
  const canonical = toArk(ark);
  const m = canonical.match(/^ark:\/61903\/(\d:\d):(.+)$/);
  const type = m ? m[1] : DEFAULT_ARK_TYPE;
  const id = m ? m[2] : canonical;
  const validId = VALID_FS_ID_RE.test(id.toUpperCase()) ? id : randomFsId();
  return `ark:/61903/${type}:${validId}`;
}

// True when `ark` is already a full canonical ARK whose id segment is a valid
// FS persona id — i.e. matchTwoExamples will accept it without minting.
function isValidFsArk(ark: string): boolean {
  const m = ark.match(/^ark:\/61903\/\d:\d:(.+)$/);
  return m !== null && VALID_FS_ID_RE.test(m[1].toUpperCase());
}

export function buildRawWithAnchor(
  simplified: SimplifiedGedcomX,
  primaryId: string,
): GedcomX {
  const raw = toGedcomX(simplified);

  // Restore the Persistent identifier to a full, valid-format canonical ARK.
  // The general gedcomx converter intentionally emits the bare id (it stays
  // API-agnostic); this matchTwoExamples-specific requirement lives in the
  // engine. The full ARK comes from the simplified person's `ark` field, since
  // the converter's bare id has already dropped the `n:n:` type segment.
  const arkById = new Map<string, string>();
  for (const p of simplified.persons ?? []) {
    if (p.id !== undefined && typeof p.ark === "string" && p.ark.length > 0) {
      arkById.set(p.id, toValidFsArk(p.ark));
    }
  }
  for (const person of raw.persons ?? []) {
    if (person.id === undefined) continue;
    const ark = arkById.get(person.id);
    if (ark && person.identifiers?.[PERSISTENT_ID]) {
      person.identifiers[PERSISTENT_ID] = [ark];
    }
  }

  // Mint-hardening (rank_search_matches spec §2): the FOCUS person — the side
  // anchored by `primaryId` — must ALWAYS carry a valid-format Persistent id so
  // matchTwoExamples scores on document CONTENT rather than merely tolerating a
  // missing/malformed id. An ark-less focus person (the tree subject stores only
  // `id`; an external-site record carries no FS ark) otherwise gets no
  // Persistent id from the converter above and scores only because the API is
  // lenient — which we should not depend on. Synthesize a conforming ark-less id
  // here. A focus person that already has a valid ark keeps the id normalized in
  // the loop above (so the existing `same_person` behavior is unchanged).
  const focus = raw.persons?.find((p) => p.id === primaryId);
  if (focus) {
    const existing = focus.identifiers?.[PERSISTENT_ID]?.[0];
    if (!existing || !isValidFsArk(existing)) {
      const minted =
        arkById.get(primaryId) ??
        `ark:/61903/${DEFAULT_ARK_TYPE}:${randomFsId()}`;
      focus.identifiers = {
        ...(focus.identifiers ?? {}),
        [PERSISTENT_ID]: [minted],
      };
    }
  }

  // Append the sourceDescription anchor with a unique id to avoid colliding
  // with any caller-provided sourceDescription that might already use a
  // common id like "mainSrc".
  raw.sourceDescriptions = [
    ...(raw.sourceDescriptions ?? []),
    { id: "match-anchor", about: "#" + primaryId },
  ];
  return raw;
}

// ─── Response helpers ────────────────────────────────────────────────────────

// Parse the ARK out of the API's `title` field, in canonical `ark:/...`
// form to match `candidateArk`. Returns the raw title if no ARK is found.
function parseArkFromTitle(title: string): string {
  const match = title.match(/ark:\/[\w/:.\-]+/);
  if (!match) return title;
  return match[0];
}

async function throwForBadStatus(response: Response): Promise<never> {
  const status = response.status;
  if (status === 401) {
    throw new Error(
      "FamilySearch session not accepted; call the login tool to re-authenticate.",
    );
  }
  if (status === 403) {
    // Imperva WAF body looks like { errorCode: "15", description: "..." }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const isWaf =
      body !== null &&
      typeof body === "object" &&
      "errorCode" in body &&
      (body as { errorCode?: unknown }).errorCode === "15";
    if (isWaf) {
      throw new Error(
        "FamilySearch matchTwoExamples blocked by WAF. The User-Agent header " +
        "was rejected — check that the MCP server is running an unmodified build.",
      );
    }
    throw new Error(
      `FamilySearch matchTwoExamples API error: 403 ${response.statusText}.`,
    );
  }
  if (status === 400) {
    let detail: string | null = null;
    try {
      const body = (await response.json()) as { detail?: unknown };
      detail = typeof body.detail === "string" ? body.detail : null;
    } catch {
      detail = null;
    }
    throw new Error(
      detail
        ? `FamilySearch matchTwoExamples rejected the payload: ${detail}.`
        : `FamilySearch matchTwoExamples rejected the payload (400 ${response.statusText}).`,
    );
  }
  throw new Error(
    `FamilySearch matchTwoExamples API error: ${status} ${response.statusText}.`,
  );
}
