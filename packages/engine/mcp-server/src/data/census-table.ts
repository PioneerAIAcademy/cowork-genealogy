// The censuses `timeline_build` expects a person to appear in (issue #3516,
// decision 14). A census gap means FamilySearch likely holds a record that could
// be attached and is not, and a false `high` gap is worse than a missed one, so a
// row exists only where both hold:
//
//   - it is a population enumeration a FamilySearch collection indexes, with the
//     year read from the collection's TITLE (a title naming a range of years
//     gives no row: which years it indexes is unknown);
//   - `covers` names only the places that census enumerated and whose returns
//     survive in that index. A collection indexing only part of its census lists
//     only the parts known covered; when that is unknown it gets no row. The
//     population note on a row is the basis for that judgement.
//
// `covers` holds every standard-place form the area takes, because Places
// names change with the era ("Kent, England" before 1801, "Kent, England,
// United Kingdom" after) and a project holds both. A row covers a place when
// one of its forms is a whole-segment suffix of it.
//
// Filled 2026-10-22 from the live catalog. A collection whose indexed records
// are under 75% of that census's enumerated population (of households, for a
// schedule naming only heads) gets no row. City and municipal censuses have no
// rows yet. Fixed row by row as rows prove wrong; `dev/check-census-table.ts`
// checks each row against the live catalog. This module imports nothing.
//
// A row's note gives its indexed record count, as the catalog reported it on
// 2026-10-22. A population total, and so a percentage, is given only where it
// is sourced: for every kept row an estimate put within ten points of the
// line, and for the collections left out near it. "No row" lists the collections left out; the
// others there were judged against population estimates not sourced here, and
// leaving a collection out can only miss a gap.

export interface CensusRow {
  year: number;
  /** The jurisdiction a gap names: "<year> <label> census". */
  label: string;
  covers: readonly string[];
  collectionId: string;
  /** The schedule names only the head of household (US 1790–1840). */
  headsOnly: boolean;
}

export interface CensusFragment {
  year: number;
  covers: readonly string[];
}

/** US federal schedules that name only the head of household. Also read by
 *  research_log_append's pre-1880 census note gate. */
export const HEAD_ONLY_US_CENSUS_YEARS: ReadonlySet<number> = new Set([1790, 1800, 1810, 1820, 1830, 1840]);

/** Censuses that survive only as fragments: never a row, never an expected year. */
export const CENSUS_FRAGMENTS: readonly CensusFragment[] = [
  { year: 1890, covers: ["United States"] },
  { year: 1821, covers: ["Ireland", "Ireland, United Kingdom", "Northern Ireland, United Kingdom"] },
  { year: 1831, covers: ["Ireland", "Ireland, United Kingdom", "Northern Ireland, United Kingdom"] },
  { year: 1841, covers: ["Ireland", "Ireland, United Kingdom", "Northern Ireland, United Kingdom"] },
  { year: 1851, covers: ["Ireland", "Ireland, United Kingdom", "Northern Ireland, United Kingdom"] },
  { year: 1841, covers: ["New South Wales, Australia"] },
];

const us = (...states: string[]): string[] => states.map((s) => `${s}, United States`);

const US_1790 = us(
  "Connecticut", "Maine", "Maryland", "Massachusetts", "New Hampshire", "New York",
  "North Carolina", "Pennsylvania", "Rhode Island", "South Carolina", "Vermont",
);
const US_1800 = [...US_1790, ...us("Delaware")];
const US_1810 = [...US_1800, ...us("Kentucky", "Louisiana", "Virginia", "West Virginia")];
const US_1820 = [
  ...US_1810,
  ...us("District of Columbia", "Georgia", "Illinois", "Indiana", "Michigan", "Mississippi", "Ohio", "Tennessee"),
];
const US_1830 = [...US_1820, ...us("Alabama", "Arkansas", "Florida", "Missouri", "New Jersey")];
const US_1840 = [...US_1830, ...us("Iowa", "Wisconsin")];
const US_1850 = [
  ...US_1840,
  ...us("California", "Minnesota", "New Mexico", "Oregon", "Texas", "Utah", "Washington"),
];
const US_1860 = [
  ...US_1850,
  ...us("Colorado", "Kansas", "Nebraska", "North Dakota", "South Dakota"),
  ...us("Dakota Territory"),
];
const US_1870 = [...US_1860, ...us("Arizona", "Idaho", "Montana", "Nevada", "Wyoming")];
const US_1880 = US_1870;

