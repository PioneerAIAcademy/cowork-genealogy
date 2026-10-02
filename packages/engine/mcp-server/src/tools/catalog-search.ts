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
import { parseUpstreamErrorBody } from "../utils/search-helpers.js";
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

/** A catalogue holding is a record, not a prediction: nothing is filmed from
 *  before the first millennium and nothing is catalogued far ahead of now. */
const MIN_YEAR = 1000;
const MAX_YEAR = 2200;

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

/** Every field that becomes a `q.*` filter. A superset of SEARCHABLE:
 *  `availability` narrows but cannot make a query searchable on its own. */
const QUERY_FIELDS = [
  "standardPlace",
  "keywords",
  "surname",
  "title",
  "author",
  "subject",
  "filmNumber",
  "callNumber",
  "availability",
] as const;

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
  return list.flatMap((v): Collapsed[] => {
    // XML-to-JSON collapse yields a BARE STRING whenever an element has text
    // content and no attributes, which is the ordinary shape of a free-text
    // <note>. Dropping it returned `notes: []` for an item whose only
    // holdings note was text-only, which reads as "this item has no notes".
    // Through `str`, so a bare NUMBER collapses like a bare string. `str`
    // carries a number branch because film numbers arrive unquoted; an
    // element-level unquoted collapse was being dropped, reporting
    // `notes: []` with `hydrated: true` — "this item has no notes".
    if (typeof v !== "object" || v === null) {
      const text = str(v);
      return text === undefined ? [] : [{ text }];
    }
    return [v as Collapsed];
  });
}

/** The text of a collapsed element, whichever spelling it arrived under.
 *  `asArray` preserves a bare-string collapse as `{ text }`, so a reader that
 *  checks only `.value` loses exactly the shape asArray went to the trouble
 *  of keeping. */
/** The first real object in a collapsed container. `item.source` is the
 *  PARENT of note/author/subject/film_note — all four are defended against
 *  the object-for-one / array-for-several collapse and their container was
 *  not, so `source: [{...}]` reported `hydrated: true` with every field
 *  empty: "not filmed, not online, no notes", the opposite of the truth and
 *  indistinguishable from a genuinely detail-free item. */
function firstObject(v: unknown): Record<string, unknown> | undefined {
  const list = Array.isArray(v) ? v : [v];
  return list.find(
    (x): x is Record<string, unknown> => typeof x === "object" && x !== null,
  );
}

function textOf(v: Collapsed | undefined): string | undefined {
  return str(v?.value) ?? str(v?.text);
}

/** A searchable input the query can actually carry: a non-blank string, or a
 *  number (film and call numbers arrive unquoted). Returns the trimmed text.
 *  The emptiness guard and `buildQuery` MUST agree on this — the guard
 *  checking presence while buildQuery checked `typeof === "string"` let
 *  `filmNumber: 568142` through to a query with no `q.*` filter at all. */
function searchableValue(v: unknown): string | undefined {
  const text = str(v);
  return text === undefined ? undefined : text.trim() || undefined;
}

