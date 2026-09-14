/**
 * Probe — evidence trail behind the FamilySearch Catalog service (issue #2547).
 *
 * No tool in this repo searches the Catalog. This script establishes the live
 * query shape and response contract that a `catalog_search` spec is written
 * from. It answers only what can be measured; it proposes no tool surface.
 *
 *   SECTION A — Auth and transport. Does the service need a bearer? Does it
 *     need a browser UA?
 *   SECTION B — The `m.*` flags. What each one actually changes.
 *   SECTION C — Place parameters. q.place vs q.placeId vs q.place.exact.
 *   SECTION D — Parameter enumeration. Unknown params hard-400, so a 200/400
 *     sweep is a reliable way to enumerate the accepted set.
 *   SECTION E — Paging limits. Where count and offset stop being accepted.
 *   SECTION F — The item endpoint. Field-shape variance across four items.
 *   SECTION G — film_note.digital_film_no is an image group number. Resolves
 *     against the same group service `image_search` uses.
 *
 * RESULTS (recorded here so a future reader doesn't need to re-run; measured
 * 2026-09-14 against the live service).
 *
 * SEARCH  GET /service/search/catalog/v3/search
 *
 *   A. Bearer required — without an Authorization header the service returns
 *      401 with an empty body (no JSON error). A browser User-Agent is NOT
 *      required today (the same query answers 200 without one), but Imperva
 *      fronts the host (`X-CDN: Imperva` on the 401), so send
 *      BROWSER_USER_AGENT as every other FamilySearch call site here does.
 *      Searches measured 0.20-0.44s, items 0.18-0.25s; the 30s default
 *      timeout is not close to binding.
 *
 *   B. `m.queryRequireDefault=on` is load-bearing, not cosmetic:
 *        q.keywords=lutheran            -> 2,046,826 totalHits
 *        q.keywords=lutheran + the flag ->        12,344 totalHits
 *      `m.defaultFacets=on` changes no count; it only decides whether the
 *      `facets` block is returned.
 *
 *   C. `q.placeId` is this repo's **placeRepId**, not its `placeId`:
 *      /platform/places/search?q=name:"Maine" returns entry id 333 whose
 *      Primary is .../places/16. The Catalog wants 333. `standardPlaceToRepId`
 *      in utils/place-resolver.ts produces exactly this. The trap is that
 *      `standardPlaceToPlaceId("Maine, United States")` produces 16, and the
 *      Catalog reads 16 as a valid rep — Timor-Leste — answering with 8
 *      Timor items. The wrong helper returns a wrong ANSWER, not an error.
 *      When q.placeId is present the q.place text is ignored —
 *      `q.place=Zanzibar&q.placeId=333` returns the Maine set. q.place alone
 *      does match by name. A non-numeric placeId 400s; an unknown numeric one
 *      returns 0 hits.
 *
 *      `q.place.exact=on` excludes subordinate jurisdictions:
 *        Maine (333)                 -> 3,902 hits (state + counties + towns)
 *        Maine (333) + place.exact   ->   803 hits (catalogued at Maine level)
 *      e.g. the town item "175th anniversary Sangerville" is in the first set
 *      and not the second. `.exact` is accepted but inert on every other
 *      parameter (q.surname=Martin and q.surname=Martin&q.surname.exact=on
 *      both return 2,254).
 *
 *   D. Accepted parameters (everything else 400s with
 *      {"detail":"Validation failure","instance":"/v3/search","status":400,
 *       "title":"Bad Request"}):
 *        q.place, q.place.exact, q.placeId, q.keywords, q.surname, q.title,
 *        q.author, q.subject, q.subjectId, q.filmNumber, q.callNumber,
 *        q.year, q.availability, count, offset, m.defaultFacets,
 *        m.queryRequireDefault, and facet filters of the form
 *        `c.<facet>1=on&f.<facet>0=<value>` taken verbatim from a facet's
 *        own `params` string.
 *      `q.place.exact` is a modifier, not a parameter: on its own, with no
 *      q.place or q.placeId beside it, it 400s.
 *      Rejected (so they do not exist): q.dateFrom, q.text, q.anyText,
 *        q.topic, q.format, q.language, q.givenname, q.publisher, q.notes,
 *        q.isbn, q.recordType, q.fulltext, q.digitalFilmNumber, m.sort, sort.
 *      All parameters AND together (placeId 333 + place.exact -> 803;
 *      + q.keywords=census -> 54). q.year is an exact year, not a decade
 *      (1850 -> 29, 1800 -> 22, against the year facet's 1800 bucket of 185).
 *      q.availability is case-sensitive: "Online" -> 472, "online" -> 0.
 *      q.keywords honours phrase quoting ("parish registers" 136,842 vs
 *      bare parish registers 153,738).
 *      q.filmNumber matches BOTH the legacy microfilm number and the DGS:
 *      568142 and 5157135 each return the same 2 items.
 *
 *   E. count max is 200 (201 -> 400). offset max is 9,990 (10,000 -> 400),
 *      so a result set is walkable only to 10,000 items.
 *
 *      THE PAGING CEILING IS NOT THE WHOLE STORY. Sustained querying (this
 *      script's own ~150 requests inside a few minutes did it) pushes the
 *      service into a degraded regime where two things change at once:
 *      latency goes from 0.2s to 4-11s, and a deep offset stops erroring and
 *      starts being SILENTLY IGNORED — offset=5000 answers 200 with
 *      `"offset": 0` and page 1's hits. Five minutes idle restored the clean
 *      behaviour (offset 9,990 honoured, 10,000 -> 400, 0.2s).
 *
 *      A pager that trusts the status code therefore loops forever over page
 *      one, under exactly the load a paging loop generates. Check the ECHOED
 *      `offset` in the body against the one you asked for; this section
 *      prints both so a re-run shows which regime the service is in.
 *
 *   F. Hits are thin. Per hit the metadata carries only `title`, `creator`,
 *      `repositoryCalls`, `identifier` and a `coverage.temporal` that was
 *      empty on all 1,697 hits sampled — no dates, no format, no film, no
 *      online status. Everything the six shipped reference docs ask for
 *      ("where are the originals held") comes from the item call.
 *      `repositoryCalls` is the access signal, observed values: Online,
 *      Online at FamilySearch Center, Online at Affiliate Library,
 *      FamilySearch Library, Granite Mountain Record Vault,
 *      HSB (Headquarters Storage Building).
 *      `identifier.value` is the item URL; the id has two namespaces,
 *      koha: (2,987 of 2,991 hits sampled) and olib: (4).
 *
 * ITEM  GET /service/search/catalog/item/{koha|olib}:{n}
 *
 *      Unknown or malformed id -> 404 with an empty body.
 *      Everything sits under a single `source` object. Its repeated fields
 *      are XML-collapsed: `note`, `author`, `subject` and `film_note` are a
 *      **dict when there is one and a list when there are several**, and
 *      `film_note` is **absent** when the item was never filmed (12 of 18
 *      sampled items had none, 6 had a dict, others a list of up to 29).
 *      Any parser must normalize to an array before reading.
 *
 *   G. `film_note[].digital_film_no` is an image group number (DGS). DGS
 *      5157135 resolves against the group service image_search already uses
 *      (sg30p0.../rms/group-service/group/{dgs}/apid) to apid
 *      TH-1942-25137-31341-10 — so a Catalog item hands `image_search` and
 *      `fulltext_search` their `imageGroupNumber` directly. An empty
 *      `digital_film_no` with a `filmno` present means filmed but not
 *      digitized.
 *
 *      Digitized BOOKS take a different path with no film at all:
 *      `available_online: "Y"`, no `film_note`, and the link buried as HTML
 *      inside a `note` of `type: "RSLINK"` pointing at
 *      familysearch.org/library/books/idurl/1/{id} — the FamilySearch Digital
 *      Library, which no tool in this repo reaches.
 *
 * Usage:
 *   cd packages/engine/mcp-server && npx tsx dev/probe-catalog.ts
 *   cd packages/engine/mcp-server && npx tsx dev/probe-catalog.ts --section C
 */
