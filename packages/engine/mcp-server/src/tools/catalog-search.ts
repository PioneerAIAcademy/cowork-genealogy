/**
 * `catalog_search` — search the FamilySearch Catalog and hydrate its top hits.
 *
 * The Catalog indexes microfilm, books, manuscripts and finding aids. It is a
 * DIFFERENT index from `collections_search`, which covers indexed record
 * collections: a parish register filmed but never indexed is invisible there
 * and present here. Spec: docs/specs/catalog-search-tool-spec.md. Every
 * figure cited below is measured in dev/probe-catalog.ts.
 */
import type { Principal } from "../auth/principal.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { fsFetch } from "../utils/fs-fetch.js";
import {
  mapWithConcurrency,
  standardPlaceToRepId,
} from "../utils/place-resolver.js";
import type {
  CatalogFilmNote,
  CatalogHit,
  CatalogSearchInput,
  CatalogSearchResult,
} from "../types/catalog-search.js";

const SEARCH_URL =
  "https://www.familysearch.org/service/search/catalog/v3/search";

/** An item URL must start with this before a credential is attached to it. */
const ITEM_URL_PREFIX =
  "https://www.familysearch.org/service/search/catalog/item/";

const DEFAULT_COUNT = 25;
const MAX_COUNT = 200;
const DEFAULT_HYDRATE = 10;
const MAX_HYDRATE = 25;

/** Anchored at tool ENTRY, under Cowork's 60s MCP bridge abort. Bounds
 *  hydration; place resolution exposes no budget to bound. */
const TOTAL_BUDGET_MS = 50_000;

/** `Accept` is load-bearing: without it the service answers 200 with XML, so a
 *  JSON parse fails on a response that looked successful (probe H). */
const HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent": BROWSER_USER_AGENT,
};

const SEARCHABLE = [
  "standardPlace",
  "keywords",
  "surname",
  "title",
  "author",
  "subject",
  "filmNumber",
  "callNumber",
] as const;

/** XML-collapsed repeated fields arrive as an object for one value, an array
 *  for several, and absent for none. Normalize before reading anything. */
type Collapsed = Record<string, unknown>;

