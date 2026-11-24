/** A country whose places' collection titles lead with another name than the
 *  country a `standardPlace` ends with: `parts` by the part below it, `terms` for
 *  the rest of the country (null: the rest keeps the substring match). */
interface LeadingTermsRow {
  parts?: Readonly<Record<string, readonly string[]>>;
  terms: readonly string[] | null;
}

/** The places whose catalog titles do not lead with their standard place's
 *  country, and the terms their titles start with. A title is in scope when it
 *  STARTS with a term, so the match is anchored: as a substring, "England" would
 *  also take "United States, New England …", "Wales" every "Australia, New South
 *  Wales, …" title and "Jersey" every "New Jersey, …" one.
 *   - The United Kingdom's countries ("England, …", "England and Wales, …",
 *     "England Marriages, …", "Scotland, …") and the kingdom-wide titles. Northern
 *     Ireland takes "Ireland" for the pre-1922 collections that cover the island.
 *   - France's overseas departments Guadeloupe and Martinique, nested under France.
 *   - Countries the catalog names otherwise: Czechia's titles say "Czech Republic".
 *   - Jersey and Guernsey, whose collection is "Channel Islands, …".
 *  Measured against the live catalog: `dev/probe-collection-scope-nesting.ts`. */
const LEADING_TERMS: Readonly<Record<string, LeadingTermsRow>> = {
  "United Kingdom": {
    parts: {
      England: ["England", "United Kingdom", "Great Britain"],
      Wales: ["Wales", "England and Wales", "United Kingdom", "Great Britain"],
      Scotland: ["Scotland", "United Kingdom", "Great Britain"],
      "Northern Ireland": ["Northern Ireland", "Ireland", "United Kingdom", "Great Britain"],
    },
    terms: ["United Kingdom", "Great Britain"],
  },
  France: {
    parts: { Guadeloupe: ["Guadeloupe", "France"], Martinique: ["Martinique", "France"] },
    terms: null,
  },
  Czechia: { terms: ["Czechia", "Czech Republic"] },
  "Federated States of Micronesia": { terms: ["Federated States of Micronesia", "Micronesia"] },
  "United States Virgin Islands": { terms: ["United States Virgin Islands", "Virgin Islands (U.S.)"] },
  "Saint Lucia": { terms: ["Saint Lucia", "St. Lucia"] },
  "Cabo Verde": { terms: ["Cabo Verde", "Cape Verde"] },
  Jersey: { terms: ["Jersey", "Channel Islands"] },
  Guernsey: { terms: ["Guernsey", "Channel Islands"] },
};

/** The row of `LEADING_TERMS` for a place's last part, and the part below it
 *  when that part has a row of its own. */
function leadingTermsOf(standardPlace: string): { below?: string; terms: readonly string[] | null } | null {
  const parts = standardPlace.split(",").map((p) => p.trim()).filter(Boolean);
  const country = parts[parts.length - 1];
  if (country === undefined || !Object.hasOwn(LEADING_TERMS, country)) return null;
  const row = LEADING_TERMS[country];
  const below = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  if (below !== undefined && row.parts && Object.hasOwn(row.parts, below)) return { below, terms: row.parts[below] };
  return { terms: row.terms };
}

/**
 * Derive the collection-title search term from a place. FamilySearch organizes
 * record collections at the state/province level for the United States, Canada,
 * and Mexico, at the constituent-country level in the United Kingdom, and at the
 * country level everywhere else. Given a `standardPlace` (the fully-qualified
 * name from place_search, e.g. "Schuylkill, Pennsylvania, United States"),
 * return the right title-match term:
 *   - United States   -> the state            ("Pennsylvania")
 *   - Canada / Mexico  -> "Country, State"      ("Canada, Ontario")
 *   - United Kingdom   -> England, Wales, Scotland or Northern Ireland
 *   - a part below the country with its own `LEADING_TERMS` row -> that part
 *     ("Guadeloupe" for "…, Guadeloupe, France")
 *   - everywhere else  -> the country          ("France")
 *
 * The standardPlace format is comma-separated with the country last and the
 * state/province second-to-last. A free-text query that isn't a standardPlace
 * (no recognized country tail, e.g. "Census" or "Schuylkill County Pennsylvania")
 * passes through unchanged, so the tool still accepts an arbitrary place query.
 */