import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchWithRetry } from "../src/utils/http.js";

const SEARCH_URL =
  "https://www.familysearch.org/service/search/catalog/v3/search";
const ITEM_URL = "https://www.familysearch.org/service/search/catalog/item";
const GROUP_SERVICE_BASE =
  "https://sg30p0.familysearch.org/service/records/rms/group-service";

// "Maine, United States" — the rep id, which is what q.placeId wants.
const MAINE_REP_ID = "333";

interface SearchResponse {
  searchHits?: {
    metadataHit: {
      metadata: {
        title?: { value: string }[];
        identifier?: { value: string };
        repositoryCalls?: { title: string }[];
      };
    };
  }[];
  facets?: { displayName: string; count: number; params: string }[];
  totalHits?: number;
  offset?: number;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": BROWSER_USER_AGENT,
  };
}

async function search(
  token: string,
  query: string,
): Promise<{ status: number; body: SearchResponse | null; ms: number }> {
  const started = Date.now();
  const res = await fetchWithRetry(`${SEARCH_URL}?${query}`, {
    headers: headers(token),
  });
  const ms = Date.now() - started;
  if (!res.ok) {
    await res.text();
    return { status: res.status, body: null, ms };
  }
  return { status: res.status, body: (await res.json()) as SearchResponse, ms };
}