function asArray(value: unknown): Collapsed[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter(
    (v): v is Collapsed => typeof v === "object" && v !== null,
  );
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

interface SearchBody {
  totalHits?: number;
  searchHits?: {
    metadataHit?: {
      metadata?: {
        title?: { value?: string }[];
        creator?: { value?: string }[];
        identifier?: { value?: string };
        repositoryCalls?: { title?: string }[];
      };
    };
  }[];
}

function buildQuery(input: CatalogSearchInput, repId: string | null): string {
  const q = new URLSearchParams();
  // Not a tunable: without it `lutheran` is 2,046,826 hits instead of 12,344.
  q.set("m.queryRequireDefault", "on");

  if (repId) q.set("q.placeId", repId);
  else if (input.standardPlace) q.set("q.place", input.standardPlace);
  // `.exact` needs a place beside it; alone it 400s.
  if (input.exactPlace && (repId || input.standardPlace)) {
    q.set("q.place.exact", "on");
  }

  const simple: [keyof CatalogSearchInput, string][] = [
    ["keywords", "q.keywords"],
    ["surname", "q.surname"],
    ["title", "q.title"],
    ["author", "q.author"],
    ["subject", "q.subject"],
    ["filmNumber", "q.filmNumber"],
    ["callNumber", "q.callNumber"],
    ["availability", "q.availability"],
  ];
  for (const [field, param] of simple) {
    const v = input[field];
    if (typeof v === "string" && v.length > 0) q.set(param, v);
  }
  if (typeof input.year === "number") q.set("q.year", String(input.year));
  q.set("count", String(input.count ?? DEFAULT_COUNT));
  // `offset` is deliberately never sent: under load a deep offset stops
  // erroring and is silently ignored, so a pager loops over page one forever.
  return q.toString();
}

/** The item URL comes from a response body, and fsFetch attaches the user's
 *  bearer to whatever it is handed. Refuse anything we did not measure. */
function itemUrlOf(identifier: unknown): string | undefined {
  const v = typeof identifier === "string" ? identifier : undefined;
  return v && v.startsWith(ITEM_URL_PREFIX) ? v : undefined;
}

function hydrateFromSource(hit: CatalogHit, source: Record<string, unknown>): void {
  const notes = asArray(source.note);
  hit.notes = notes.map((n) => str(n?.text) ?? str(n?.value) ?? "").filter(Boolean);
  hit.authors = asArray(source.author)
    .map((a) => str(a?.value) ?? str(a?.text) ?? "")
    .filter(Boolean);
  hit.subjects = asArray(source.subject)
    .map((s) => str(s?.value) ?? str(s?.text) ?? "")
    .filter(Boolean);

  hit.filmNotes = asArray(source.film_note).map((f): CatalogFilmNote => ({
    ...(str(f?.filmno) ? { filmNumber: str(f.filmno) } : {}),
    // The DGS is image_search's and fulltext_search's `imageGroupNumber`.
    ...(str(f?.digital_film_no)
      ? { imageGroupNumber: str(f.digital_film_no) }
      : {}),
    ...(str(f?.fs_indexed) ? { indexed: str(f.fs_indexed) } : {}),
    ...(str(f?.shelf) ? { shelf: str(f.shelf) } : {}),
    ...(str(f?.copy_location) ? { copyLocation: str(f.copy_location) } : {}),
    ...(str(f?.text) ? { text: str(f.text) } : {}),
    ...(str(f?.item_image_start_no)
      ? { imageStartNumber: str(f.item_image_start_no) }
      : {}),
  }));

  if (str(source.available_online)) {
    hit.availableOnline = String(source.available_online).toUpperCase() === "Y";
  }
  // A digitized book has no film at all; its link is HTML inside an RSLINK note.
  for (const n of notes) {
    if (String(n?.type ?? "") !== "RSLINK") continue;
    const m = /https:\/\/www\.familysearch\.org\/library\/books\/idurl\/[^"'<\s]+/.exec(
      String(n?.text ?? n?.value ?? ""),
    );
    if (m) hit.digitalLibraryUrl = m[0];
  }
  hit.hydrated = true;
}

export async function catalogSearchTool(
  input: CatalogSearchInput,
  principal: Principal,
): Promise<CatalogSearchResult> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  if (!SEARCHABLE.some((f) => input[f] !== undefined && input[f] !== "")) {
    throw new Error(
      "catalog_search needs at least one of standardPlace, keywords, surname, " +
        "title, author, subject, filmNumber or callNumber — an empty query " +
        "returns millions of hits.",
    );
  }
  const count = input.count ?? DEFAULT_COUNT;
  if (count > MAX_COUNT) {
    throw new Error(`count is ${count}; the Catalog accepts at most ${MAX_COUNT}.`);
  }
  const hydrate = input.hydrate ?? DEFAULT_HYDRATE;
  if (hydrate > MAX_HYDRATE) {
    throw new Error(
      `hydrate is ${hydrate}; at most ${MAX_HYDRATE} item calls are made per ` +
        "search, to stay out of the service's degraded regime.",
    );
  }

  // The REP id, never the place id: standardPlaceToPlaceId("Maine, United
  // States") is 16, which the Catalog reads as Timor-Leste and answers.
  let repId: string | null = null;
  if (input.standardPlace) {
    repId = await standardPlaceToRepId(input.standardPlace, {
      contextName: "catalog_search",
    });
  }

  const res = await fsFetch(
    principal,
    `${SEARCH_URL}?${buildQuery(input, repId)}`,
    { headers: HEADERS },
    Math.max(0, deadline - Date.now()),
  );
  if (res.status === 403) {
    throw new Error(
      "FamilySearch Catalog search was refused (403). This is the edge " +
        "blocking the request, not a permissions problem — the call must send " +
        "a browser User-Agent.",
    );
  }
  if (!res.ok) {
    throw new Error(
      `FamilySearch Catalog search failed: ${res.status} ${res.statusText}`.trim(),
    );
  }

  const body = (await res.json()) as SearchBody;
  const hits: CatalogHit[] = (body.searchHits ?? []).map((h) => {
    const m = h.metadataHit?.metadata ?? {};
    const url = itemUrlOf(m.identifier?.value);
    return {
      ...(url ? { id: url.slice(ITEM_URL_PREFIX.length) } : {}),
      title: str(m.title?.[0]?.value) ?? "(untitled)",
      ...(str(m.creator?.[0]?.value) ? { creator: str(m.creator?.[0]?.value) } : {}),
      // Deduped: the service repeats an entry per copy, so an item on six
      // reels lists "Granite Mountain Record Vault, FamilySearch Library"
      // six times. The field is an access signal, not a holdings count.
      repositoryCalls: [
        ...new Set(
          (m.repositoryCalls ?? []).map((r) => str(r?.title) ?? "").filter(Boolean),
        ),
      ],
      ...(url ? { url } : {}),
      hydrated: false,
    };
  });

  // Hydration: mapWithConcurrency raced from outside, exactly as person-read
  // does it. Safe only because every task catches its own error (so the
  // Promise.all cannot be rejected by one bad item) and nothing reads the
  // return value (so losing the race loses nothing).
  const targets = hits.filter((h) => h.url).slice(0, hydrate);
  let hydrationTimedOut = false;
  if (targets.length > 0) {
    const work = mapWithConcurrency(targets, hydrate, async (hit) => {
      const remaining = deadline - Date.now();
      // Never start work the budget cannot pay for.
      if (remaining <= 0) return;
      try {
        const r = await fsFetch(principal, hit.url as string, { headers: HEADERS }, remaining);
        if (!r.ok) return;
        const item = (await r.json()) as { source?: Record<string, unknown> };
        // A task abandoned by the race keeps running. Without this check its
        // late result still lands on the hit AFTER the deadline, so the same
        // call returns different data depending on how the event loop was
        // scheduled. Discard anything that arrives past the budget.
        if (Date.now() > deadline) return;
        if (item.source) hydrateFromSource(hit, item.source);
      } catch {
        // One bad item must not fail the search.
      }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<"expired">((resolve) => {
      timer = setTimeout(() => resolve("expired"), Math.max(0, deadline - Date.now()));
    });
    try {
      // Which side won is the flag. `targets.some(h => !h.hydrated)` would
      // report a timeout for an item that merely 404'd, and the two want
      // different things from the caller: retry later vs. that item has no
      // detail.
      hydrationTimedOut =
        (await Promise.race([work.then(() => "done" as const), expiry])) === "expired";
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    totalHits: body.totalHits ?? 0,
    returned: hits.length,
    placeResolved: input.standardPlace ? repId !== null : true,
    hydrationTimedOut,
    hits,
  };
}

export const catalogSearchSchema = {
  name: "catalog_search",
  description:
    "Search the FamilySearch CATALOG — microfilm, books, manuscripts and " +
    "finding aids — and return its top hits with their holdings detail. This " +
    "is a DIFFERENT index from collections_search, which covers indexed " +
    "record collections: a parish register that was filmed but never indexed " +
    "is invisible there and present here. Use it to answer where the " +
    "original records are held and whether they can be seen, and to get an " +
    "imageGroupNumber for image_search or fulltext_search from a film note. " +
    "Give at least one of standardPlace, keywords, surname, title, author, " +
    "subject, filmNumber or callNumber. Requires FamilySearch auth (call " +
    "login).",
  inputSchema: {
    type: "object" as const,
    properties: {
      standardPlace: {
        type: "string",
        description:
          "Place name, e.g. 'Maine, United States'. Resolved to the " +
          "Catalog's place id internally.",
      },
      exactPlace: {
        type: "boolean",
        description:
          "Exclude subordinate jurisdictions — a state without its counties " +
          "and towns. Needs standardPlace beside it.",
      },
      keywords: {
        type: "string",
        description:
          "Free text. Quoting a phrase narrows it: '\"parish registers\"'.",
      },
      surname: { type: "string", description: "Surname." },
      title: { type: "string", description: "Title words." },
      author: { type: "string", description: "Author or creator." },
      subject: { type: "string", description: "Subject heading." },
      filmNumber: {
        type: "string",
        description:
          "Microfilm number or DGS — both match.",
      },
      callNumber: { type: "string", description: "Call number." },
      year: {
        type: "number",
        description: "An EXACT year, not a decade or a range.",
      },
      availability: {
        type: "string",
        description:
          "Case-sensitive, e.g. 'Online'. Lowercase returns nothing.",
      },
      count: {
        type: "number",
        description: "Hits to return. Default 25, max 200.",
      },
      hydrate: {
        type: "number",
        description:
          "How many of those hits to fetch holdings detail for. Default 10, " +
          "max 25 — each one is an extra request, and the service degrades " +
          "on volume.",
      },
    },
  },
};