const federal = (
  year: number,
  collectionId: string,
  covers: readonly string[],
): CensusRow => ({
  year,
  label: "United States",
  covers,
  collectionId,
  headsOnly: HEAD_ONLY_US_CENSUS_YEARS.has(year),
});

const census = (
  year: number,
  label: string,
  covers: readonly string[],
  collectionId: string,
  headsOnly = false,
): CensusRow => ({ year, label, covers, collectionId, headsOnly });

const state = (name: string, ...extraForms: string[]): string[] => [`${name}, United States`, ...extraForms];

const ENGLAND_AND_WALES = ["England", "England, United Kingdom", "Wales", "Wales, United Kingdom"];
const SCOTLAND = ["Scotland", "Scotland, United Kingdom"];
const IRELAND = ["Ireland", "Ireland, United Kingdom", "Northern Ireland, United Kingdom"];
const ONTARIO = ["Ontario, Canada", "Canada West, British North America", "Upper Canada, British North America"];
const QUEBEC = [
  "Quebec, Canada",
  "Quebec, British North America",
  "Canada East, British North America",
  "Lower Canada, British North America",
];
const NEW_BRUNSWICK = ["New Brunswick, Canada", "New Brunswick, British North America"];
const NOVA_SCOTIA = ["Nova Scotia, Canada", "Nova Scotia, British North America"];
const PRAIRIES = ["Manitoba, Canada", "Saskatchewan, Canada", "Alberta, Canada"];
const CANADA_1881 = [
  ...ONTARIO, ...QUEBEC, ...NEW_BRUNSWICK, ...NOVA_SCOTIA,
  "Prince Edward Island, Canada", "Manitoba, Canada", "British Columbia, Canada", "Northwest Territories, Canada",
];
const CANADA_1901 = [...CANADA_1881, "Saskatchewan, Canada", "Alberta, Canada", "Yukon, Canada"];
const NEWFOUNDLAND = ["Newfoundland", "Newfoundland and Labrador, Canada"];
const MECKLENBURG_SCHWERIN = ["Mecklenburg-Schwerin", "Mecklenburg-Schwerin, Germany"];
const france = (dept: string, ...older: string[]): string[] => [dept, ...older].map((d) => `${d}, France`);

