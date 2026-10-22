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

  // US state censuses (indexed records : population). Dropped as partial:
  // Alabama 1855/1866, California 1852 (74%), Illinois none, Michigan 1894,
  // New Jersey 1855/1865, New Mexico 1885, New York 1865/1875/1892 (58-69%),
  // Wisconsin 1865.
  census(1885, "Colorado", state("Colorado"), "1807096"), // 234k : ~240k
  census(1885, "Florida", state("Florida"), "1457854"), // 309k : 340k
  census(1935, "Florida", state("Florida"), "1457856"), // 1.60m : 1.6m
  census(1945, "Florida", state("Florida"), "1457855"), // 2.25m : 2.25m
  census(1855, "Illinois", state("Illinois"), "1803969", true), // heads only; 241k : ~236k households
  census(1865, "Illinois", state("Illinois"), "1803971", true), // heads only; 380k : ~390k households
  census(1885, "Iowa", state("Iowa"), "1803643"), // 1.74m : 1.75m
  census(1895, "Iowa", state("Iowa"), "1803957"), // 2.11m : 2.06m
  census(1905, "Iowa", state("Iowa"), "2126961"), // 2.18m : 2.21m
  census(1915, "Iowa", state("Iowa"), "2240483"), // 2.57m : 2.36m
  census(1925, "Iowa", state("Iowa"), "2224537"), // 2.49m : 2.42m
  census(1865, "Kansas", state("Kansas"), "1824715"), // 150k : 140k
  census(1875, "Kansas", state("Kansas"), "1825178"), // 619k : 531k
  census(1885, "Kansas", state("Kansas"), "1825188"), // 1.40m : 1.27m
  census(1895, "Kansas", state("Kansas"), "1825193"), // 1.36m : 1.33m
  census(1905, "Kansas", state("Kansas"), "2659394"), // 1.55m : 1.54m
  census(1915, "Kansas", state("Kansas"), "2640442"), // 1.66m : 1.69m
  census(1925, "Kansas", state("Kansas"), "2659395"), // 1.88m : 1.81m
  census(1855, "Massachusetts", state("Massachusetts"), "1459985"), // 1.20m : 1.13m
  census(1865, "Massachusetts", state("Massachusetts"), "1410399"), // 1.35m : 1.27m
  census(1857, "Minnesota", state("Minnesota", "Minnesota Territory, United States"), "1503055"), // 157k : 150k
  census(1865, "Minnesota", state("Minnesota"), "1503054"), // 247k : 250k
  census(1875, "Minnesota", state("Minnesota"), "1503053"), // 613k : 597k
  census(1885, "Minnesota", state("Minnesota"), "1503044"), // 1.13m : 1.12m
  census(1895, "Minnesota", state("Minnesota"), "1503031"), // 1.57m : 1.57m
  census(1905, "Minnesota", state("Minnesota"), "1503056"), // 1.97m : 1.98m
  census(1885, "Nebraska", state("Nebraska"), "1810728"), // 747k : 740k
  census(1885, "New Jersey", state("New Jersey"), "1803972"), // 1.29m : 1.28m
  census(1895, "New Jersey", state("New Jersey"), "2659407"), // 1.48m : 1.67m
  census(1905, "New Jersey", state("New Jersey"), "1928107"), // 2.15m : 2.14m
  census(1915, "New Jersey", state("New Jersey"), "2061544"), // 2.79m : 2.84m
  census(1855, "New York", state("New York"), "1937366"), // 2.79m : 3.47m
  census(1905, "New York", state("New York"), "1463113"), // 7.55m : 8.07m
  census(1915, "New York", state("New York"), "1937454"), // 9.74m : 9.69m
  census(1925, "New York", state("New York"), "1937489"), // 11.1m : 11.2m
  census(1915, "North Dakota", state("North Dakota"), "2346284"), // 619k : 637k
  census(1925, "North Dakota", state("North Dakota"), "2351024"), // 679k : 640k
  census(1885, "Rhode Island", state("Rhode Island"), "1794115"), // 322k : 304k
  census(1905, "Rhode Island", state("Rhode Island"), "1542866"), // 474k : 480k
  census(1915, "Rhode Island", state("Rhode Island"), "1532188"), // 541k : 591k
  census(1925, "Rhode Island", state("Rhode Island"), "1532195"), // 684k : 680k
  census(1935, "Rhode Island", state("Rhode Island"), "1529126"), // 691k : 680k
  census(1905, "South Dakota", state("South Dakota"), "1477737"), // 473k : 455k
  census(1915, "South Dakota", state("South Dakota"), "1476041"), // 614k : 583k
  census(1925, "South Dakota", state("South Dakota"), "1476077"), // 705k : 681k
  census(1935, "South Dakota", state("South Dakota"), "1614831"), // 673k : 690k
  census(1945, "South Dakota", state("South Dakota"), "1747589"), // 570k : 590k
  census(1855, "Wisconsin", state("Wisconsin"), "1443825", true), // heads only; 133k : ~110k households
  census(1875, "Wisconsin", state("Wisconsin"), "1443778", true), // heads only; 297k : ~250k households
  census(1885, "Wisconsin", state("Wisconsin"), "1443713", true), // heads only; 407k : ~310k households
  census(1895, "Wisconsin", state("Wisconsin"), "1443712", true), // heads only; 495k : ~390k households
  census(1905, "Wisconsin", state("Wisconsin"), "1443899"), // 2.23m : 2.23m

  // Canada. Dropped as partial: Lower and Upper Canada 1825-1842, Nova Scotia
  // and Prince Edward Island 1861, Canada 1931 (24%), Newfoundland 1921 (74%).
  census(1851, "Canada", [...ONTARIO, ...QUEBEC, ...NEW_BRUNSWICK, ...NOVA_SCOTIA], "1325192"), // 2.20m : 2.4m
  census(1861, "New Brunswick", NEW_BRUNSWICK, "1325208"), // 200k : 252k
  census(1861, "Ontario", ONTARIO, "1460164"), // 1.71m : 1.40m
  census(1861, "Quebec", QUEBEC, "1460173"), // 1.09m : 1.11m
  census(1871, "Canada", [...ONTARIO, ...QUEBEC, ...NEW_BRUNSWICK, ...NOVA_SCOTIA], "1551612"), // 3.52m : 3.69m
  census(1881, "Canada", CANADA_1881, "1804541"), // 4.28m : 4.32m
  census(1891, "Canada", CANADA_1881, "1583536"), // 4.79m : 4.83m
  census(1901, "Canada", CANADA_1901, "1584557"), // 5.34m : 5.37m
  census(1906, "Canada", PRAIRIES, "1584925"), // Northwest Provinces; 802k : 808k
  census(1911, "Canada", CANADA_1901, "2143998"), // 7.25m : 7.21m
  census(1916, "Canada", PRAIRIES, "1529118"), // Prairie Provinces; 1.81m : 1.70m
  census(1921, "Canada", CANADA_1901, "5000285"), // 8.80m : 8.79m
  census(1926, "Canada", PRAIRIES, "3005862"), // Prairie Provinces; 2.08m : 2.07m
  census(1935, "Newfoundland", NEWFOUNDLAND, "2246711"), // 296k : 290k
  census(1945, "Newfoundland", NEWFOUNDLAND, "2246699"), // 294k : 322k

  // Mexico and South America.
  census(1930, "Mexico", ["Mexico"], "1307314"), // 12.8m : 16.6m
  census(1869, "Argentina", ["Argentina"], "1462401"), // 1.79m : 1.83m
  census(1895, "Argentina", ["Argentina"], "1410078"), // 4.28m : 3.95m

  // Britain and Ireland. Dropped as partial: England and Wales 1851 (9%).
  // Ireland 1821-1851 are fragments.
  census(1841, "England and Wales", ENGLAND_AND_WALES, "1493745"), // 15.8m : 15.9m
  census(1861, "England and Wales", ENGLAND_AND_WALES, "1493747"), // 19.6m : 20.1m
  census(1871, "England and Wales", ENGLAND_AND_WALES, "1538354"), // 22.9m : 22.7m
  census(1881, "England and Wales", ENGLAND_AND_WALES, "2562194"), // 26.1m : 26.0m
  census(1891, "England and Wales", ENGLAND_AND_WALES, "1865747"), // 29.0m : 29.0m
  census(1901, "England and Wales", ENGLAND_AND_WALES, "1888129"), // 34.1m : 32.5m
  census(1911, "England and Wales", ENGLAND_AND_WALES, "1921547"), // 36.4m : 36.1m
  census(1921, "England and Wales", ENGLAND_AND_WALES, "5000564"), // 38.4m : 37.9m
  census(1841, "Scotland", SCOTLAND, "2016000"), // 2.63m : 2.62m
  census(1851, "Scotland", SCOTLAND, "2028673"), // 2.91m : 2.89m
  census(1861, "Scotland", SCOTLAND, "2028677"), // 3.01m : 3.06m
  census(1871, "Scotland", SCOTLAND, "2028678"), // 3.35m : 3.36m
  census(1881, "Scotland", SCOTLAND, "2046756"), // 3.72m : 3.74m
  census(1891, "Scotland", SCOTLAND, "2046943"), // 4.02m : 4.03m
  census(1901, "Scotland", SCOTLAND, "3212239"), // 4.44m : 4.47m
  census(1901, "Ireland", IRELAND, "1626180"), // 4.38m : 4.46m
  census(1911, "Ireland", IRELAND, "2854327"), // 4.39m : 4.39m

  // Scandinavia. Dropped as partial: Denmark 1835, 1911 and 1921; Norway 1870
  // (towns only) and 1875.
  census(1787, "Denmark", ["Denmark"], "2790466"), // 843k : 840k
  census(1840, "Denmark", ["Denmark"], "2778651"), // 1.61m : 1.29m
  census(1845, "Denmark", ["Denmark"], "2778652"), // 1.67m : 1.35m
  census(1850, "Denmark", ["Denmark"], "2778653"), // 1.30m : 1.41m
  census(1855, "Denmark", ["Denmark"], "2778654"), // 1.73m : 1.50m
  census(1860, "Denmark", ["Denmark"], "2778655"), // 1.75m : 1.60m
  census(1870, "Denmark", ["Denmark"], "2778656"), // 1.76m : 1.78m
  census(1880, "Denmark", ["Denmark"], "2778657"), // 1.95m : 1.97m
  census(1890, "Denmark", ["Denmark"], "2800928"), // 2.14m : 2.17m
  census(1901, "Denmark", ["Denmark"], "2800929"), // 2.33m : 2.45m
  census(1906, "Denmark", ["Denmark"], "2800931"), // 2.53m : 2.59m
  census(1801, "Norway", ["Norway"], "3733603"), // 879k : 883k
  census(1865, "Norway", ["Norway"], "3756102"), // 1.69m : 1.70m
  census(1891, "Norway", ["Norway"], "4067726"), // 2.73m : 2.00m
  census(1900, "Norway", ["Norway"], "3744863"), // 2.26m : 2.24m
  census(1835, "Iceland", ["Iceland"], "4380200"), // 76k : 56k
  census(1860, "Iceland", ["Iceland"], "4460200"), // 66k : 67k

  // Continental Europe. Dropped as partial: Mecklenburg-Schwerin 1890, Fribourg
  // 1818 and 1842, Ticino 1808 and 1837, and these départements: Calvados,
  // Eure-et-Loir, Seine-Saint-Denis, Hautes-Alpes 1872, Côtes-d'Armor 1891,
  // Hérault, Nord. Range-titled collections give no row.
  census(1867, "Mecklenburg-Schwerin", MECKLENBURG_SCHWERIN, "1883733"), // 520k : 560k
  census(1901, "Mecklenburg-Schwerin", MECKLENBURG_SCHWERIN, "1607939"), // 1.25m : 607k
  census(1811, "Fribourg", ["Fribourg, Switzerland"], "2091721"), // 63k : ~70k
  census(1834, "Fribourg", ["Fribourg, Switzerland"], "2142772"), // 89k : ~91k
  census(1850, "Fribourg", ["Fribourg, Switzerland"], "2142776"), // 101k : 100k
  census(1880, "Fribourg", ["Fribourg, Switzerland"], "2142779"), // 134k : 115k
  census(1865, "San Marino", ["San Marino"], "5000726"), // 38k across the four : ~38k
  census(1874, "San Marino", ["San Marino"], "5000726"),
  census(1899, "San Marino", ["San Marino"], "5000726"),
  census(1947, "San Marino", ["San Marino"], "5000726"),
  census(1836, "Dordogne", france("Dordogne"), "2821307"), // 489k : 487k
  census(1856, "Dordogne", france("Dordogne"), "2718581"), // 531k : 505k
  census(1876, "Dordogne", france("Dordogne"), "2541227"), // 497k : 490k
  census(1891, "Dordogne", france("Dordogne"), "2821303"), // 471k : 478k
  census(1836, "Hautes-Alpes", france("Hautes-Alpes"), "2820772"), // 265k : 130k
  census(1856, "Hautes-Alpes", france("Hautes-Alpes"), "2820771"), // 261k : 129k
  census(1876, "Hautes-Alpes", france("Hautes-Alpes"), "2819930"), // 97k : 119k
  census(1896, "Hautes-Alpes", france("Hautes-Alpes"), "2820765"), // 216k : 113k
  census(1836, "Marne", france("Marne"), "4317030"), // 302k : 350k
  census(1856, "Marne", france("Marne"), "3225464"), // 362k : 373k
  census(1876, "Marne", france("Marne"), "4316511"), // 412k : 407k
  census(1896, "Marne", france("Marne"), "4317027"), // 416k : 434k
  census(1836, "Saône-et-Loire", france("Saône-et-Loire"), "2721038"), // 546k : 524k
  census(1856, "Saône-et-Loire", france("Saône-et-Loire"), "2721037"), // 578k : 575k
  census(1876, "Saône-et-Loire", france("Saône-et-Loire"), "2559965"), // 693k : 614k
  census(1896, "Saône-et-Loire", france("Saône-et-Loire"), "2786646"), // 623k : 620k
  census(1856, "Vienne", france("Vienne"), "2849254"), // 364k : 322k
  census(1876, "Vienne", france("Vienne"), "2858066"), // 297k : 330k
  census(1896, "Vienne", france("Vienne"), "2858067"), // 342k : 338k
  census(1876, "Côtes-d'Armor", france("Côtes-d'Armor", "Côtes-du-Nord"), "2748869"), // 618k : 622k
  census(1906, "Côtes-d'Armor", france("Côtes-d'Armor", "Côtes-du-Nord"), "2748872"), // 470k : 611k
  census(1896, "Haute-Garonne", france("Haute-Garonne"), "5000057"), // 405k : 454k
];

function segments(place: string): string[] {
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
