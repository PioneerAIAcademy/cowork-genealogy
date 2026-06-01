import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import type {
  PlaceCatalogInput,
  PlaceCatalogResult,
  CatalogHit,
  CatalogApiResponse,
  CatalogItemDetailResponse,
  ArtifactsPermissionsResponse,
  FulltextSearchResponse,
} from "../types/place-catalog.js";

const CATALOG_SEARCH_URL =
  "https://sg30p0.familysearch.org/service/search/catalog/v3/search";
const CATALOG_ITEM_BASE =
  "https://sg30p0.familysearch.org/service/search/catalog/item";
const PLACES_BASE = "https://api.familysearch.org/platform/places";
const FULLTEXT_URL =
  "https://www.familysearch.org/service/search/fulltext/search";
const ARTIFACTS_PERMISSIONS_URL =
  "https://www.familysearch.org/platform/artifacts/groups/permissions";

// ---------- helpers ----------

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": BROWSER_USER_AGENT,
  };
}

async function handleHttpError(response: Response): Promise<never> {
  if (response.status === 401) {
    throw new Error(
      "User is not logged in to FamilySearch. Call the login tool to authenticate."
    );
  }
  if (response.status === 400) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body.message ?? body.error ?? JSON.stringify(body);
    } catch { /* ignore parse failure */ }
    throw new Error(`FamilySearch catalog rejected the request: ${detail}.`);
  }
  throw new Error(
    `FamilySearch catalog error: ${response.status} ${response.statusText}.`
  );
}

// ---------- step 3: resolve placeId → rep IDs ----------

async function resolveRepIds(placeId: string, token: string): Promise<string[]> {
  const url = `${PLACES_BASE}/${encodeURIComponent(placeId)}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: authHeaders(token) });
  } catch (err) {
    throw new Error(
      `Could not reach FamilySearch catalog endpoint: ${err instanceof Error ? err.message : String(err)}.`
    );
  }
  if (!response.ok) await handleHttpError(response);

  const body = await response.json();
  const places: Array<{ id: string }> = body.places ?? [];
  return places.filter((p) => p.id !== placeId).map((p) => p.id);
}

// ---------- step 4: run one catalog search ----------

async function runCatalogSearch(
  params: {
    repId?: string;
    keywords?: string;
    surname?: string;
    imageGroupNumber?: string;
    count: number;
    offset: number;
  },
  token: string
): Promise<CatalogApiResponse> {
  const url = new URL(CATALOG_SEARCH_URL);
  url.searchParams.set("m.queryRequireDefault", "on");
  url.searchParams.set("m.defaultFacets", "off");
  url.searchParams.set("count", String(params.count));
  url.searchParams.set("offset", String(params.offset));

  if (params.repId) url.searchParams.set("q.place_id", params.repId);
  if (params.keywords) url.searchParams.set("q.keywords", params.keywords);
  if (params.surname) url.searchParams.set("q.surname", params.surname);
  if (params.imageGroupNumber)
    url.searchParams.set("q.film_number", params.imageGroupNumber);

  let response: Response;
  try {
    response = await fetch(url.toString(), { headers: authHeaders(token) });
  } catch (err) {
    throw new Error(
      `Could not reach FamilySearch catalog endpoint: ${err instanceof Error ? err.message : String(err)}.`
    );
  }
  if (!response.ok) await handleHttpError(response);
  return response.json() as Promise<CatalogApiResponse>;
}

// ---------- step 6: parse a single searchHit into a raw hit ----------

type RawHit = Omit<CatalogHit, "imageGroupNumbers" | "record_searchable" | "fulltext_searchable" | "image_searchable">;

function parseHit(searchHit: CatalogApiResponse["searchHits"][number]): RawHit {
  const raw = searchHit.metadataHit.metadata;
  const identifierValue = raw.identifier?.value ?? "";
  const id = identifierValue.split("/").pop() ?? identifierValue;
  return {
    id,
    title: raw.title?.[0]?.value ?? "",
    authors: raw.creator ?? [],
    holdings: (raw.repositoryCalls ?? []).map((r) => r.title),
    score: searchHit.metadataHit.score,
    url: `https://www.familysearch.org/search/catalog/${id}`,
  };
}

// ---------- step 8: enrich one hit with 3 flags ----------