export const CENSUS_TABLE: readonly CensusRow[] = [
  // United States federal. 1790/1800 schedules are lost for Delaware (1790),
  // Georgia, Kentucky, New Jersey, Tennessee and Virginia; 1810 for DC, Georgia,
  // Indiana, Mississippi, New Jersey, Ohio and Tennessee; 1820 for Alabama,
  // Arkansas, Missouri and New Jersey. A state or territory not yet enumerated is
  // not listed. 1890 is a fragment. From 1900 the whole country. Measured
  // 2026-10-22, records per state in each collection: a state left out for
  // lost schedules holds 0-1,128 (1790-1820); a state listed holds over 1,000,
  // except an area the index files under its parent territory (1810
  // Monongalia, now West Virginia, is 2,638 records under Virginia; 1860
  // Colorado's Arapahoe 34,114 under Kansas). Arizona and Nevada wait for 1870:
  // their 1860 filing could not be confirmed. A state left out as not yet
  // enumerated can still hold a few thousand records (California 1840: 5,009);
  // leaving it out can only miss a gap.
  federal(1790, "1803959", US_1790),
  federal(1800, "1804228", US_1800),
  federal(1810, "1803765", US_1810),
  federal(1820, "1803955", US_1820),
  federal(1830, "1803958", US_1830),
  federal(1840, "1786457", US_1840),
  federal(1850, "1401638", US_1850),
  federal(1860, "1473181", US_1860),
  federal(1870, "1438024", US_1870),
  federal(1880, "1417683", US_1880),
  federal(1900, "1325221", ["United States"]),
  federal(1910, "1727033", ["United States"]),
  federal(1920, "1488411", ["United States"]),
  federal(1930, "1810731", ["United States"]),
  federal(1940, "2000219", ["United States"]),
  federal(1950, "4464515", ["United States"]),

  // US state censuses. No row: Alabama 1855 and 1866; California 1852 (188,578
  // records, 62% or 71% of the state's two published totals, 303,808 and
  // 264,435); Michigan 1894; New Jersey 1855 and 1865; New Mexico 1885; New York
  // 1865, 1875 and 1892 (FamilySearch's collection pages list 13, 12 and 20
  // counties missing); Wisconsin 1865 (FamilySearch wiki: 6 counties only).
  census(1885, "Colorado", state("Colorado"), "1807096"), // 234k records
  census(1885, "Florida", state("Florida"), "1457854"), // 309k records
  census(1935, "Florida", state("Florida"), "1457856"), // 1.60m records
  census(1945, "Florida", state("Florida"), "1457855"), // 2.25m records
  census(1855, "Illinois", state("Illinois"), "1803969", true), // heads only; 241k records
  census(1865, "Illinois", state("Illinois"), "1803971", true), // heads only; 380k records
  census(1885, "Iowa", state("Iowa"), "1803643"), // 1.74m records
  census(1895, "Iowa", state("Iowa"), "1803957"), // 2.11m records
  census(1905, "Iowa", state("Iowa"), "2126961"), // 2.18m records
  census(1915, "Iowa", state("Iowa"), "2240483"), // 2.57m records
  census(1925, "Iowa", state("Iowa"), "2224537"), // 2.49m records
  census(1865, "Kansas", state("Kansas"), "1824715"), // 150k records
  census(1875, "Kansas", state("Kansas"), "1825178"), // 619k records
  census(1885, "Kansas", state("Kansas"), "1825188"), // 1.40m records
  census(1895, "Kansas", state("Kansas"), "1825193"), // 1.36m records
  census(1905, "Kansas", state("Kansas"), "2659394"), // 1.55m records
  census(1915, "Kansas", state("Kansas"), "2640442"), // 1.66m records
  census(1925, "Kansas", state("Kansas"), "2659395"), // 1.88m records
  census(1855, "Massachusetts", state("Massachusetts"), "1459985"), // 1.20m records
  census(1865, "Massachusetts", state("Massachusetts"), "1410399"), // 1.35m records
  census(1857, "Minnesota", state("Minnesota", "Minnesota Territory, United States"), "1503055"), // 157k records
  census(1865, "Minnesota", state("Minnesota"), "1503054"), // 247k records
  census(1875, "Minnesota", state("Minnesota"), "1503053"), // 613k records
  census(1885, "Minnesota", state("Minnesota"), "1503044"), // 1.13m records
  census(1895, "Minnesota", state("Minnesota"), "1503031"), // 1.57m records
  census(1905, "Minnesota", state("Minnesota"), "1503056"), // 1.97m records
  census(1885, "Nebraska", state("Nebraska"), "1810728"), // 747k records
  census(1885, "New Jersey", state("New Jersey"), "1803972"), // 1.29m records
  census(1895, "New Jersey", state("New Jersey"), "2659407"), // 1.48m records
  census(1905, "New Jersey", state("New Jersey"), "1928107"), // 2.15m records
  census(1915, "New Jersey", state("New Jersey"), "2061544"), // 2.79m records
  census(1855, "New York", state("New York"), "1937366"), // 2.79m records; 81% of 3,426,212 (1855 census report)
  census(1905, "New York", state("New York"), "1463113"), // 7.55m records
  census(1915, "New York", state("New York"), "1937454"), // 9.74m records
  census(1925, "New York", state("New York"), "1937489"), // 11.1m records
  census(1915, "North Dakota", state("North Dakota"), "2346284"), // 619k records
  census(1925, "North Dakota", state("North Dakota"), "2351024"), // 679k records
  census(1885, "Rhode Island", state("Rhode Island"), "1794115"), // 322k records
  census(1905, "Rhode Island", state("Rhode Island"), "1542866"), // 474k records
  census(1915, "Rhode Island", state("Rhode Island"), "1532188"), // 541k records
  census(1925, "Rhode Island", state("Rhode Island"), "1532195"), // 684k records
  census(1935, "Rhode Island", state("Rhode Island"), "1529126"), // 691k records
  census(1905, "South Dakota", state("South Dakota"), "1477737"), // 473k records
  census(1915, "South Dakota", state("South Dakota"), "1476041"), // 614k records
  census(1925, "South Dakota", state("South Dakota"), "1476077"), // 705k records
  census(1935, "South Dakota", state("South Dakota"), "1614831"), // 673k records
  census(1945, "South Dakota", state("South Dakota"), "1747589"), // 570k records
  census(1855, "Wisconsin", state("Wisconsin"), "1443825", true), // heads only; 133k records
  census(1875, "Wisconsin", state("Wisconsin"), "1443778", true), // heads only; 297k records
  census(1885, "Wisconsin", state("Wisconsin"), "1443713", true), // heads only; 407k records
  census(1895, "Wisconsin", state("Wisconsin"), "1443712", true), // heads only; 495k records
  census(1905, "Wisconsin", state("Wisconsin"), "1443899"), // 2.23m records

  // Canada. No row: Lower and Upper Canada 1825-1842; Nova Scotia and Prince
  // Edward Island 1861; Canada 1931 (2,466,494 records, 24% of 10,376,379);
  // Newfoundland 1921 (194,365 records, 74% of 263,033).
  census(1851, "Canada", [...ONTARIO, ...QUEBEC, ...NEW_BRUNSWICK, ...NOVA_SCOTIA], "1325192"), // 2.20m records
  census(1861, "New Brunswick", NEW_BRUNSWICK, "1325208"), // 200k records; 79% of 252,047 (1867 Canada Year Book)
  census(1861, "Ontario", ONTARIO, "1460164"), // 1.71m records
  census(1861, "Quebec", QUEBEC, "1460173"), // 1.09m records
  census(1871, "Canada", [...ONTARIO, ...QUEBEC, ...NEW_BRUNSWICK, ...NOVA_SCOTIA], "1551612"), // 3.52m records
  census(1881, "Canada", CANADA_1881, "1804541"), // 4.28m records
  census(1891, "Canada", CANADA_1881, "1583536"), // 4.79m records
  census(1901, "Canada", CANADA_1901, "1584557"), // 5.34m records
  census(1906, "Canada", PRAIRIES, "1584925"), // Northwest Provinces; 802k records
  census(1911, "Canada", CANADA_1901, "2143998"), // 7.25m records
  census(1916, "Canada", PRAIRIES, "1529118"), // Prairie Provinces; 1.81m records
  census(1921, "Canada", CANADA_1901, "5000285"), // 8.80m records
  census(1926, "Canada", PRAIRIES, "3005862"), // Prairie Provinces; 2.08m records
  census(1935, "Newfoundland", NEWFOUNDLAND, "2246711"), // 296k records
  census(1945, "Newfoundland", NEWFOUNDLAND, "2246699"), // 294k records

  // Mexico and South America.
  census(1930, "Mexico", ["Mexico"], "1307314"), // 12.8m records; 77% of 16,552,722 (INEGI)
  census(1869, "Argentina", ["Argentina"], "1462401"), // 1.79m records
  census(1895, "Argentina", ["Argentina"], "1410078"), // 4.28m records

  // Britain and Ireland. No row: England and Wales 1851 (1,569,726 records, 9% of
  // 17,927,609). Ireland 1821-1851 are fragments.
  census(1841, "England and Wales", ENGLAND_AND_WALES, "1493745"), // 15.8m records
  census(1861, "England and Wales", ENGLAND_AND_WALES, "1493747"), // 19.6m records
  census(1871, "England and Wales", ENGLAND_AND_WALES, "1538354"), // 22.9m records
  census(1881, "England and Wales", ENGLAND_AND_WALES, "2562194"), // 26.1m records
  census(1891, "England and Wales", ENGLAND_AND_WALES, "1865747"), // 29.0m records
  census(1901, "England and Wales", ENGLAND_AND_WALES, "1888129"), // 34.1m records
  census(1911, "England and Wales", ENGLAND_AND_WALES, "1921547"), // 36.4m records
  census(1921, "England and Wales", ENGLAND_AND_WALES, "5000564"), // 38.4m records
  census(1841, "Scotland", SCOTLAND, "2016000"), // 2.63m records
  census(1851, "Scotland", SCOTLAND, "2028673"), // 2.91m records
  census(1861, "Scotland", SCOTLAND, "2028677"), // 3.01m records
  census(1871, "Scotland", SCOTLAND, "2028678"), // 3.35m records
  census(1881, "Scotland", SCOTLAND, "2046756"), // 3.72m records
  census(1891, "Scotland", SCOTLAND, "2046943"), // 4.02m records
  census(1901, "Scotland", SCOTLAND, "3212239"), // 4.44m records
  census(1901, "Ireland", IRELAND, "1626180"), // 4.38m records
  census(1911, "Ireland", IRELAND, "2854327"), // 4.39m records

  // Scandinavia. No row: Denmark 1835, 1911 and 1921; Norway 1870 and 1875.
  census(1787, "Denmark", ["Denmark"], "2790466"), // 843k records
  census(1840, "Denmark", ["Denmark"], "2778651"), // 1.61m records
  census(1845, "Denmark", ["Denmark"], "2778652"), // 1.67m records
  census(1850, "Denmark", ["Denmark"], "2778653"), // 1.30m records
  census(1855, "Denmark", ["Denmark"], "2778654"), // 1.73m records
  census(1860, "Denmark", ["Denmark"], "2778655"), // 1.75m records
  census(1870, "Denmark", ["Denmark"], "2778656"), // 1.76m records
  census(1880, "Denmark", ["Denmark"], "2778657"), // 1.95m records
  census(1890, "Denmark", ["Denmark"], "2800928"), // 2.14m records
  census(1901, "Denmark", ["Denmark"], "2800929"), // 2.33m records
  census(1906, "Denmark", ["Denmark"], "2800931"), // 2.53m records
  census(1801, "Norway", ["Norway"], "3733603"), // 879k records
  census(1865, "Norway", ["Norway"], "3756102"), // 1.69m records
  census(1891, "Norway", ["Norway"], "4067726"), // 2.73m records
  census(1900, "Norway", ["Norway"], "3744863"), // 2.26m records
  census(1835, "Iceland", ["Iceland"], "4380200"), // 76k records
  census(1860, "Iceland", ["Iceland"], "4460200"), // 66k records

  // Continental Europe. No row: Mecklenburg-Schwerin 1890; Fribourg 1818 and
  // 1842; Ticino 1808 and 1837; and these départements: Calvados, Eure-et-Loir,
  // Seine-Saint-Denis, Hautes-Alpes 1872, Côtes-d'Armor 1891, Hérault, Nord.
  // Range-titled collections give no row.
  census(1867, "Mecklenburg-Schwerin", MECKLENBURG_SCHWERIN, "1883733"), // 520k records
  census(1901, "Mecklenburg-Schwerin", MECKLENBURG_SCHWERIN, "1607939"), // 1.25m records
  census(1811, "Fribourg", ["Fribourg, Switzerland"], "2091721"), // 63k records
  census(1834, "Fribourg", ["Fribourg, Switzerland"], "2142772"), // 89k records
  census(1850, "Fribourg", ["Fribourg, Switzerland"], "2142776"), // 101k records
  census(1880, "Fribourg", ["Fribourg, Switzerland"], "2142779"), // 134k records
  census(1865, "San Marino", ["San Marino"], "5000726"), // 38k records across the four
  census(1874, "San Marino", ["San Marino"], "5000726"),
  census(1899, "San Marino", ["San Marino"], "5000726"),
  census(1947, "San Marino", ["San Marino"], "5000726"),
  census(1836, "Dordogne", france("Dordogne"), "2821307"), // 489k records
  census(1856, "Dordogne", france("Dordogne"), "2718581"), // 531k records
  census(1876, "Dordogne", france("Dordogne"), "2541227"), // 497k records
  census(1891, "Dordogne", france("Dordogne"), "2821303"), // 471k records
  census(1836, "Hautes-Alpes", france("Hautes-Alpes"), "2820772"), // 265k records
  census(1856, "Hautes-Alpes", france("Hautes-Alpes"), "2820771"), // 261k records
  census(1876, "Hautes-Alpes", france("Hautes-Alpes"), "2819930"), // 97k records; FamilySearch: "a complete indexing"
  census(1896, "Hautes-Alpes", france("Hautes-Alpes"), "2820765"), // 216k records
  census(1836, "Marne", france("Marne"), "4317030"), // 302k records
  census(1856, "Marne", france("Marne"), "3225464"), // 362k records
  census(1876, "Marne", france("Marne"), "4316511"), // 412k records
  census(1896, "Marne", france("Marne"), "4317027"), // 416k records
  census(1836, "Saône-et-Loire", france("Saône-et-Loire"), "2721038"), // 546k records
  census(1856, "Saône-et-Loire", france("Saône-et-Loire"), "2721037"), // 578k records
  census(1876, "Saône-et-Loire", france("Saône-et-Loire"), "2559965"), // 693k records
  census(1896, "Saône-et-Loire", france("Saône-et-Loire"), "2786646"), // 623k records
  census(1856, "Vienne", france("Vienne"), "2849254"), // 364k records
  census(1876, "Vienne", france("Vienne"), "2858066"), // 297k records
  census(1896, "Vienne", france("Vienne"), "2858067"), // 342k records
  census(1876, "Côtes-d'Armor", france("Côtes-d'Armor", "Côtes-du-Nord"), "2748869"), // 618k records
  census(1906, "Côtes-d'Armor", france("Côtes-d'Armor", "Côtes-du-Nord"), "2748872"), // 470k records; 77% of 611,506 (1911 Britannica)
  census(1896, "Haute-Garonne", france("Haute-Garonne"), "5000057"), // 405k records
];

