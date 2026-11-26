/**
 * Flags on a planned next action that is unlikely to be usable.
 *
 * "Dead ends become next actions" fails when the next actions are not usable. In the
 * reported case 2 of 8, then 1 of 3 suggestions were viable; the rest were "in the
 * wrong place or years", including COUNTY records for a death in an independent city
 * the locality guide had already flagged. A researcher hitting that churns.
 *
 * Decided from the project documents alone — the recorded localities and the item's
 * own fields — so it needs no network call and works while the run is offline.
 *
 * **Flags, never gates.** Searching a neighbouring jurisdiction can be deliberate and
 * right; a year outside the obvious window can be a fallback. This reports and the
 * researcher decides. A rule that refused these writes would block correct work, and
 * the repo's own doctrine is that heuristics are flags, never gates.
 */

import { resolveCensusPlace } from "./census-note.js";

export interface PlanItemLike {
  jurisdiction?: unknown;
  date_range?: unknown;
  repository?: unknown;
  record_type?: unknown;
}

export interface LocalityLike {
  place?: unknown;
}

export interface PlanItemFlag {
  kind: "jurisdiction" | "date_range";
  message: string;
}

/** The two strings, each with its own trailing (outermost) segment removed —
 *  `"Wayne, Michigan"` for `"Wayne, Michigan, United States"`. `""` when there is
 *  no comma to cut at. */
function stripOutermost(s: string): string {
  const i = s.lastIndexOf(",");
  return i === -1 ? "" : s.slice(0, i).trim();
}

function tailMatch(a: string, b: string): boolean {
  return !!a && !!b && (a === b || a.endsWith(`, ${b}`));
}

/** `"Detroit, Wayne, Michigan"` sits inside `"Wayne, Michigan"`. Compared on the
 *  place-string TAIL, which is how the corpus writes nesting, and case-folded so a
 *  capitalisation difference is not read as a different place.
 *
 *  Tolerates a COUNTRY-level segment present on only ONE side: `jurisdiction` and
 *  a recorded locality are populated by different callers, and one routinely
 *  carries a trailing "United States" (or another country) that the other omits
 *  — found against a real project where `jurisdiction` ("Detroit, Wayne,
 *  Michigan, United States") and the matching recorded locality ("Wayne,
 *  Michigan") were the SAME place and still read as unrelated. Dropping exactly
 *  one trailing segment from exactly one side and retrying the same tail check
 *  catches that without loosening anything else: it can only turn a match that
 *  failed solely on an extra outermost segment into a match, never a genuinely
 *  different county into one — that mismatch sits at the county/city level,
 *  which this never touches. */
function isInside(item: string, locality: string): boolean {
  const a = item.trim().toLowerCase();
  const b = locality.trim().toLowerCase();
  if (!a || !b) return false;
  return (
    tailMatch(a, b) ||
    tailMatch(stripOutermost(a), b) ||
    tailMatch(a, stripOutermost(b))
  );
}

/** `"1855-1876"` (or with an en or em dash) → [1855, 1876]; a single year `"1891"`
 *  → [1891, 1891], which the corpus writes for a one-census item. Anything else is
 *  null. */
function parseRange(value: string): [number, number] | null {
  const m = /^\s*(\d{4})\s*(?:[-–—]\s*(\d{4})\s*)?$/.exec(value);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? m[1])];
}

/**
 * A question's plans that leave most of its `date_window` unsearched (issue #2424).
 *
 * The window is the question's own: the years whose records could answer it, stated by
 * question-selection. The subject's lifetime is not a stand-in — a marriage question
 * needs the twenties, a death question the end of life — and measured as one it fired on
 * 145 of 391 committed plan-bearing questions, correct plans included.
 *
 * Judged on the SPAN of the question's live items (earliest start to latest end), not
 * their summed years: a census-only plan of single years 1850…1900 covers a life even
 * though each item is one year. Items on a superseded plan and skipped items search
 * nothing, so they are left out. Fires when more than half the window falls outside the
 * span. No window, a malformed one, or no parseable item: no opinion.
 *
 * A flag, never a gate (decided 2026-10-01): a plan can stop short for a reason the
 * documents do not hold.
 *
 * When the live items include a US federal census item, it also names each US federal
 * census year inside the window that no US federal census item's `date_range` covers
 * ("no item covers 1920"). A skipped census item covers its years here: its
 * `skip_reason` is the stated reason that census cannot hold the record. 1890 is never
 * named (its schedules almost all burned), nor any year after 1950 (not yet released).
 * Both notes, when both fire, come back as one string.
 */
