// Low-level FamilySearch Places API access — the raw HTTP fetchers that sit
// below the tool layer. Both `utils/place-resolver.ts` (the standardPlace↔ID
// resolution + caching layer) and `tools/place-search.ts` (the place_search /
// place_search_all tool logic) build on these. Keeping them here, rather than
// inside place-search.ts, avoids the resolver (a util) having to import from a
// tool. No caching, no resolution policy — just fetch + parse.

import type {
  FSPlaceSearchResponse,
  FSPlaceDescriptionResponse,
} from "../types/place.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { fetchWithTimeout } from "./http.js";

const FS_API_BASE = "https://api.familysearch.org/platform/places";
// FamilySearch's place service (the one the research-places website uses). It
// carries curated per-place external links — including the correct Wikipedia
// link — that the public /platform/places API does not expose.
const FS_PLACE_WS_UI_BASE =
  "https://www.familysearch.org/service/standards/place/ws-ui/places/reps";
const FS_PRIMARY_IDENTIFIER_KEY = "http://gedcomx.org/Primary";

interface FSPlaceLookupEntry {
  id: string;
  place?: { resource?: string; resourceId?: string };
  identifiers?: Record<string, string[]>;
  display?: { name: string; fullName: string; type: string };
}

interface FSPlaceLookupResponse {
  places?: FSPlaceLookupEntry[];
}

export interface SearchPlaceResult {
  placeId?: string;     // Primary
  placeRepId: string;   // rep
  name: string;
  fullName: string;
  type: string;
  latitude?: number;
  longitude?: number;
  dateRange?: string;
  score?: number;
}

export interface GetPlaceResult extends SearchPlaceResult {
  parentPlaceRepId?: string;
}

/**
 * Extract the bare Primary place ID from the identifiers map.
 * The Primary value is a URL of the form
 * "https://api.familysearch.org/platform/places/{primaryId}"; the bare ID
 * is the last path segment. Returns undefined if the Primary identifier
 * is missing or malformed.
 */
export function extractPrimaryId(
  identifiers: Record<string, string[]> | undefined
): string | undefined {
  const url = identifiers?.[FS_PRIMARY_IDENTIFIER_KEY]?.[0];
  if (!url) return undefined;
  const segments = url.split("/");
  const last = segments[segments.length - 1];
  return last || undefined;
}