/** A place's comma segments, trimmed and lowercased. */
export function segments(place: string): string[] {
  return place
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== "");
}

/** One of the row's forms is a whole-segment suffix of `standardPlace`:
 *  "Ohio, United States" covers "Columbus, Franklin, Ohio, United States";
 *  "York, United States" never covers "New York, United States". */
export function placeMatches(forms: readonly string[], standardPlace: string): boolean {
  const place = segments(standardPlace);
  return forms.some((form) => {
    const want = segments(form);
    if (want.length === 0 || want.length > place.length) return false;
    const tail = place.slice(place.length - want.length);
    return want.every((seg, i) => seg === tail[i]);
  });
}

export function rowCovers(row: CensusRow, standardPlace: string): boolean {
  return placeMatches(row.covers, standardPlace);
}

/** The rows of `year` that cover both places — a census expected between two
 *  events only when one enumeration would have found the person at either. */
export function rowsForInterval(
  placeA: string,
  placeB: string,
  year: number,
  table: readonly CensusRow[] = CENSUS_TABLE,
): CensusRow[] {
  return table.filter((r) => r.year === year && rowCovers(r, placeA) && rowCovers(r, placeB));
}

/** Some row of the table, any year, covers the place. */
export function isCoveredPlace(standardPlace: string, table: readonly CensusRow[] = CENSUS_TABLE): boolean {
  return table.some((r) => rowCovers(r, standardPlace));
}