export function planWindowFlag(question: any, plans: any[]): string | null {
  const window = typeof question?.date_window === "string" ? parseRange(question.date_window) : null;
  if (!window || window[0] > window[1]) return null;
  const dated: DatedItem[] = [];
  for (const plan of plans ?? []) {
    if (plan?.question_id !== question.id || plan?.status === "superseded") continue;
    for (const item of Array.isArray(plan?.items) ? plan.items : []) {
      if (typeof item?.date_range !== "string") continue;
      const r = parseRange(item.date_range);
      if (!r || r[0] > r[1]) continue;
      dated.push({ item, range: r });
    }
  }
  const live = dated.filter((d) => d.item?.status !== "skipped");
  if (live.length === 0) return null;
  const notes = [spanNote(question.id, window, live), censusYearsNote(question.id, window, live, dated)];
  return notes.filter(Boolean).join(" ") || null;
}

interface DatedItem {
  item: any;
  range: [number, number];
}

function spanNote(id: string, [ws, we]: [number, number], live: { range: [number, number] }[]): string {
  const lo = Math.min(...live.map((l) => l.range[0]));
  const hi = Math.max(...live.map((l) => l.range[1]));
  const length = we - ws + 1;
  const outside =
    Math.min(length, Math.max(0, lo - ws)) + Math.min(length, Math.max(0, we - hi));
  const uncovered = Math.min(length, outside);
  if (uncovered * 2 <= length) return "";
  return (
    `${id}'s plans span ${lo}–${hi} but its date window is ${ws}–${we}: ` +
    `${uncovered} of its ${length} years fall outside every plan item. Add an item whose ` +
    `date_range covers the uncovered years, or say in that item's rationale why they ` +
    `cannot hold the record.`
  );
}

/** Every US federal census year whose population schedules can be searched. */
const US_FEDERAL_CENSUS_YEARS: readonly number[] = Array.from({ length: 17 }, (_, i) => 1790 + 10 * i).filter(
  (y) => y !== 1890,
);

const isCensusItem = (item: any) => /census/i.test(String(item?.record_type ?? ""));

/** A census item whose `record_type` does not name a state census and whose
 *  `jurisdiction` resolves, through the census table's place reading, to the
 *  United States ("Goochland County, Virginia" included). */
function isUsFederalCensusItem(item: any): boolean {
  if (!isCensusItem(item) || /state/i.test(String(item?.record_type ?? ""))) return false;
  const jurisdiction = typeof item?.jurisdiction === "string" ? item.jurisdiction : "";
  return resolveCensusPlace(jurisdiction).at(-1) === "united states";
}

function censusYearsNote(id: string, [ws, we]: [number, number], live: DatedItem[], dated: DatedItem[]): string {
  if (!live.some((l) => isUsFederalCensusItem(l.item))) return "";
  const census = dated.filter((d) => isUsFederalCensusItem(d.item));
  const missing = US_FEDERAL_CENSUS_YEARS.filter(
    (y) => y >= ws && y <= we && !census.some((l) => l.range[0] <= y && y <= l.range[1]),
  );
  if (missing.length === 0) return "";
  return (
    `${id}: no item covers ${missing.join(", ")} — US federal census years in its date window ` +
    `${ws}–${we}. Add a census item whose date_range covers each, or a skipped census item ` +
    `whose skip_reason says why that census cannot hold the record.`
  );
}

const PLACE_JOINER = /\s+(?:and|or|&)\s+|\s*[;/]\s*/i;