export function standardPlaceToCollectionsQuery(value: string): string {
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return value.trim();

  const country = parts[parts.length - 1];
  const state = parts.length >= 2 ? parts[parts.length - 2] : undefined;

  if (country === "United States") return state ?? country;
  if (country === "Canada" || country === "Mexico") {
    return state ? `${country}, ${state}` : country;
  }
  const below = leadingTermsOf(value)?.below;
  if (below !== undefined) return below;
  return country;
}

/** The terms a place's collection titles start with, from `LEADING_TERMS`
 *  (a United Kingdom place: its country's row, else the kingdom-wide terms).
 *  Null for a place the table does not name, which keeps the substring match. */
export function collectionScopeTerms(standardPlace: string): readonly string[] | null {
  return leadingTermsOf(standardPlace)?.terms ?? null;
}

/** Whether a collection title is in a place's scope. For a place with
 *  `collectionScopeTerms`, the title starts with one of them followed by a
 *  non-letter; anywhere else, the title holds the scope
 *  `standardPlaceToCollectionsQuery` derives, ignoring case. Built once per place. */
export function collectionScopeMatcher(standardPlace: string): (title: string) => boolean {
  const terms = collectionScopeTerms(standardPlace);
  if (terms === null) {
    const needle = standardPlaceToCollectionsQuery(standardPlace).toLowerCase();
    return (title) => title.toLowerCase().includes(needle);
  }
  const lead = new RegExp(`^(?:${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?!\\p{L})`, "iu");
  return (title) => lead.test(title);
}

/** The countries whose FamilySearch collections are scoped below the country, so a
 *  place's own scope leaves out the country-wide ones. */
export type NationalCollectionCountry = "United States" | "Canada" | "Mexico";

const SUBDIVISIONS: Readonly<Record<NationalCollectionCountry, readonly string[]>> = {
  "United States": [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
    "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
    "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
    "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
    "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
    "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah",
    "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming", "Puerto Rico", "Guam",
    "American Samoa", "Virgin Islands", "Northern Mariana Islands",
  ],
  Canada: [
    "Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland", "Labrador",
    "Northwest Territories", "Nova Scotia", "Nunavut", "Ontario", "Prince Edward Island", "Quebec",
    "Québec", "Saskatchewan", "Yukon",
  ],
  Mexico: [
    "Aguascalientes", "Baja California", "Campeche", "Chiapas", "Chihuahua", "Coahuila", "Colima",
    "Distrito Federal", "Ciudad de México", "Durango", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco",
    "México", "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla", "Querétaro",
    "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala",
    "Veracruz", "Yucatán", "Zacatecas",
  ],
};

const SUBDIVISION_RE: Readonly<Record<NationalCollectionCountry, RegExp>> = Object.fromEntries(
  Object.entries(SUBDIVISIONS).map(([country, names]) => [
    country,
    new RegExp(`(?<![\\p{L}\\p{N}])(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}])`, "u"),
  ]),
) as Record<NationalCollectionCountry, RegExp>;

/** The country of a `standardPlace` whose country-wide collections its own scope
 *  leaves out, or null. */
export function nationalCollectionScope(standardPlace: string): NationalCollectionCountry | null {
  const parts = standardPlace.split(",").map((p) => p.trim()).filter(Boolean);
  const country = parts[parts.length - 1];
  return country === "United States" || country === "Canada" || country === "Mexico" ? country : null;
}

/** The national-collection country of a `localities` entry: from its `place`, else
 *  the first of its `jurisdictions[].name` that has one. */
export function localityNationalCountry(entry: { place?: unknown; jurisdictions?: unknown }): NationalCollectionCountry | null {
  const names = [entry.place, ...(Array.isArray(entry.jurisdictions) ? entry.jurisdictions.map((j: any) => j?.name) : [])];
  for (const n of names) {
    const country = typeof n === "string" ? nationalCollectionScope(n) : null;
    if (country) return country;
  }
  return null;
}

