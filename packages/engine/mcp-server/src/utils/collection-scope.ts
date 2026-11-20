/**
 * Derive the collection-title search term from a place. FamilySearch organizes
 * record collections at the state/province level for the United States, Canada,
 * and Mexico, and at the country level everywhere else. Given a `standardPlace`
 * (the fully-qualified name from place_search, e.g.
 * "Schuylkill, Pennsylvania, United States"), return the right title-match term:
 *   - United States   -> the state            ("Pennsylvania")
 *   - Canada / Mexico  -> "Country, State"      ("Canada, Ontario")
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
  return country;
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
 *  population and mortality censuses (a region before `Census` allowed, as in
 *  `Canada, Prairie Provinces, Census, 1916`); in the United States the Social
 *  Security indexes, the two world-war draft registrations and the city
 *  directories; in Canada and Mexico the country-wide baptism, marriage and death
 *  indexes. Military service, immigration, Freedmen's Bureau, Native American,
 *  land and occupational collections depend on who the person was, and research-plan
 *  finds them with its own `collections_search` when the question calls for them. */
const CORE_NATIONAL_REST =
  /^(?:[^,]+, )?(?:National )?Census(?:,? \d{4}\b|\s*\(Mortality Schedule\)| Mortality Schedules)/;
const CORE_US_INDEX =
  /^(?:Social Security Death Index|Social Security Numerical Identification Files|World War I Draft Registration Cards|World War II Draft Registration Cards|City and Business Directories)\b/;

const CORE_VITAL_INDEX = /^(?:Births and Baptisms|Baptisms|Marriages|Deaths and Burials|Deaths),/;

/** Whether a national title (`isNationalCollectionTitle`) is one of the core ones. */
export function isCoreNationalCollection(title: string, country: NationalCollectionCountry): boolean {
  if (!isNationalCollectionTitle(title, country)) return false;
  const rest = title.slice(country.length + 1).trim();
  if (CORE_NATIONAL_REST.test(rest)) return true;
  return country === "United States" ? CORE_US_INDEX.test(rest) : CORE_VITAL_INDEX.test(rest);
}

/** The earliest and latest four-digit year in a free-text period or date range, or
 *  null when it holds none. */
export function yearSpan(text: unknown): [number, number] | null {
  if (typeof text !== "string") return null;
  const years = (text.match(/(?<!\d)(1\d{3}|20\d{2})(?!\d)/g) ?? []).map(Number);
  return years.length === 0 ? null : [Math.min(...years), Math.max(...years)];
}