async function total(token: string, query: string): Promise<string> {
  const { status, body, ms } = await search(token, query);
  if (status !== 200) return `${status}`;
  return `${body?.totalHits ?? "?"} (${ms}ms)`;
}

async function sectionA(token: string): Promise<void> {
  console.log("\n==== SECTION A — auth and transport ====\n");

  const q = "count=5&offset=0&m.queryRequireDefault=on&q.keywords=lutheran";

  const noAuth = await fetchWithRetry(`${SEARCH_URL}?${q}`, {
    headers: { Accept: "application/json", "User-Agent": BROWSER_USER_AGENT },
  });
  const noAuthBody = await noAuth.text();
  console.log(
    `no Authorization header -> ${noAuth.status}, body ${noAuthBody.length} bytes, X-CDN: ${noAuth.headers.get("x-cdn") ?? "(none)"}`,
  );

  const noUa = await fetchWithRetry(`${SEARCH_URL}?${q}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  console.log(`no User-Agent           -> ${noUa.status}`);
  await noUa.text();

  console.log(`bearer + browser UA     -> ${await total(token, q)}`);
}

async function sectionB(token: string): Promise<void> {
  console.log("\n==== SECTION B — the m.* flags ====\n");
  const base = "count=5&offset=0&q.keywords=lutheran";
  for (const [label, q] of [
    ["neither flag", base],
    ["m.defaultFacets only", `${base}&m.defaultFacets=on`],
    ["m.queryRequireDefault only", `${base}&m.queryRequireDefault=on`],
    ["both", `${base}&m.defaultFacets=on&m.queryRequireDefault=on`],
  ]) {
    console.log(`${label.padEnd(28)} totalHits=${await total(token, q)}`);
  }

  const withFacets = await search(
    token,
    `${base}&m.defaultFacets=on&m.queryRequireDefault=on`,
  );
  const without = await search(token, `${base}&m.queryRequireDefault=on`);
  console.log(
    `\nfacets returned: with m.defaultFacets=${withFacets.body?.facets?.length ?? 0}, without=${without.body?.facets?.length ?? 0}`,
  );
  for (const f of withFacets.body?.facets ?? []) {
    console.log(`  ${f.displayName.padEnd(14)} ${f.params}`);
  }
}

async function sectionC(token: string): Promise<void> {
  console.log("\n==== SECTION C — place parameters ====\n");
  const base = "count=5&offset=0&m.defaultFacets=on&m.queryRequireDefault=on";
  const maine = encodeURIComponent("Maine, United States");
  for (const [label, q] of [
    ["place name only", `${base}&q.place=${maine}`],
    ["place name + exact", `${base}&q.place=${maine}&q.place.exact=on`],
    ["placeId only", `${base}&q.placeId=${MAINE_REP_ID}`],
    ["placeId + exact", `${base}&q.placeId=${MAINE_REP_ID}&q.place.exact=on`],
    [
      "placeId + wrong name",
      `${base}&q.place=Zanzibar&q.place.exact=on&q.placeId=${MAINE_REP_ID}`,
    ],
    ["Zanzibar by name", `${base}&q.place=Zanzibar&q.place.exact=on`],
    ["primary id (16), not rep", `${base}&q.placeId=16&q.place.exact=on`],
    ["unknown numeric placeId", `${base}&q.placeId=99999999`],
    ["non-numeric placeId", `${base}&q.placeId=abc`],
  ]) {
    console.log(`${label.padEnd(26)} totalHits=${await total(token, q)}`);
  }

  // Which items q.place.exact=on drops: subordinate jurisdictions.
  const all = await search(
    token,
    `count=200&offset=0&m.queryRequireDefault=on&q.placeId=${MAINE_REP_ID}`,
  );
  const exact = await search(
    token,
    `count=200&offset=0&m.queryRequireDefault=on&q.placeId=${MAINE_REP_ID}&q.place.exact=on`,
  );
  const exactTitles = new Set(
    (exact.body?.searchHits ?? []).map(
      (h) => h.metadataHit.metadata.title?.[0]?.value,
    ),
  );
  const dropped = (all.body?.searchHits ?? [])
    .map((h) => h.metadataHit.metadata.title?.[0]?.value)
    .filter((t) => t && !exactTitles.has(t))
    .slice(0, 5);
  console.log("\nIn the unfiltered set, absent under q.place.exact=on:");
  for (const t of dropped) console.log(`  ${t}`);
}

async function sectionD(token: string): Promise<void> {
  console.log("\n==== SECTION D — parameter enumeration ====\n");
  console.log("An unknown parameter 400s, so 200 means the service knows it.\n");
  const base = "count=5&offset=0&m.queryRequireDefault=on";
  const candidates = [
    "q.place=Maine",
    "q.place=Maine&q.place.exact=on", // .exact alone, with no place, 400s
    `q.placeId=${MAINE_REP_ID}`,
    "q.keywords=census",
    "q.surname=Martin",
    "q.title=census",
    "q.author=Smith",
    "q.subject=census",
    "q.subjectId=618584092",
    "q.filmNumber=4057677",
    "q.callNumber=929",
    "q.year=1850",
    "q.availability=Online",
    "q.dateFrom=1800",
    "q.text=census",
    "q.anyText=census",
    "q.topic=Census",
    "q.format=Book",
    "q.language=English",
    "q.givenname=John",
    "q.publisher=x",
    "q.notes=x",
    "q.isbn=1",
    "q.recordType=Census",
    "q.fulltext=census",
    "q.digitalFilmNumber=4057677",
    "m.sort=title",
    "sort=title",
  ];
  for (const c of candidates) {
    const { status } = await search(token, `${base}&${c}`);
    console.log(`  ${status}  ${c}`);
  }

  console.log("\nParameters AND together:");
  const place = `${base}&q.placeId=${MAINE_REP_ID}&q.place.exact=on`;
  console.log(`  place only              ${await total(token, place)}`);
  console.log(
    `  place + keywords=census ${await total(token, `${place}&q.keywords=census`)}`,
  );
  console.log(
    `  place + keywords=zzzqqq ${await total(token, `${place}&q.keywords=zzzqqq`)}`,
  );
  console.log(
    `  place + availability=Online ${await total(token, `${place}&q.availability=Online`)}`,
  );
  console.log(
    `  place + availability=online ${await total(token, `${place}&q.availability=online`)}`,
  );
  console.log(
    `  place + year=1850       ${await total(token, `${place}&q.year=1850`)}`,
  );

  console.log("\n.exact is inert outside q.place:");
  console.log(
    `  q.surname=Martin              ${await total(token, `${base}&q.surname=Martin`)}`,
  );
  console.log(
    `  q.surname=Martin + .exact=on  ${await total(token, `${base}&q.surname=Martin&q.surname.exact=on`)}`,
  );

  console.log("\nq.filmNumber takes the legacy film number and the DGS:");
  console.log(
    `  legacy filmno 568142   ${await total(token, `${base}&q.filmNumber=568142`)}`,
  );
  console.log(
    `  DGS 5157135            ${await total(token, `${base}&q.filmNumber=5157135`)}`,
  );
}

async function sectionE(token: string): Promise<void> {
  console.log("\n==== SECTION E — paging limits ====\n");
  const q = "m.queryRequireDefault=on&q.keywords=lutheran";
  for (const count of [100, 200, 201, 250, 500]) {
    const { status } = await search(token, `count=${count}&offset=0&${q}`);
    console.log(`  count=${String(count).padEnd(5)} -> ${status}`);
  }

  console.log(
    "\n  A requested offset the service ignores comes back as 200 with the",
  );
  console.log(
    "  echoed offset reset to 0 — the degraded regime, not the ceiling.\n",
  );
  for (const offset of [0, 100, 5000, 9900, 9990, 10000, 20000]) {
    const { status, body, ms } = await search(
      token,
      `count=3&offset=${offset}&${q}`,
    );
    const echoed = body?.offset;
    const ignored =
      status === 200 && offset !== 0 && echoed === 0 ? "  <-- IGNORED" : "";
    const first = body?.searchHits?.[0]?.metadataHit.metadata.title?.[0]?.value;
    console.log(
      `  offset=${String(offset).padEnd(5)} -> ${status} echoed=${echoed ?? "-"} ${String(ms).padStart(5)}ms  ${first?.slice(0, 40) ?? ""}${ignored}`,
    );
  }
}

async function sectionF(token: string): Promise<void> {
  console.log("\n==== SECTION F — the item endpoint ====\n");

  const { body } = await search(
    token,
    `count=5&offset=0&m.queryRequireDefault=on&q.placeId=${MAINE_REP_ID}&q.place.exact=on`,
  );
  console.log("What a search hit carries (the whole of it):");
  const first = body?.searchHits?.[0];
  console.log(JSON.stringify(first?.metadataHit.metadata, null, 2));

  console.log("\nItem field shapes — dict when one, list when several:");
  const ids = [
    "koha:745492", // 29 film notes
    "koha:428938", // 11 film notes
    "koha:3308785", // a book, no film
    "olib:2333650", // the other id namespace
    "koha:99999999999", // unknown
  ];
  for (const id of ids) {
    const res = await fetchWithRetry(`${ITEM_URL}/${id}`, {
      headers: headers(token),
    });
    if (!res.ok) {
      const body = await res.text();
      console.log(`  ${id.padEnd(20)} ${res.status}, body ${body.length} bytes`);
      continue;
    }
    const data = (await res.json()) as { source?: Record<string, unknown> };
    const shapes = Object.entries(data.source ?? {})
      .map(([k, v]) => `${k}:${Array.isArray(v) ? `list[${v.length}]` : typeof v}`)
      .join(" ");
    console.log(`  ${id.padEnd(20)} ${res.status}  ${shapes}`);
  }
}

async function sectionG(token: string): Promise<void> {
  console.log("\n==== SECTION G — digital_film_no is an image group number ====\n");

  const res = await fetchWithRetry(`${ITEM_URL}/koha:745492`, {
    headers: headers(token),
  });
  const data = (await res.json()) as {
    source?: {
      film_note?: Record<string, unknown> | Record<string, unknown>[];
      note?: unknown;
      available_online?: string;
    };
  };
  const raw = data.source?.film_note;
  const notes = Array.isArray(raw) ? raw : raw ? [raw] : [];
  console.log(`koha:745492 carries ${notes.length} film notes. First three:`);
  for (const n of notes.slice(0, 3)) {
    console.log(
      `  filmno=${n.filmno} digital_film_no=${n.digital_film_no} fs_indexed=${n.fs_indexed} shelf=${n.shelf}`,
    );
    console.log(`    ${n.text}`);
  }

  const dgs = String(notes[0]?.digital_film_no ?? "");
  const apid = await fetchWithRetry(
    `${GROUP_SERVICE_BASE}/group/${encodeURIComponent(dgs)}/apid`,
    { headers: { ...headers(token), "FS-User-Agent-Chain": "chesworth" } },
  );
  console.log(
    `\nDGS ${dgs} -> group service ${apid.status}: ${(await apid.text()).trim()}`,
  );
  console.log("(the same resolution image_search performs on imageGroupNumber)");

  const book = await fetchWithRetry(`${ITEM_URL}/koha:4124635`, {
    headers: headers(token),
  });
  const bookData = (await book.json()) as {
    source?: { note?: unknown; film_note?: unknown; available_online?: string };
  };
  const bookNotes = Array.isArray(bookData.source?.note)
    ? bookData.source?.note
    : [bookData.source?.note];
  console.log(
    `\nA digitized book (koha:4124635): available_online=${bookData.source?.available_online}, film_note=${bookData.source?.film_note === undefined ? "absent" : "present"}`,
  );
  for (const n of bookNotes as { type?: string; text?: string }[]) {
    if (n?.type === "RSLINK") console.log(`  RSLINK note: ${n.text}`);
  }
}

const SECTIONS: Record<string, (token: string) => Promise<void>> = {
  A: sectionA,
  B: sectionB,
  C: sectionC,
  D: sectionD,
  E: sectionE,
  F: sectionF,
  G: sectionG,
};

async function main(): Promise<void> {
  const idx = process.argv.indexOf("--section");
  const requested = idx === -1 ? null : process.argv[idx + 1]?.toUpperCase();
  if (requested && !SECTIONS[requested]) {
    console.error(
      `Unknown section ${requested}. Known: ${Object.keys(SECTIONS).join(", ")}`,
    );
    process.exit(1);
  }

  const token = await getValidToken(LOCAL);
  const run = requested ? [requested] : Object.keys(SECTIONS);
  for (const name of run) await SECTIONS[name](token);

  console.log("\n================================================================");
  console.log("DONE");
  console.log("================================================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