/**
 * Whether a catalog title is a country-wide collection of `country`: it starts with
 * the country, followed by a comma or a space, and the next part of the title names
 * none of the country's states, provinces or territories.
 *   kept:    "United States, Census, 1900", "United States Census (Mortality Schedule), 1850-1880",
 *            "Canada Census, 1921", "Mexico, National Census, 1930",
 *            "United States, Freedmen's Bureau Marriages, 1859-1873"
 *   dropped: "United States, Kentucky, Agricultural Schedules, 1850-1880",
 *            "United States Virgin Islands, Census Records, 1841-1911",
 *            "Canada, Ontario, Births, 1869-1912", "Mexico, Jalisco, Civil Registration, 1857-2000",
 *            "New Mexico, Deaths, 1889-1945"
 */
export function isNationalCollectionTitle(title: string, country: NationalCollectionCountry): boolean {
  if (!title.startsWith(country)) return false;
  const sep = title.charAt(country.length);
  if (sep !== "," && sep !== " ") return false;
  const next = title.slice(country.length + 1).split(",")[0].trim();
  return next !== "" && !SUBDIVISION_RE[country].test(next);
}

/** The national collections nearly every question in the country can use: the
 *  population and mortality censuses (a regional one, as in
 *  `Canada, Prairie Provinces, Census, 1916`, only for a locality in a province it
 *  covers: `CENSUS_REGION_PROVINCES`); in the United States the Social
 *  Security indexes, the two world-war draft registrations and the city
 *  directories; in Canada and Mexico the country-wide baptism, marriage and death
 *  indexes. Military service, immigration, Freedmen's Bureau, Native American,
 *  land and occupational collections depend on who the person was, and research-plan
 *  finds them with its own `collections_search` when the question calls for them. */
const CORE_NATIONAL_REST =
  /^(?:([^,]+), )?(?:National )?Census(?:,? \d{4}\b|\s*\(Mortality Schedule\)| Mortality Schedules)/;

/** The provinces each regional census in a national title covers. A regional
 *  census is core only for a locality in one of them; a region not listed here is
 *  not core anywhere. */
const CENSUS_REGION_PROVINCES: Readonly<Record<string, readonly string[]>> = {
  "Lower Canada": ["Quebec", "Québec"],
  "Upper Canada": ["Ontario"],
  "Prairie Provinces": ["Manitoba", "Saskatchewan", "Alberta"],
  "Northwest Provinces": ["Manitoba", "Saskatchewan", "Alberta"],
};
const CORE_US_INDEX =
  /^(?:Social Security Death Index|Social Security Numerical Identification Files|World War I Draft Registration Cards|World War II Draft Registration Cards|City and Business Directories)\b/;

const CORE_VITAL_INDEX = /^(?:Births and Baptisms|Baptisms|Marriages|Deaths and Burials|Deaths),/;

/** Whether a national title (`isNationalCollectionTitle`) is one of the core ones
 *  for a locality named by `places` (its place, for_place and jurisdiction names).
 *  A regional census (`Canada, Upper Canada, Census, 1842`) is core only when one of
 *  `places` names a province the region covers. */
export function isCoreNationalCollection(
  title: string,
  country: NationalCollectionCountry,
  places: readonly unknown[] = [],
): boolean {
  if (!isNationalCollectionTitle(title, country)) return false;
  const rest = title.slice(country.length + 1).trim();
  const census = CORE_NATIONAL_REST.exec(rest);
  if (census) {
    const region = census[1];
    if (region === undefined) return true;
    const provinces = CENSUS_REGION_PROVINCES[region] ?? [];
    return places.some(
      (p) =>
        typeof p === "string" &&
        provinces.some((prov) => new RegExp(`(?<![\\p{L}\\p{N}])${prov}(?![\\p{L}\\p{N}])`, "u").test(p)),
    );
  }
  return country === "United States" ? CORE_US_INDEX.test(rest) : CORE_VITAL_INDEX.test(rest);
}

/** The earliest and latest four-digit year in a free-text period or date range, or
 *  null when it holds none. */
export function yearSpan(text: unknown): [number, number] | null {
  if (typeof text !== "string") return null;
  const years = (text.match(/(?<!\d)(1\d{3}|20\d{2})(?!\d)/g) ?? []).map(Number);
  return years.length === 0 ? null : [Math.min(...years), Math.max(...years)];
}