// FamilySearch's place search parses Lucene operator characters even inside a
// phrase-quoted `name:"..."` value, so a recorded place carrying one silently
// matches somewhere else. Measured live, each isolated to the single character
// (dev/probe-place-special-chars.ts):
//
//   "…7 & 9 Ogden city Ward 2, Weber, Utah"  -> Election District S, Denver, COLORADO
//   "Great & Little Singleton, …, Lancashire" -> Great and Little Elm, SOMERSET
//   "??Gren"                                  -> Angren, Tashkent, UZBEKISTAN
//   "Marshall Sal*, Missouri"                 -> Saline County Poor Farm CEMETERY
//   "Alverson Cemetery #1, …, Indiana"        -> Alverson Cemetery, NORTH CAROLINA
//
// None of these are query syntax the caller meant — they are transcription
// artifacts of census districts, cemetery plots and illegible text.
//
// Backslash-escaping instead of stripping was measured and does NOT work:
// `\&` and `\#` behave exactly as the bare character (same wrong place, same
// score), and `\?` / `\*` make FamilySearch return HTTP 400. The endpoint does
// not honour Lucene escaping, so stripping is the only option that recovers
// the right place.
//
// Stripping costs nothing even when the character is genuinely part of a place
// name: the last case above then matches FamilySearch's own "Alverson Cemetery
// #1" at 95, because their index normalises the character the same way. It is
// legitimate in their DATA and merely unusable in the QUERY.
//
// Deliberately NOT stripped: `:` `(` `)` `[` `]` `/` `-` and doubled commas all
// measured harmless (same top hit, lower score), and hyphens are load-bearing
// in real names like "Hauts-de-France".
const LUCENE_OPERATORS = /[&?*#!^~|]/g;

function sanitizeForNameQuery(name: string): string {
  return name.replace(LUCENE_OPERATORS, " ").replace(/\s+/g, " ").trim();
}

export async function searchPlace(
  name: string,
  opts: { date?: number } = {},
): Promise<SearchPlaceResult[]> {
  // Phrase-quote the value: an unquoted multi-word `name:` query is parsed by
  // FamilySearch's search as an OR of tokens, so a place literally named just
  // one token (e.g. "West" in Cameroon) can outscore the real multi-word
  // place entirely — verified live: unquoted "West Bromwich" returns no
  // West-Bromwich-shaped result at all; quoted, the correct England/UK
  // entries rank first. See tests/utils/place-api.test.ts.
  // `+date:+YYYY` restricts scoring to the place representations that existed in
  // that year. Jurisdictions move: "Rochdale, England" resolves to Greater
  // Manchester undated (a county created in 1974) and to Lancashire at
  // +date:+1880. Omitting the option leaves the URL byte-identical to the
  // undated form. https://developers.familysearch.org/main/docs/search-for-places
  const dateQualifier =
    opts.date === undefined ? "" : encodeURIComponent(` +date:+${opts.date}`);
  const safeName = sanitizeForNameQuery(name);
  if (!safeName) return [];
  const url = `${FS_API_BASE}/search?q=name:${encodeURIComponent(`"${safeName}"`)}${dateQualifier}`;

  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/x-gedcomx-atom+json",
      // Pins the LANGUAGE THE ANSWER IS RENDERED IN, not what matches. Measured
      // live: the same query scores identically under en/de/nl and only the
      // returned fullName changes ("Bavaria, Germany" / "Bayern, Deutschland" /
      // "Bayern, Duitsland"). Matching is already language-agnostic — a Dutch or
      // Czech input resolves at full score with no header at all.
      //
      // Sent explicitly because the server default happens to be en today, and
      // every persisted `standard_place` is that default. Without this header a
      // change upstream (or an injected one from a proxy) would silently switch
      // the language of every place we write, while `place.normalized` from the
      // read tools stayed en — they already send this header. Plan §5.2 asked
      // for it on reads; the resolver never got it.
      "Accept-Language": "en",
    },
  });

  if (!response.ok) {
    throw new Error(`FamilySearch API error: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  if (!text || text.trim() === "") {
    return [];
  }

  const data: FSPlaceSearchResponse = JSON.parse(text);

  if (!data.entries || data.entries.length === 0) {
    return [];
  }

  return data.entries.map((entry) => {
    const place = entry.content.gedcomx.places[0];
    return {
      placeId: extractPrimaryId(place.identifiers),
      placeRepId: entry.id,
      name: place.display.name,
      fullName: place.display.fullName,
      type: place.display.type,
      latitude: place.latitude,
      longitude: place.longitude,
      dateRange: place.temporalDescription?.formal,
      score: entry.score,
    };
  });
}

/**
 * Get place details by Primary ID using FamilySearch API.
 * The Primary ID is the canonical place ID (placeId) returned by the places tool.
 * Returns null for 404 (invalid ID), throws for other errors.
 */
export async function getPlaceByPrimaryId(primaryId: string): Promise<GetPlaceResult | null> {
  const url = `${FS_API_BASE}/${primaryId}`;

  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`FamilySearch API error: ${response.status} ${response.statusText}`);
  }

  const data: FSPlaceDescriptionResponse = await response.json();

  // The response contains two objects: the place (names only, no display/coords)
  // and the place description (has display, latitude, longitude). Use the latter.
  const place = data.places?.find((p) => p.display != null);
  if (!place) {
    return null;
  }

  return {
    placeId: extractPrimaryId(place.identifiers),
    placeRepId: place.id,
    name: place.display.name,
    fullName: place.display.fullName,
    type: place.display.type,
    latitude: place.latitude,
    longitude: place.longitude,
    dateRange: place.temporalDescription?.formal,
    parentPlaceRepId: place.jurisdiction?.resourceId,
  };
}

/**
 * Get place details by ID using FamilySearch API.
 * Returns null for 404 (invalid ID), throws for other errors.
 */
export async function getPlaceById(id: string): Promise<GetPlaceResult | null> {
  const url = `${FS_API_BASE}/description/${id}`;

  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`FamilySearch API error: ${response.status} ${response.statusText}`);
  }

  const data: FSPlaceDescriptionResponse = await response.json();

  if (!data.places || data.places.length === 0) {
    return null;
  }

  const place = data.places[0];

  return {
    placeId: extractPrimaryId(place.identifiers),
    placeRepId: place.id,
    name: place.display.name,
    fullName: place.display.fullName,
    type: place.display.type,
    latitude: place.latitude,
    longitude: place.longitude,
    dateRange: place.temporalDescription?.formal,
    parentPlaceRepId: place.jurisdiction?.resourceId,
  };
}

interface FSPlaceAttribute {
  type?: { code?: string };
  url?: string;
}
interface FSPlaceAttributesResponse {
  attributes?: FSPlaceAttribute[];
}

/**
 * Get the curated Wikipedia URL FamilySearch stores for a place rep.
 *
 * FamilySearch keeps a per-place `WIKIPEDIA_LINK` attribute (e.g. Paris, Idaho
 * → en.wikipedia.org/wiki/Paris,_Idaho) on its place service — the same one the
 * research-places website uses. This is correct per-place, unlike a name-based
 * Wikipedia lookup. Returns null when the place has no such attribute or on any
 * error (graceful degradation — the Wikipedia link is optional enrichment).
 *
 * Note: places may also carry an `FS_WIKI_LINK` attribute (the FamilySearch
 * research wiki, a different thing); we take only `WIKIPEDIA_LINK`.
 */
export async function getPlaceWikipediaUrl(repId: string): Promise<string | null> {
  const url = `${FS_PLACE_WS_UI_BASE}/${encodeURIComponent(repId)}/attributes/`;

  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": BROWSER_USER_AGENT,
        "FS-User-Agent-Chain": "zion-user",
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as FSPlaceAttributesResponse;
    const wiki = (data.attributes ?? []).find(
      (a) => a.type?.code === "WIKIPEDIA_LINK" && !!a.url
    );
    return wiki?.url ?? null;
  } catch {
    return null;
  }
}

type PrimaryIdResponse = {
  places?: Array<{ id: string; names?: Array<{ lang: string; value: string }> }>;
};

async function fetchPrimaryIdResponse(primaryId: string): Promise<PrimaryIdResponse> {
  const url = `${FS_API_BASE}/${primaryId}`;
  const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    if (response.status === 404) return {};
    throw new Error(`FamilySearch API error: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as PrimaryIdResponse;
}

export async function getPlaceCandidateNames(primaryId: string): Promise<string[]> {
  const data = await fetchPrimaryIdResponse(primaryId);
  if (!data.places?.length) return [];

  const allNames = data.places[0].names ?? [];

  // Keep proper-case English names: starts uppercase, not all-caps (filters abbreviations like PRT, MN)
  const properEnglish = allNames
    .filter(
      (n) =>
        n.lang === "en" &&
        n.value.length > 0 &&
        n.value[0] === n.value[0].toUpperCase() &&
        n.value !== n.value.toUpperCase()
    )
    .map((n) => n.value);

  // Deduplicate; single-word names first (more likely to be the canonical wiki page name)
  const seen = new Set<string>();
  const singleWord: string[] = [];
  const multiWord: string[] = [];
  for (const name of properEnglish) {
    if (seen.has(name)) continue;
    seen.add(name);
    (name.includes(" ") ? multiWord : singleWord).push(name);
  }
  return [...singleWord, ...multiWord];
}

/**
 * Get every place representation ID for a Primary place ID via the
 * Place_resource endpoint (GET /platform/places/{pid}). The response lists the
 * bare place entry (id === pid, no `display`) followed by its representation
 * entries, each with `place.resourceId === pid`. We collect those rep IDs.
 *
 * Public (no auth) — the places endpoints accept anonymous requests.
 */
export async function getPlaceRepIds(pid: string): Promise<string[]> {
  const url = `${FS_API_BASE}/${encodeURIComponent(pid)}`;

  const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(
      `FamilySearch API error: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as FSPlaceLookupResponse;
  const reps = (data.places ?? []).filter((p) => p.place?.resourceId === pid);

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const rep of reps) {
    if (rep.id && !seen.has(rep.id)) {
      seen.add(rep.id);
      ids.push(rep.id);
    }
  }
  return ids;
}