/** The refusal for a plan item whose `jurisdiction` joins two or more places, or
 *  `undefined`. Unlike the flags below this gates: search-records hands the
 *  jurisdiction to `record_search` as its one `residencePlace`, so "Alabama and
 *  Texas, United States" is an item no search can run, not a judgment call.
 *
 *  Refused only when the string splits on "and", "or", "&", ";" or "/" into two or
 *  more parts and EVERY part sits inside, or encloses, a locality this project has
 *  researched. That is what tells two places apart from one place whose name
 *  holds a joiner: "Lewis and Clark County, Montana" splits into "Lewis", which no
 *  locality matches, so it is left alone, as is anything in a project with no
 *  recorded locality. An elided part ("Smith County and Hill County, Texas") is
 *  not caught, because filling in its tail would also split "Lewis and Clark". */
export function compoundJurisdictionError(
  item: PlanItemLike,
  localities: LocalityLike[]
): string | undefined {
  const jurisdiction = typeof item?.jurisdiction === "string" ? item.jurisdiction : "";
  const parts = jurisdiction.split(PLACE_JOINER).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return undefined;
  const places = (localities ?? [])
    .map((l) => (typeof l?.place === "string" ? l.place : ""))
    .filter(Boolean);
  const known = (part: string) => places.some((p) => isInside(part, p) || isInside(p, part));
  if (!parts.every(known)) return undefined;
  return (
    `jurisdiction '${jurisdiction}' names ${parts.length} places (${parts.join("; ")}). ` +
    `A plan item searches one place: write one item per place, each with its own ` +
    `place_search standardPlace.`
  );
}

/** How a model writes each `build_external_search_url` site in prose. The slugs
 *  ("chronicling_america") match nothing a model writes. Keyed by the site value;
 *  a test fails until every advertised site but `digital_newspaper_archive` is
 *  named here (the generic state-archive entry, which has no name; a state archive
 *  is caught by the project's stored `link_text` instead). Not typed by
 *  `ExternalSearchSite`: even a type-only import of a tool file puts every tool
 *  that imports this module into apps/server's token-reach scan. */
export const OUTSIDE_SITE_NAMES: Readonly<Record<string, readonly string[]>> = {
  ancestry: ["ancestry", "ancestry.com"],
  myheritage: ["myheritage", "my heritage"],
  findmypast: ["findmypast", "find my past"],
  findagrave: ["find a grave", "findagrave"],
  newspapers: ["newspapers.com"],
  chronicling_america: ["chronicling america"],
  // Not "National Archives" or "NARA": FamilySearch holds National Archives film,
  // so a FamilySearch item can name them correctly.
  archives_gov: ["national archives catalog", "archives.gov"],
  archive_org: ["archive.org", "internet archive"],
  billiongraves: ["billiongraves", "billion graves"],
  digitalarkivet: ["digitalarkivet"],
  antenati: ["antenati"],
  library_archives_canada: ["library and archives canada"],
  american_ancestors: ["american ancestors", "americanancestors"],
  italian_genealogy: ["italiangenealogy", "italian genealogy"],
  archion: ["archion"],
  matricula: ["matricula"],
  // Open Archieven is the site's Dutch name; openarchieven.nl its host.
  openarch: ["open archives", "openarch", "open archieven", "openarchieven"],
  blm_glo: ["glorecords", "general land office records", "blm glo"],
};

/** Lower-cased, "&" read as "and", hyphens and every run of whitespace (a
 *  non-breaking space included) as one space: "Find-A-Grave" is "find a grave". */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[-‐-―]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `name` as a whole word or phrase of `text` (both normalized by the caller):
 *  "ancestry" matches "(Ancestry)" and not "ancestryish". */
function namesPhrase(text: string, name: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(name)}(?:$|[^a-z0-9])`).test(text);
}

/** Sites whose name, then up to three words, then "index" or "indexes", is the title
 *  of a FamilySearch collection ("United States, Find a Grave Index", "Newspapers.com
 *  Obituary Index"), so a FamilySearch item may name it. No other site has one:
 *  "(Ancestry index)" still names Ancestry. */
const INDEXED_BY_FAMILYSEARCH = new Set(["findagrave", "billiongraves", "newspapers"]);

const INDEX_TAIL = "index(?:es)?";
/** A stored archive or library name followed by "film" or "microfilm" is film
 *  FamilySearch holds ("Texas State Library and Archives microfilm"), as "National
 *  Archives" film is. */
const FILM_TAIL = "(?:micro)?film(?:s|ed)?";

/** `text` with each `name`, up to three space-separated words, then `tail`, blanked
 *  out: a FamilySearch collection title ("Newspapers.com Stories and Events Index",
 *  "Find a Grave (index)") or film it holds. Only spaces join the middle words, so
 *  "Find a Grave; Ancestry index" keeps Find a Grave, and each site is tested on its
 *  own, so a title reaching over a second site's name never hides that site. */
function withoutTitles(text: string, name: string, tail: string): string {
  return text.replace(
    new RegExp(
      `(^|[^a-z0-9])${escapeRegExp(name)}(?: [a-z0-9.']+){0,3}[^a-z0-9]{1,3}${tail}(?=$|[^a-z0-9])`,
      "g",
    ),
    "$1 ",
  );
}