/** Some row covers a place whose last segment is `country`, so the table lists
 *  that country even where it covers only part of it. */
export function countryHasRows(country: string, table: readonly CensusRow[] = CENSUS_TABLE): boolean {
  const want = country.trim().toLowerCase();
  return table.some((r) => r.covers.some((c) => segments(c).pop() === want));
}

/** Every row that names a fragment's year for a place the fragment covers. */
export function fragmentViolations(
  table: readonly CensusRow[] = CENSUS_TABLE,
  fragments: readonly CensusFragment[] = CENSUS_FRAGMENTS,
): string[] {
  const out: string[] = [];
  for (const row of table) {
    for (const f of fragments) {
      // Either side may be the wider area: a row for Dublin inside the Irish
      // 1841 fragment, or a row for Australia containing the NSW 1841 one.
      const overlaps = row.covers.some(
        (c) => placeMatches(f.covers, c) || f.covers.some((fc) => placeMatches([c], fc)),
      );
      if (f.year === row.year && overlaps) {
        out.push(`${row.year} ${row.label} (collection ${row.collectionId}) is a fragment census`);
        break;
      }
    }
  }
  return out;
}

/** The years a collection title names, or null when it names a range. "Census,
 *  1872 and 1886" and "Census, 1865, 1874, 1899, 1947" list years; "Census,
 *  1837-1936" is a range. */
export function titleYears(title: string): number[] | null {
  if (/\b1[0-9]{3}\s*[-–]\s*1[0-9]{3}\b/.test(title)) return null;
  const years = [...title.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)].map((m) => Number(m[1]));
  return years.length > 0 ? [...new Set(years)] : null;
}

export interface CatalogEntry {
  id: string;
  title: string;
  recordCount: number;
}

/** What is wrong with one row against its catalog entry; empty when it holds. */
export function checkRow(row: CensusRow, entry: CatalogEntry | undefined): string[] {
  const where = `${row.year} ${row.label} (collection ${row.collectionId})`;
  if (!entry) return [`${where}: no such collection in the catalog`];
  const problems: string[] = [];
  if (!(entry.recordCount > 0)) problems.push(`${where}: '${entry.title}' indexes no records`);
  const years = titleYears(entry.title);
  if (years === null) problems.push(`${where}: '${entry.title}' names a range or no year`);
  else if (!years.includes(row.year)) problems.push(`${where}: '${entry.title}' does not name ${row.year}`);
  if (row.covers.length === 0) problems.push(`${where}: covers nothing`);
  return problems;
}