async function enrichHit(
  hit: RawHit,
  token: string
): Promise<CatalogHit> {
  // Step 8a: item-detail
  let imageGroupNumbers: string[] = [];
  let record_searchable = false;

  try {
    const detailUrl = `${CATALOG_ITEM_BASE}/${encodeURIComponent(hit.id)}`;
    const detailRes = await fetch(detailUrl, { headers: authHeaders(token) });

    if (!detailRes.ok) {
      // item-detail failed → cascade: all 3 flags false
      return { ...hit, imageGroupNumbers: [], record_searchable: false, fulltext_searchable: false, image_searchable: false };
    }

    const detail: CatalogItemDetailResponse = await detailRes.json();
    const filmNotes = detail.source?.film_note
      ? Array.isArray(detail.source.film_note)
        ? detail.source.film_note
        : [detail.source.film_note]
      : [];

    record_searchable = filmNotes.some((fn) => fn.fs_indexed === "Y");

    const seen = new Set<string>();
    for (const fn of filmNotes) {
      if (fn.digital_film_no && !seen.has(fn.digital_film_no)) {
        seen.add(fn.digital_film_no);
        imageGroupNumbers.push(fn.digital_film_no);
      }
    }
  } catch {
    // item-detail network failure → cascade
    return { ...hit, imageGroupNumbers: [], record_searchable: false, fulltext_searchable: false, image_searchable: false };
  }

  if (imageGroupNumbers.length === 0) {
    return { ...hit, imageGroupNumbers: [], record_searchable, fulltext_searchable: false, image_searchable: false };
  }

  // Steps 8b + 8c in parallel
  const [fulltextResult, imageResult] = await Promise.allSettled([
    // 8b: fulltext check (first image group number only)
    (async (): Promise<boolean> => {
      const ftUrl = new URL(FULLTEXT_URL);
      ftUrl.searchParams.set("q.groupName", imageGroupNumbers[0]);
      ftUrl.searchParams.set("count", "1");
      ftUrl.searchParams.set("m.queryRequireDefault", "on");
      const res = await fetch(ftUrl.toString(), { headers: authHeaders(token) });
      if (!res.ok) throw new Error("fulltext lookup failed");
      const body: FulltextSearchResponse = await res.json();
      return (body.results ?? 0) > 0;
    })(),
    // 8c: artifacts permissions (all image group numbers)
    (async (): Promise<boolean> => {
      const res = await fetch(
        `${ARTIFACTS_PERMISSIONS_URL}?showFailedRoles=true`,
        {
          method: "POST",
          headers: {
            ...authHeaders(token),
            "Content-Type": "application/x-gedcomx-v1+json",
          },
          body: JSON.stringify({
            sourceDescriptions: imageGroupNumbers.map((id) => ({ id })),
          }),
        }
      );
      if (!res.ok) throw new Error("permissions lookup failed");
      const body: ArtifactsPermissionsResponse = await res.json();
      return (body.sourceDescriptions ?? []).some((sd) =>
        (sd.rights ?? []).includes("http://familysearch.org/v1/Allowed")
      );
    })(),
  ]);

  return {
    ...hit,
    imageGroupNumbers,
    record_searchable,
    fulltext_searchable:
      fulltextResult.status === "fulfilled" ? fulltextResult.value : false,
    image_searchable:
      imageResult.status === "fulfilled" ? imageResult.value : false,
  };
}

// Concurrency-capped enrichment of all hits
async function enrichAll(hits: RawHit[], token: string, cap = 5): Promise<CatalogHit[]> {
  const results: CatalogHit[] = new Array(hits.length);
  const indexed = hits.map((h, i) => [i, h] as [number, RawHit]);
  const queue = [...indexed];

  async function worker() {
    let item: [number, RawHit] | undefined;
    while ((item = queue.shift()) !== undefined) {
      const [idx, hit] = item;
      results[idx] = await enrichHit(hit, token);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(cap, hits.length) }, () => worker())
  );
  return results;
}

// ---------- main tool function ----------