/** Whether `text` names a fixed site (`OUTSIDE_SITE_NAMES`) as a whole word or
 *  phrase, with no collection-title exemption. Exported for the corpus replay's
 *  rationale count, so it counts as the guard reads. */
export function namesFixedSite(text: string): boolean {
  const t = normalizeName(text);
  return Object.values(OUTSIDE_SITE_NAMES).some((names) => names.some((n) => namesPhrase(t, normalizeName(n))));
}

/** Whether the router sends this plan item to FamilySearch agents (`searchStepFor`):
 *  a `fs_hints` item always (search-hints), otherwise a blank, missing or
 *  FamilySearch `repository` (search-records). */
export function routesToFamilySearch(item: PlanItemLike | null | undefined): boolean {
  if (item?.record_type === "fs_hints") return true;
  const repo = typeof item?.repository === "string" ? item.repository.trim() : "";
  return repo === "" || /familysearch/i.test(repo);
}

/** Words that name a kind of record or page, not a site. A stored `link_text` made
 *  only of these and numbers ("Parish Registers", "Death Certificates", "1871
 *  Census", "National Archives") describes what a FamilySearch item can also hold,
 *  so it is never read as a site. */
const RECORD_WORDS = new Set(
  (
    "a about access agricultural and archive archives baptisms bible birth births blocked bot burials " +
    "card catalog cemeteries cemetery census censuses certificate certificates church churches city " +
    "collection collections court data database databases death deaths digital directories directory " +
    "emigration english extractions families family for forbidden funeral genealogies genealogy " +
    "historic historical home immigration in index indexes land latest libraries library main map " +
    "marriage marriages military national naturalization naturalizations news newspaper newspapers " +
    "notices obituaries obituary of online page parish parishes phone population probate query records " +
    "record register registers research resources schedules search site state surname surnames tax " +
    "telephone the total verification verify vital will wills"
  ).split(" ")
);

function namesOnlyRecords(name: string): boolean {
  return name.split(/[^a-z0-9]+/).every((w) => w === "" || /^\d+$/.test(w) || RECORD_WORDS.has(w));
}

/** Words that make a stored `link_text` read as a site rather than a collection
 *  title or a place ("Utah Digital Newspapers", "Texas State Library and Archives",
 *  "The Scottish Genealogy Society"). */
const SITE_WORDS = new Set(
  "archive archives digital libraries library newspaper newspapers society".split(" "),
);
const DOMAIN = /[a-z0-9-]{2,}\.(?:com|org|net|gov|edu|info|[a-z]{2})(?![a-z0-9])/;

/** Whether a stored `link_text` looks like a site: a domain ("Genealogy.net"), or
 *  two or more words, not only `RECORD_WORDS`, holding a fixed site name or a
 *  `SITE_WORDS` word. Never one naming FamilySearch. Live `link_text`s are mostly
 *  collection titles ("Civil Marriage Records, 1894-1896") and places ("Los
 *  Angeles"), so anything else is not read as a site: missing a site costs less than
 *  refusing a sound FamilySearch item. Exported for the corpus replay. */
export function looksLikeSite(linkText: string): boolean {
  const name = normalizeName(linkText);
  if (name.includes("familysearch")) return false;
  if (DOMAIN.test(name)) return true;
  if (name.split(" ").length < 2 || namesOnlyRecords(name)) return false;
  if (namesFixedSite(name)) return true;
  return name.split(/[^a-z0-9]+/).some((w) => SITE_WORDS.has(w));
}