function str(value: unknown): string | undefined {
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  // filmno / digital_film_no arrive unquoted when they carry no leading zero.
  // Rejecting them produced a film note of `{}` with hydrated: true — the hit
  // claimed a film and named neither it nor the DGS image_search needs.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

interface SearchBody {
  totalHits?: number;
  // Every repeated field here is read through `asArray`, so these stay
  // `unknown`: the service collapses a one-value list to a bare object on
  // this response exactly as it does on the item response, and typing them
  // as arrays is what made `.map` throw the whole search away.
  searchHits?: unknown;
}

interface SearchHit {
  metadataHit?: {
    metadata?: {
      title?: unknown;
      creator?: unknown;
      identifier?: unknown;
      repositoryCalls?: unknown;
    };
  };
}

function buildQuery(
  input: CatalogSearchInput,
  repId: string | null,
  place: string | undefined,
): string {
  const q = new URLSearchParams();
  // Not a tunable: without it `lutheran` is 2,046,826 hits instead of 12,344.
  q.set("m.queryRequireDefault", "on");

  // `place` is the trimmed value, never `input.standardPlace`: a blank place
  // the emptiness guard treats as unsearchable was still reaching the wire as
  // `q.place=+++`, filtering the Catalog on nothing.
  if (repId) q.set("q.placeId", repId);
  else if (place) q.set("q.place", place);
  // `.exact` needs a place beside it; alone it 400s. Refused up front, so by
  // here one is always present.
  if (input.exactPlace) q.set("q.place.exact", "on");

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
    const v = searchableValue(input[field]);
    if (v) q.set(param, v);
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
  // Longer than the prefix, not merely starting with it: the bare prefix
  // passes a startsWith check, yields `id: ""` for the citation, and spends a
  // hydration slot on a request that can only 404.
  return v && v.length > ITEM_URL_PREFIX.length && v.startsWith(ITEM_URL_PREFIX)
    ? v
    : undefined;
}

function isRslink(n: Collapsed | undefined): boolean {
  return String(n?.type ?? "") === "RSLINK";
}

/** `http` or `https`, with or without `www.` — the hardcoded `https://www.`
 *  made either variant fall out of both `digitalLibraryUrl` and `notes`. */
const DIGITAL_LIBRARY_RE =
  /https?:\/\/(?:www\.)?familysearch\.org\/library\/books\/idurl\/[^"'<\s]+/;

/** Anchor markup is not prose. Kept deliberately crude: this runs on a
 *  catalogue note, never on anything executed or re-rendered. */
function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** A note as readable text. An unconsumed RSLINK keeps its href alongside its
 *  link text — stripping the markup alone would drop the URL, which for an
 *  Archive.org or non-library FamilySearch link is the whole content of the
 *  note and the item's only online-access information. */
function renderNote(n: Collapsed | undefined): string {
  const raw = textOf(n) ?? "";
  const text = stripTags(raw);
  if (!isRslink(n)) return text;
  const href = /href\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1];
  if (!href) return text;
  return text && text !== href ? `${text} (${href})` : href;
}

function hydrateFromSource(hit: CatalogHit, source: Record<string, unknown>): void {
  const notes = asArray(source.note);

  // A digitized book has no film at all; its link is HTML inside an RSLINK
  // note. Extracted BEFORE `notes` is built, because which RSLINK notes were
  // consumed decides which stay. FIRST match wins: the field holds one URL.
  for (const n of notes) {
    if (!isRslink(n)) continue;
    const m = DIGITAL_LIBRARY_RE.exec(textOf(n) ?? "");
    if (m) {
      hit.digitalLibraryUrl = m[0];
      break;
    }
  }

  // Only the RSLINK note that BECAME digitalLibraryUrl is dropped. Filtering
  // every RSLINK assumed the regex below caught them all, and the two are not
  // the same set: an Archive.org link, or an `http://`/www-less FamilySearch
  // one, vanished from `notes` AND produced no url — the item's only
  // online-access information gone while the hit read `hydrated: true`.
  // Markup is stripped rather than passed through: raw `<a href>` handed to
  // the LLM reads as prose.
  // `textOf` everywhere below: written out by hand, `notes` read `.text`
  // before `.value` while authors/subjects/title read `.value` first, so one
  // element carrying both spellings was read two different ways.
  hit.notes = notes
    .filter((n) => !(isRslink(n) && textOf(n)?.includes(hit.digitalLibraryUrl ?? "\u0000")))
    .map(renderNote)
    .filter(Boolean);
  hit.authors = asArray(source.author).map((a) => textOf(a) ?? "").filter(Boolean);
  hit.subjects = asArray(source.subject).map((x) => textOf(x) ?? "").filter(Boolean);

  // One table, read once per field. Written as seven `str(x) ? {k: str(x)}`
  // spreads it named each source key twice, so a single mistyped repeat
  // would be invisible to both review and these tests.
  // The DGS is image_search's and fulltext_search's `imageGroupNumber`.
  const FILM_FIELDS: [keyof CatalogFilmNote, string][] = [
    ["filmNumber", "filmno"],
    ["imageGroupNumber", "digital_film_no"],
    ["indexed", "fs_indexed"],
    ["shelf", "shelf"],
    ["copyLocation", "copy_location"],
    ["text", "text"],
    ["imageStartNumber", "item_image_start_no"],
  ];
  hit.filmNotes = asArray(source.film_note).map((f) => {
    const note: CatalogFilmNote = {};
    for (const [key, from] of FILM_FIELDS) {
      const v = str(f?.[from]);
      if (v) note[key] = v;
    }
    return note;
  })
    // A note carrying only blank or unmapped keys becomes `{}`, which claims
    // the item was filmed while naming neither the film nor the DGS — the
    // same shape the unquoted-number fix closed, by a different route.
    .filter((n) => Object.keys(n).length > 0);

  const online = source.available_online;
  if (typeof online === "boolean") hit.availableOnline = online;
  else if (str(online)) hit.availableOnline = String(online).toUpperCase() === "Y";
  hit.hydrated = true;
}

export async function catalogSearchTool(
  input: CatalogSearchInput,
  principal: Principal,
): Promise<CatalogSearchResult> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  if (!SEARCHABLE.some((f) => searchableValue(input[f]) !== undefined)) {
    throw new Error(
      "catalog_search needs at least one of standardPlace, keywords, surname, " +
        "title, author, subject, filmNumber or callNumber — an empty query " +
        "returns millions of hits.",
    );
  }
  // Both bounds, and whole numbers. A one-sided `> MAX` check let `hydrate:
  // -1` through, where `slice(0, -1)` keeps all-but-one hit as targets and
  // mapWithConcurrency clamps -1 to ONE worker: 59 serial item calls against
  // a cap of 25, which is the degraded regime the cap exists to avoid.
  const count = input.count ?? DEFAULT_COUNT;
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    // JSON.stringify, not interpolation: the MCP boundary does not validate
    // against inputSchema, so `count: "10"` arrives as a string and
    // `count is 10` reads as a value that already satisfies the rule.
    throw new Error(
      `count is ${JSON.stringify(count)}; it must be a whole number from 1 ` +
        `to ${MAX_COUNT}.`,
    );
  }
  // EVERY query-carrying field, not just the ones that make a query
  // searchable. Dropping an unusable field silently widens the answer: with
  // `{ standardPlace: "Maine, United States", keywords: {} }` the keywords
  // vanished and the agent got the top 25 of all 3,902 Maine items back as
  // the answer to "Maine + parish registers", with placeResolved: true and
  // nothing saying a filter had been dropped. An earlier fix closed only the
  // case where EVERY field was unusable.
  for (const field of QUERY_FIELDS) {
    if (input[field] !== undefined && searchableValue(input[field]) === undefined) {
      throw new Error(
        `${field} is ${JSON.stringify(input[field])}; it must be a non-blank ` +
          "string. The Catalog cannot carry that value, and dropping it " +
          "would silently widen the answer.",
      );
    }
  }
  const place = searchableValue(input.standardPlace);
  if (input.exactPlace && place === undefined) {
    // Silently dropping it returned the wider set with nothing saying so, and
    // the agent read the hit count as an answer to a narrower question.
    throw new Error(
      "exactPlace excludes subordinate jurisdictions and needs a " +
        "standardPlace beside it; given alone the Catalog refuses the query.",
    );
  }
  // Integrality is not enough: `1e21` IS an integer and reaches the wire as
  // `q.year=1e%2B21`, which costs the same 400 and the same agent turn the
  // NaN case was guarded against. `0` and `-1850` likewise.
  if (
    input.year !== undefined &&
    (!Number.isInteger(input.year) ||
      input.year < MIN_YEAR ||
      input.year > MAX_YEAR)
  ) {
    throw new Error(
      `year is ${JSON.stringify(input.year)}; it must be a whole year ` +
        `between ${MIN_YEAR} and ${MAX_YEAR}, not a decade, a range or a ` +
        "fraction.",
    );
  }
  const hydrate = input.hydrate ?? DEFAULT_HYDRATE;
  if (!Number.isInteger(hydrate) || hydrate < 0 || hydrate > MAX_HYDRATE) {
    throw new Error(
      `hydrate is ${JSON.stringify(hydrate)}; it must be a whole number from 0 to ` +
        `${MAX_HYDRATE} — each hit hydrated is an extra request, and the ` +
        "service degrades on volume.",
    );
  }

  // The REP id, never the place id: standardPlaceToPlaceId("Maine, United
  // States") is 16, which the Catalog reads as Timor-Leste and answers.
  let repId: string | null = null;
  if (place) {
    // No `contextName`: that option is a PARENT PLACE used to disambiguate
    // same-name places, and passing anything else SUPPRESSES the context the
    // resolver derives from the input itself (`contextName ?? deriveContextName`).
    // A tool name there matches no candidate, so "Paris, Idaho, United States"
    // loses its "Idaho" filter and resolves to Paris, France — the same
    // wrong-answer-not-an-error class as Maine -> Timor-Leste, one layer up.
    repId = await standardPlaceToRepId(place);

    // Resolution is unbudgeted (withRetry x3 over a 30s fetch). Overrunning
    // leaves the search a timeoutMs of 0, whose abort reads "timed out after
    // 0ms" and names the query URL but neither the Catalog nor a way out.
    if (Date.now() >= deadline) {
      throw new Error(
        `catalog_search spent its ${TOTAL_BUDGET_MS / 1000}s budget resolving ` +
          `the place '${place}' and never reached the Catalog. ` +
          "Retry without standardPlace, narrowing with keywords or title " +
          "instead, or retry later.",
      );
    }
  }

  const res = await fsFetch(
    principal,
    `${SEARCH_URL}?${buildQuery(input, repId, place)}`,
    { headers: HEADERS },
    Math.max(0, deadline - Date.now()),
  );
  if (!res.ok) {
    // Drained before every throw below: an unconsumed undici body holds its
    // socket until GC. Parsed too, because the Catalog says WHICH parameter
    // it rejected ({"detail":"Validation failure",...}) and discarding that
    // left the agent retrying the same query against nine candidates.
    const raw = await res.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const detail = parseUpstreamErrorBody(parsed);

    if (res.status === 401) {
      // fsFetch has already re-read tokens.json once; a 401 still here means
      // the session is genuinely not accepted, which is the user's to fix.
      throw new Error(
        "FamilySearch session not accepted; call the login tool to " +
          "re-authenticate." + (detail ? ` Upstream said: ${detail}` : ""),
      );
    }
    if (res.status === 403) {
      throw new Error(
        "FamilySearch Catalog search was refused (403) by the edge, not by " +
          "permissions as far as this tool can tell. The browser User-Agent " +
          "it requires is already sent, so this is USUALLY rate limiting or " +
          "IP reputation, where waiting and retrying is the fix — but a 403 " +
          "alone cannot be told from a missing Catalog entitlement, which " +
          "waiting will never clear. Check any upstream detail below before " +
          "retrying." +
          (detail ? ` Upstream said: ${detail}` : ""),
      );
    }
    throw new Error(
      `FamilySearch Catalog search failed: ${res.status} ${res.statusText}`.trim() +
        (detail ? ` — ${detail}` : ""),
    );
  }

  // Guarded: every non-2xx path in this file is framed for the LLM and the
  // 2xx-but-unparseable one was not. Imperva fronts this host, and answering
  // 200 with a challenge page is its ordinary behaviour — the exact thing the
  // `Accept` header exists to prevent, with no fallback if it is ignored. A
  // raw `SyntaxError: Unexpected token '<'` names neither the Catalog nor an
  // action. A body of literal `null` parses fine and then fails on property
  // access, so the shape is checked too.
  let body: SearchBody;
  try {
    const parsed: unknown = await res.json();
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    body = parsed as SearchBody;
  } catch {
    throw new Error(
      "FamilySearch Catalog answered 200 with a body that is not JSON. This " +
        "is usually an edge challenge or interstitial page rather than the " +
        "Catalog itself, so retrying shortly is the fix; the query was not " +
        "refused and does not need changing.",
    );
  }
  // `searchHits` collapses to a bare object for a one-hit answer exactly as
  // its children do — a precise query (a film number) is the common way to
  // get one — and `.map` on it threw the whole search away.
  const hits: CatalogHit[] = asArray(body.searchHits).map((raw) => {
    const h = raw as SearchHit;
    const m = h.metadataHit?.metadata ?? {};
    // EVERY identifier is searched, not just the first: a catalogue entry
    // routinely carries external ids (an ISBN) beside its item URL, and
    // reading only [0] cost the hit its url, its id and its hydration.
    const url = asArray(m.identifier)
      .map((i) => itemUrlOf(textOf(i)))
      .find((u): u is string => u !== undefined);
    const title = textOf(asArray(m.title)[0]);
    const creator = textOf(asArray(m.creator)[0]);
    return {
      // The item segment only: everything after the prefix would carry a
      // query string or a trailing path into a citation.
      ...(url
        ? { id: url.slice(ITEM_URL_PREFIX.length).split(/[/?#]/)[0] }
        : {}),
      title: title ?? "(untitled)",
      ...(creator ? { creator } : {}),
      // Deduped: the service repeats an entry per copy, so an item on six
      // reels lists "Granite Mountain Record Vault, FamilySearch Library"
      // six times. The field is an access signal, not a holdings count.
      repositoryCalls: [
        ...new Set(
          asArray(m.repositoryCalls)
            // `title` can itself be a collapsed element ({ value: "Online" }),
            // and dropping it loses the access signal the spec calls the one
            // useful field a search hit carries.
            .map(
              (r) =>
                str(r?.title) ?? textOf(asArray(r?.title)[0]) ?? textOf(r) ?? "",
            )
            .filter(Boolean),
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
  if (targets.length > 0 && Date.now() >= deadline) {
    // The search leg spent the budget. Every task would short-circuit on its
    // own `remaining <= 0` guard and `work` would win the race in microtasks,
    // reporting false — telling the caller "these items have no detail" when
    // the truth is "retry later", which is the one distinction this flag
    // exists to carry.
    hydrationTimedOut = true;
  } else if (targets.length > 0) {
    // `hydrate` as the limit is a BACKSTOP, not a lever: `targets` is already
    // sliced to `hydrate`, so mapWithConcurrency's
    // `Math.max(1, Math.min(limit, items.length))` always equals
    // `targets.length` and every call is in flight at once — which is what
    // the budget arithmetic assumes. It is kept so that removing the slice
    // cannot silently turn one tool call into 200 parallel requests.
    const work = mapWithConcurrency(targets, hydrate, async (hit) => {
      const remaining = deadline - Date.now();
      // A BACKSTOP, not a reachable branch, and so asserted by no test:
      // every task starts in the same tick as the pre-check above, which
      // already returns when the budget is gone. It covers only the window
      // where the clock crosses the deadline between the two. Kept because
      // the alternative is issuing a request with a timeout of 0, whose
      // abort reads "timed out after 0ms". Deleting it reds nothing — said
      // here so that is a known property rather than a later discovery.
      if (remaining <= 0) return;
      try {
        // attempts: 1. fetchWithRetry defaults to 3 and retries every
        // 429/5xx — which is precisely what the service answers once volume
        // pushes it into the degraded regime. At the cap that turns 25 item
        // calls into as many as 75, multiplying the load the cap exists to
        // bound. The search leg keeps its retries; it is one request.
        const r = await fsFetch(
          principal,
          hit.url as string,
          { headers: HEADERS },
          remaining,
          { attempts: 1 },
        );
        if (!r.ok) {
          // Drained for the same reason the search leg drains: an unconsumed
          // undici body holds its socket until GC, and under the degraded
          // regime a hydrate of 25 produces 25 of them per call.
          await r.text().catch(() => "");
          return;
        }
        const item = (await r.json()) as { source?: Record<string, unknown> };
        // A task abandoned by the race keeps running. Without this check its
        // late result still lands on the hit AFTER the deadline, so the same
        // call returns different data depending on how the event loop was
        // scheduled. Discard anything that arrives past the budget.
        if (Date.now() >= deadline) return;
        const src = firstObject(item.source);
        if (src) hydrateFromSource(hit, src);
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

  // Coerced and floored at `returned`: an absent field defaulted to 0, so a
  // body of `{ searchHits: [oneHit] }` answered "0 hits exist" alongside a
  // non-empty array, and a quoted "803" passed straight through a field its
  // own contract types as a number. totalHits is what tells the agent its
  // query was too broad or too narrow — the number the whole spec is argued
  // in — so a contradictory one is worse than a conservative one.
  const upstreamTotal = Number(body.totalHits);
  const totalHits =
    Number.isFinite(upstreamTotal) && upstreamTotal >= hits.length
      ? upstreamTotal
      : hits.length;

  return {
    totalHits,
    returned: hits.length,
    // Boolean(repId), matching buildQuery's own `if (repId)`: `"" !== null`
    // reported the place as resolved while the query used the name fallback.
    placeResolved: place ? Boolean(repId) : true,
    hydrationTimedOut,
    hydrateRequested: hydrate,
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
        type: "integer",
        description: "An EXACT year, not a decade or a range.",
      },
      availability: {
        type: "string",
        description:
          "Case-sensitive, e.g. 'Online'. Lowercase returns nothing.",
      },
      count: {
        type: "integer",
        minimum: 1,
        maximum: 200,
        description: "Hits to return. Default 25, max 200.",
      },
      hydrate: {
        type: "integer",
        minimum: 0,
        maximum: 25,
        description:
          "How many of those hits to fetch holdings detail for. Default 10, " +
          "max 25 — each one is an extra request, and the service degrades " +
          "on volume. 0 skips hydration.",
      },
    },
  },
};