export async function placeCatalogTool(
  input: PlaceCatalogInput
): Promise<PlaceCatalogResult> {
  const { placeId, keywords, surname, imageGroupNumber, count: rawCount, offset: rawOffset } = input;

  // 1. Validate
  if (!placeId && !keywords && !surname && !imageGroupNumber) {
    throw new Error(
      "place_catalog: at least one of placeId, keywords, surname, or imageGroupNumber is required."
    );
  }
  if (rawCount !== undefined && (rawCount < 1 || rawCount > 100)) {
    throw new Error(
      `place_catalog: count must be between 1 and 100. Got: ${rawCount}.`
    );
  }
  if (rawOffset !== undefined && rawOffset < 0) {
    throw new Error(
      `place_catalog: offset must be non-negative. Got: ${rawOffset}.`
    );
  }

  // 2. Defaults
  const count = rawCount ?? 20;
  const offset = rawOffset ?? 0;

  // 3. Auth
  const token = await getValidToken();

  // 4. Resolve rep IDs
  let repIds: string[] = [];
  if (placeId) {
    repIds = await resolveRepIds(placeId, token);
    if (repIds.length === 0) {
      throw new Error(
        `place_catalog: placeId ${placeId} has no catalog rep mapping. The place may be too granular for the catalog, or the id is wrong.`
      );
    }
  }

  // 5. Run catalog searches
  const searchAxes = { keywords, surname, imageGroupNumber, count, offset };
  const responses: CatalogApiResponse[] =
    repIds.length > 0
      ? await Promise.all(
          repIds.map((repId) => runCatalogSearch({ repId, ...searchAxes }, token))
        )
      : [await runCatalogSearch(searchAxes, token)];

  // 6. Parse hits from all responses
  const allRaw: RawHit[] = responses.flatMap((r) =>
    r.searchHits.map(parseHit)
  );
  const totalHitsSum = responses.reduce((s, r) => s + r.totalHits, 0);

  // 7. Dedup by id, keep highest score
  const byId = new Map<string, RawHit>();
  for (const hit of allRaw) {
    const prev = byId.get(hit.id);
    if (!prev || hit.score > prev.score) byId.set(hit.id, hit);
  }
  const deduped = Array.from(byId.values());
  const dedupCount = allRaw.length - deduped.length;

  // 8. Enrich with 3 flags
  const hits = await enrichAll(deduped, token);

  // 9 + 10. Return
  return {
    ...(placeId ? { placeId } : {}),
    totalHits: Math.max(0, totalHitsSum - dedupCount),
    returnedCount: hits.length,
    offset,
    hits,
  };
}

// ---------- MCP schema ----------

export const placeCatalogToolSchema = {
  name: "place_catalog",
  description:
    "Search the FamilySearch Library catalog (books, microfilms, " +
    "manuscripts, maps, periodicals). The catalog covers material " +
    "most of which is NOT indexed in record collections — it's the " +
    "right surface for locality research, unindexed-film discovery, " +
    "and 'what genealogically useful material exists?' questions.\n" +
    "\n" +
    "At least one of `placeId`, `keywords`, `surname`, or `imageGroupNumber` must be " +
    "provided. Multiple can be combined. `placeId` (from " +
    "place_search) is resolved internally to one or more catalog " +
    "rep IDs; results are unioned and deduped.\n" +
    "\n" +
    "Each returned hit carries three boolean flags — `record_searchable`, " +
    "`fulltext_searchable`, `image_searchable` — telling the LLM which " +
    "downstream tool (record_search, fulltext_search, image_read) " +
    "is available for that catalog item.",
  inputSchema: {
    type: "object" as const,
    properties: {
      placeId: {
        type: "string",
        description:
          "Numeric FamilySearch place ID (from place_search). " +
          "Resolved internally to one or more catalog rep IDs. " +
          "At least one of `placeId`, `keywords`, `surname`, or `imageGroupNumber` must be supplied.",
      },
      keywords: {
        type: "string",
        description:
          "Free-text keyword search across all indexed fields. " +
          "At least one of `placeId`, `keywords`, `surname`, or `imageGroupNumber` must be supplied.",
      },
      surname: {
        type: "string",
        description:
          "Surname mentioned in the title/content. Not the author's " +
          "surname (q.author_surname_text returns 0 hits upstream). " +
          "At least one of `placeId`, `keywords`, `surname`, or `imageGroupNumber` must be supplied.",
      },
      imageGroupNumber: {
        type: "string",
        description:
          "The FamilySearch image group number for a film/folder. " +
          "Maps to upstream q.film_number. (Older FS docs and APIs " +
          'use "DGS", "filmNumber", or "digitalFilmNumber" for the ' +
          "same value.) " +
          "At least one of `placeId`, `keywords`, `surname`, or `imageGroupNumber` must be supplied.",
      },
      count: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        description: "Page size per rep-ID query. Default 20.",
      },
      offset: {
        type: "integer",
        minimum: 0,
        description: "Pagination offset. Default 0.",
      },
    },
  },
};