/** The refusal for a FamilySearch plan item whose `jurisdiction` names an outside
 *  site, or `undefined` (#4665). The router sends an item to FamilySearch agents or
 *  to search-external-sites by its one `repository`, so a site written into a
 *  FamilySearch item's jurisdiction is never searched.
 *
 *  Reads `jurisdiction` only, never `rationale`: a jurisdiction is a place, so a
 *  site name there is never a passing mention, while most rationales naming a site
 *  are FamilySearch collection titles ("Find a Grave Index") or availability notes.
 *  `storedNames` (the project's `external-collections.json` `link_text`s) count
 *  only when they look like a site (`looksLikeSite`), and the refusal quotes them as
 *  stored. */
export function outsideSiteJurisdictionError(
  item: PlanItemLike,
  storedNames: readonly string[] = []
): string | undefined {
  if (!routesToFamilySearch(item)) return undefined;
  const jurisdiction = typeof item?.jurisdiction === "string" ? item.jurisdiction : "";
  const text = normalizeName(jurisdiction);
  if (text === "") return undefined;
  const found: { shown: string; name: string }[] = [];
  for (const [site, names] of Object.entries(OUTSIDE_SITE_NAMES)) {
    const hit = names.find((n) => {
      const name = normalizeName(n);
      return namesPhrase(INDEXED_BY_FAMILYSEARCH.has(site) ? withoutTitles(text, name, INDEX_TAIL) : text, name);
    });
    if (hit) found.push({ shown: hit, name: normalizeName(hit) });
  }
  for (const raw of storedNames) {
    if (typeof raw !== "string") continue;
    if (!looksLikeSite(raw)) continue;
    const name = normalizeName(raw);
    // The same site under both lists ("Chronicling America" stored too), compared as
    // whole words: "matriculation society archives" is not "matricula".
    if (found.some((f) => namesPhrase(f.name, name) || namesPhrase(name, f.name))) continue;
    if (namesPhrase(withoutTitles(text, name, FILM_TAIL), name)) found.push({ shown: raw.trim(), name });
  }
  if (found.length === 0) return undefined;
  const sites = found.map((f) => `'${f.shown}'`).join(", ");
  return (
    `jurisdiction '${jurisdiction}' names ${sites}, ${found.length === 1 ? "an outside site" : "outside sites"}, ` +
    `on a FamilySearch item. A plan item searches one repository, and a FamilySearch item ` +
    `goes only to FamilySearch agents, so ${found.length === 1 ? "that site" : "those sites"} would never be searched: ` +
    `keep this item's jurisdiction to the place, and write a separate item per site whose ` +
    `repository is the site, so search-external-sites runs it.`
  );
}

export function planItemFlags(
  item: PlanItemLike,
  localities: LocalityLike[]
): PlanItemFlag[] {
  const flags: PlanItemFlag[] = [];
  const jurisdiction = typeof item?.jurisdiction === "string" ? item.jurisdiction : "";
  const range = typeof item?.date_range === "string" ? item.date_range : "";

  // Only speak when the project has said where it is working. With no recorded
  // locality there is nothing to be inconsistent WITH, and guessing would flag every
  // first plan item ever written.
  const places = (localities ?? [])
    .map((l) => (typeof l?.place === "string" ? l.place : ""))
    .filter(Boolean);
  // Either direction: a search inside a recorded locality, or one that ENCLOSES it (a
  // statewide or national index covering the county), is in the right place.
  if (
    jurisdiction &&
    places.length > 0 &&
    !places.some((p) => isInside(jurisdiction, p) || isInside(p, jurisdiction))
  ) {
    flags.push({
      kind: "jurisdiction",
      message:
        `${jurisdiction} is not inside any locality this project has researched ` +
        `(${places.join("; ")}). Check that its records can hold an event from there.`
    });
  }

  // An unparseable range gets no opinion: the corpus writes "1900-1900" and
  // "1855-1876", but a human may write "c. 1880s", and flagging that as wrong would
  // be the tool being confidently ignorant.
  const parsed = range ? parseRange(range) : null;
  if (parsed && parsed[0] > parsed[1]) {
    flags.push({
      kind: "date_range",
      message: `${range} runs backwards — the search would cover no years at all.`
    });
  }

  return flags;
}
