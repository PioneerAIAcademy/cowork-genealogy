import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// The rule and the resolver run as written. Only the Places API fetchers are
// replaced, by what they returned for FamilySearch's answers of 2026-10-29
// (tests/fixtures/place-verdict/places-api.json). A call with no recorded
// answer fails the test.
vi.mock("../../src/utils/place-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-api.js")>();
  return { ...actual, searchPlace: vi.fn(), getPlaceById: vi.fn(), getPlaceReps: vi.fn(), getPlaceCandidateNames: vi.fn() };
});

import { judgeSupplied, keptSupplied, placeAnswer } from "../../src/utils/place-verdict.js";
import { getPlaceById, getPlaceCandidateNames, getPlaceReps, sanitizeForNameQuery, searchPlace } from "../../src/utils/place-api.js";
import {
  __clearPlaceResolverCachesForTests,
  countryContradiction,
  familySearchPlace,
  resolveStandardPlace,
} from "../../src/utils/place-resolver.js";

const RECORDED = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "place-verdict", "places-api.json"), "utf8"),
);
const missing: string[] = [];
const recorded = (table: Record<string, unknown>, key: string) => {
  if (!Object.hasOwn(table, key)) {
    missing.push(key);
    throw new Error(`no recorded answer for ${key}`);
  }
  return table[key];
};

beforeEach(() => {
  __clearPlaceResolverCachesForTests();
  missing.length = 0;
  vi.mocked(searchPlace).mockImplementation(async (name: string, opts: { date?: number; fuzzy?: boolean } = {}) =>
    recorded(RECORDED.search, `${sanitizeForNameQuery(name)}|${opts.date ?? ""}|${opts.fuzzy ? "~" : ""}`) as any,
  );
  vi.mocked(getPlaceById).mockImplementation(async (id: string) => recorded(RECORDED.description, id) as any);
  vi.mocked(getPlaceReps).mockImplementation(async (pid: string) => recorded(RECORDED.reps, pid) as any);
  vi.mocked(getPlaceCandidateNames).mockImplementation(async (pid: string) => recorded({}, `names of ${pid}`) as any);
});
afterEach(() => {
  expect(missing).toEqual([]);
});

/** What tree_edit stores for a supplied value on a fact citing no record. */
const judged = (place: string, supplied: string) =>
  judgeSupplied(place, supplied, (text) => placeAnswer(text, [], () => resolveStandardPlace(text)));

const KEPT_WHEN =
  "A supplied standard_place is kept when it is a FamilySearch standard place (a place_search result) for the fact's own place.";

describe("a supplied standard_place must lie in the state, province and country its place text names", () => {
  it.each([
    // The text names a country the alias table knows; FamilySearch puts the
    // value in one it does not carry, which its jurisdiction chain reads.
    ["Thornton, Lancashire, England", "Thornton, Natal, South Africa", "Thornton, Lancashire, England"],
    ["March, Cambridgeshire, England", "March, Transvaal, South Africa", "March, Cambridgeshire, England, United Kingdom"],
    ["Troup, Georgia, United States", "Troup, Central, Sri Lanka", "Troup, Georgia, United States"],
    ["Dundee, Forfarshire, Scotland", "Dundee, Westmoreland, Jamaica", "Dundee, Forfarshire, Scotland, United Kingdom"],
    // A US state the value does not name puts the text in the United States.
    ["Worth, Illinois", "Wœrth, Bas-Rhin, France", "Worth, Cook, Illinois, United States"],
    ["Lancaster, Lancaster, Pennsylvania", "Lancaster, Lancashire, England, United Kingdom", "Lancaster, Lancaster, Pennsylvania, United States"],
    // The United States alone, not Canada: these values name no province the
    // division table knows.
    ["Fort Smith, Sebastian, Arkansas", "Fort Smith, Fort Smith, Northwest Territories, Canada", "Fort Smith, Sebastian, Arkansas, United States"],
    ["Whitehorse, Dewey, South Dakota", "Whitehorse, Yukon, Canada", "Whitehorse, Dewey, South Dakota, United States"],
    ["Hay River, Dunn, Wisconsin", "Hay River, Fort Smith, Northwest Territories, Canada", "Hay River, Dunn, Wisconsin, United States"],
    ["Placentia, Orange, California", "Placentia, Newfoundland and Labrador, Canada", "Placentia, Orange, California, United States"],
    // Against the United States, a root FamilySearch ends is judged by the
    // country of today it lies in: England, Wales and Scotland end in 1801 (the
    // United Kingdom), Hamburg in 1871 (Germany), British Honduras in 1973 (Belize).
    ["Boston, Suffolk, Massachusetts", "Boston, Lincolnshire, England", "Boston, Suffolk, Massachusetts, United States"],
    ["Lancaster, Lancaster, Pennsylvania", "Lancaster, Lancashire, England", "Lancaster, Lancaster, Pennsylvania, United States"],
    ["Plymouth, Plymouth, Massachusetts", "Plymouth, Devon, England", "Plymouth, Plymouth, Massachusetts, United States"],
    ["Dover, Kent, Delaware", "Dover, Kent, England", "Dover, Kent, Delaware, United States"],
    ["Portsmouth, Rockingham, New Hampshire", "Portsmouth, Hampshire, England", "Portsmouth, Rockingham, New Hampshire, United States"],
    ["Bangor, Penobscot, Maine", "Bangor, Caernarfonshire, Wales", "Bangor, Penobscot, Maine, United States"],
    ["Aberdeen, Brown, South Dakota", "Aberdeen, Aberdeenshire, Scotland", "Aberdeen, Brown, South Dakota, United States"],
    ["Hamburg, Erie, New York", "Hamburg", "Hamburg, Erie, New York, United States"],
    ["Hamburg, Erie, New York, United States", "Hamburg", "Hamburg, Erie, New York, United States"],
    ["Placentia, Orange, California", "Placentia, Stann Creek, British Honduras", "Placentia, Orange, California, United States"],
    // A bare Georgia is the state (lead, 2026-08-27): the country itself is not
    // a place in it.
    ["Savannah, Chatham, Georgia", "Republic of Georgia", "Savannah, Chatham, Georgia, United States"],
    // Germany's text takes only the lands of its empire: neither South Africa
    // nor Namibia is one.
    ["Hamburg, Hamburg, Germany", "Hamburg, Amathole, Eastern Cape, South Africa", "Hamburg, Germany"],
    ["Hamburg, Deutschland", "Hamburg, Amathole, Eastern Cape, South Africa", "Hamburg, Germany"],
    ["Heidelberg, Baden, Germany", "Heidelberg, Garden Route, Western Cape, South Africa", "Heidelberg, Baden, Germany"],
    ["Berlin, Brandenburg, Preussen", "Berlin, Amathole, Eastern Cape, South Africa", "Berlin, Brandenburg, Prussia, Germany"],
    ["Marburg, Hessen-Nassau, Preussen", "Marburg, Natal, South Africa", "Marburg, Hesse-Nassau, Prussia, Germany"],
    [
      "Hermannsburg, Hannover, Germany",
      "Hermannsburg, Umzinyathi, KwaZulu-Natal, South Africa",
      "Hermannsburg, Celle, Hanover, Prussia, Germany",
    ],
    ["Grünau, Schlesien, Germany", "Grünau, Karasburg East, Karas, Namibia", "Grunau, Striegau, Silesia, Prussia, Germany"],
    ["Mariental, Braunschweig, Germany", "Mariental, Mariental Urban, Hardap, Namibia", "Mariental, Helmstedt, Brunswick, Germany"],
  ])("refuses %j's %j as in another country, and takes the lookup", async (place, supplied, lookup) => {
    expect(await keptSupplied(place, supplied)).toEqual({ why: "it lies in a different country than the place" });
    expect(await judged(place, supplied)).toEqual({
      standardPlace: lookup,
      warning:
        `standard_place '${supplied}' for '${place}' was replaced by '${lookup}', the engine's lookup: ` +
        `it lies in a different country than the place. ${KEPT_WHEN}`,
    });
  });

  it("judges by the chain's root, not the value's own dates", async () => {
    // FamilySearch ends this representation in 1980; South Africa goes on.
    expect(await keptSupplied("March, Cambridgeshire, England", "March, Cape Province, South Africa")).toEqual({
      why: "it lies in a different country than the place",
    });
  });

  it("judges a root FamilySearch ends by its country of today against Canada too", async () => {
    // England ends in 1801; Ontario is Canada's.
    expect(await keptSupplied("London, Middlesex, Ontario", "London, England")).toEqual({
      why: "it lies in a different country than the place",
    });
  });

  it.each([
    // Georgia's text, but another country than the Republic of Georgia.
    ["Athens, Clarke, Georgia", "Athens, Athens, Attica, Greece"],
    // Another state's text, one that names the United States itself, or the
    // state's code: only a bare "Georgia" takes the Republic of Georgia's places.
    ["Tbilisi, Montana", "Tbilisi, Republic of Georgia"],
    ["Tbilisi, Georgia, United States", "Tbilisi, Republic of Georgia"],
    ["Tbilisi, GA", "Tbilisi, Republic of Georgia"],
    ["Kutaisi, GA", "Kutaisi, Imereti, Republic of Georgia"],
    // An empire's text, and a same-named place in no land of that empire.
    ["Sarepta, Saratov, Russia", "Sarepta, Kuils River, Cape Town, Western Cape, South Africa"],
    ["Marburg, Steiermark, Österreich", "Marburg, Natal, South Africa"],
    ["Arad, Arad, Hungary", "`Arad, Southern, Israel"],
  ])("still refuses %j's %j as in another country", async (place, supplied) => {
    expect(await keptSupplied(place, supplied)).toEqual({ why: "it lies in a different country than the place" });
  });

  it.each([
    // Russia's lands as the empire ended, past those the keeps below pin.
    ["Reval, Estland, Russia", "Tallinn, Harjumaa, Estonia"],
    ["Minsk, Minsk, Russia", "Minsk, Belarus"],
    ["Kishinev, Bessarabia, Russia", "Chișinău, Moldova"],
    ["Tiflis, Tiflis, Russia", "Tbilisi, Republic of Georgia"],
    ["Aleksandropol, Erivan, Russia", "Gyumri, Shirak, Armenia"],
    ["Baku, Baku, Russia", "Baku, Azerbaijan"],
    ["Verny, Semirechye, Russia", "Almaty, Kazakhstan"],
    ["Pishpek, Semirechye, Russia", "Bishkek, Kyrgyzstan"],
    ["Khodzhent, Samarkand, Russia", "Khujand, Sughd, Tajikistan"],
    ["Askhabad, Transcaspia, Russia", "Ashgabat, Turkmenistan"],
    ["Tashkent, Syr-Darya, Russia", "Tashkent, Uzbekistan"],
    ["Kars, Kars, Russia", "Kars, Türkiye"],
    // Austria's.
    ["Kaschau, Ungarn, Österreich", "Košice, Slovakia"],
    ["Zara, Dalmatien, Österreich", "Zadar, Croatia"],
    ["Suczawa, Bukowina, Österreich", "Suceava, Romania"],
    ["Sarajevo, Bosnien, Österreich", "Sarajevo, Federation of Bosnia and Herzegovina, Bosnia-Herzegovina"],
    ["Neusatz, Batschka, Österreich", "Novi Sad, South Bačka, Serbia"],
    ["Cattaro, Dalmatien, Österreich", "Kotor, Montenegro"],
    // Hungary's.
    ["Újvidék, Bács-Bodrog, Hungary", "Novi Sad, South Bačka, Serbia"],
    ["Eszék, Verőce, Hungary", "Osijek, Osijek-Baranja, Croatia"],
    ["Ungvár, Ung, Hungary", "Užhorod, Zakarpattia, Ukraine"],
    ["Muraszombat, Vas, Hungary", "Murska Sobota, Slovenia"],
    // Germany's.
    ["Hultschin, Ratibor, Preussen", "Hlučín, Opava, Czechia"],
  ])("takes %j's %j, in a land of the empire the text names", async (place, value) => {
    const found = await familySearchPlace(value);
    if (!found) throw new Error(`FamilySearch has no place ${value}`);
    expect(await countryContradiction(place, found)).toBe(false);
    // The value lies in another country than one whose empire held none of it.
    expect(await countryContradiction("Uppsala, Sweden", found)).toBe(true);
  });

  it("reads no country from a state or province the value names itself", async () => {
    // Puerto Rico is no US state's country: FamilySearch's root is Puerto Rico.
    expect(await keptSupplied("San Juan, Puerto Rico", "San Juan, Puerto Rico")).toEqual({ kept: "San Juan, Puerto Rico" });
  });

  it("keeps the value when its chain cannot be read", async () => {
    vi.mocked(getPlaceById).mockRejectedValueOnce(new Error("FamilySearch API error: 503"));
    expect(await keptSupplied("Thornton, Lancashire, England", "Thornton, Natal, South Africa")).toEqual({
      kept: "Thornton, Natal, South Africa",
    });
  });

  it("reads the country from the chain, not from a part of the value the alias table knows", async () => {
    // Norway is the town and township in Maine; the text means the country.
    const supplied = "Norway, Norway, Oxford, Massachusetts, United States";
    expect(await keptSupplied("Norway, Norway", supplied)).toEqual({ why: "it lies in a different country than the place" });
    expect((await judged("Norway, Norway", supplied)).standardPlace).toBeNull();
  });

  it.each([
    ["Springfield, Hampden, Massachusetts", "Springfield, Sangamon, Illinois, United States", "Springfield, Hampden, Massachusetts, United States"],
    ["Springfield, Hampden, Massachusetts, United States", "Springfield, Sangamon, Illinois, United States", "Springfield, Hampden, Massachusetts, United States"],
    ["Hampden, Massachusetts", "Hampden, Penobscot, Maine, United States", "Hampden, Massachusetts, United States"],
    ["Portland, Cumberland, Maine", "Portland, Multnomah, Oregon, United States", "Portland, Cumberland, Maine, United States"],
    // The state of Washington is a state itself: its own name is its state.
    ["Washington, Washington, Pennsylvania", "Washington, United States", "Washington, Washington, Pennsylvania, United States"],
  ])("refuses %j's %j as in another state, and takes the lookup", async (place, supplied, lookup) => {
    expect(await keptSupplied(place, supplied)).toEqual({ why: "it names a different state or province than the place" });
    expect((await judged(place, supplied)).standardPlace).toBe(lookup);
  });

  it.each([
    // A former state is not judged: Czechoslovakia (to 1992) and Bohemia (to
    // 1918) lie in today's Czechia, once in the Austria the text names.
    ["Svitavy, Moravská Třebová, Morava, Rakousko", "Svitavy, Moravská Třebová, Moravia, Czechoslovakia"],
    ["Stašov, Polička, Čechy, Rakousko", "Dittersbach, Polička, Bohemia"],
    // The text names no country the alias table knows.
    ["Киевская губерния, Российская империя", "Kiev Governorate, Russian Empire"],
    ["Попружна, Таращанский, Киевская губерния, Российская империя", "Popruzhna, Tarashcha, Kiev Governorate, Russian Empire"],
    ["Iisalmi,Kuopio,Finland", "Iisalmen kaupunki, Kuopio, Finland"],
    ["iisalmi,Sonkajärvi,Kuopio,Finland", "Iisalmen kaupunki, Kuopio, Finland"],
    ["Evangelisch, Steinwenden, Pfalz, Bavaria", "Palatinate, Bavaria, Germany"],
    ["Bogotá, Santafé de Bogotá, Cundinamarca, Colombia", "Bogotá D. C., Cundinamarca, Colombia"],
    // Historic Ireland holds Northern Ireland.
    ["Armagh, Armagh, Ireland", "Armagh, Armagh, County Armagh, Northern Ireland, United Kingdom"],
    // A root FamilySearch ends that no country of today is mapped to is not
    // judged against the United States either.
    ["Boston, Suffolk, Massachusetts", "Massachusetts Bay Colony, British Colonial America"],
    // A Canadian province's text names Canada.
    ["St. John's, Newfoundland", "St. John's, Newfoundland and Labrador, Canada"],
    // An empire the text names held lands in today's countries.
    ["Helsingfors, Nyland, Russia", "Helsinki, Uusimaa, Finland"],
    ["Kovno, Kovno, Russia", "Kaunas, Kaunas, Lithuania"],
    ["Vilna, Vilna, Russia", "Vilnius, Vilnius, Lithuania"],
    ["Riga, Livland, Russia", "Riga, Latvia"],
    ["Kiev, Kiev, Russia", "Kyiv, Ukraine"],
    ["Lemberg, Galizien, Österreich", "Lviv, Lviv, Ukraine"],
    ["Laibach, Krain, Austria", "Ljubljana, Slovenia"],
    ["Prag, Böhmen, Österreich", "Prague, Czechia"],
    ["Brünn, Mähren, Austria", "Brno, Czechia"],
    ["Svitavy, Moravská Třebová, Morava, Rakousko", "Svitavy, Svitavy, Czechia"],
    ["Czernowitz, Bukowina, Austria", "Chernivtsi, Chernivtsi, Ukraine"],
    ["Pressburg, Pressburg, Hungary", "Bratislava, Slovakia"],
    ["Kolozsvár, Kolozs, Hungary", "Cluj-Napoca, Cluj, Romania"],
    ["Kaschau, Abaúj-Torna, Hungary", "Košice, Slovakia"],
    ["Memel, Ostpreussen, Preussen", "Klaipeda, Klaipėda, Lithuania"],
    // A bare Georgia is the state (lead, 2026-08-27), but no reason to refuse a
    // place FamilySearch puts in the Republic of Georgia.
    ["Tbilisi, Georgia", "Tbilisi, Republic of Georgia"],
    ["Kutaisi, Imereti, Georgia", "Kutaisi, Imereti, Republic of Georgia"],
  ])("keeps %j's %j", async (place, supplied) => {
    expect(await keptSupplied(place, supplied)).toEqual({ kept: supplied });
    expect(await judged(place, supplied)).toEqual({ standardPlace: supplied });
  });
});

describe("judgeSupplied: the lookup that stands in for a refused value", () => {
  it("must fit the text as a supplied value must", async () => {
    expect(await judged("Massachusettes,USA", "Massachusetts, United States")).toEqual({
      standardPlace: null,
      warning:
        "standard_place 'Massachusetts, United States' for 'Massachusettes,USA' was not kept: no part of the place text " +
        "names that place, and the engine has none for it: the engine's place lookup answer 'Usa, Palau' does not fit it " +
        `either: it lies in a different country than the place. ${KEPT_WHEN}`,
    });
    expect(await judged("Boght Reformed, Church", "Boght Corners, Colonie, Albany, New York, United States")).toEqual({
      standardPlace: null,
      warning:
        "standard_place 'Boght Corners, Colonie, Albany, New York, United States' for 'Boght Reformed, Church' was not " +
        "kept: no part of the place text names that place, and the engine has none for it: the engine's place lookup " +
        "answer 'Church, Hillsdale, Michigan, United States' does not fit it either: no part of the place text names " +
        `that place. ${KEPT_WHEN}`,
    });
  });

  it("may lie in the text's country and in a jurisdiction it names in place of being named by it", async () => {
    expect(await judged("La Unión, Guerrero, Mexico", "La Unión, Guerrero, Mexico")).toEqual({
      standardPlace: "La Unión de Isidoro Montes de Oca, Guerrero, Mexico",
      warning:
        "standard_place 'La Unión, Guerrero, Mexico' for 'La Unión, Guerrero, Mexico' was replaced by 'La Unión de " +
        "Isidoro Montes de Oca, Guerrero, Mexico', the engine's lookup: FamilySearch's place standard has no place of " +
        `that name. ${KEPT_WHEN}`,
    });
  });

  it("may not stand in for a value merely by lying in the text's country", async () => {
    // FamilySearch's search for the text finds Krainberg, in Carinthia, Austria;
    // the text names Laibach in Krain.
    expect(await judged("Laibach, Krain, Austria", "Lubljana, Slovenia")).toEqual({
      standardPlace: null,
      warning:
        "standard_place 'Lubljana, Slovenia' for 'Laibach, Krain, Austria' was not kept: FamilySearch's place " +
        "standard has no place of that name, and the engine has none for it: the engine's place lookup answer " +
        "'Krainberg, Villach Land, Carinthia, Austria' does not fit it either: no part of the place text names that " +
        `place. ${KEPT_WHEN}`,
    });
  });

  it.each([
    ["Balto., Md.", "Baltimore, Maryland, United States"],
    ["Cincinatti, Hamilton, Ohio", "Cincinnati, Hamilton, Ohio, United States"],
    ["Bklyn, Kings, New York", "Brooklyn, Kings, New York, United States"],
  ])("keeps %j's %j silently: the lookup gives it too, in the state the text ends with", async (place, supplied) => {
    expect(await keptSupplied(place, supplied)).toEqual({ why: "no part of the place text names that place", unnamed: true });
    expect(await judged(place, supplied)).toEqual({ standardPlace: supplied });
  });

  it("keeps no value a phrase's lookup agrees with, the phrase naming no state or country", async () => {
    expect((await judged("at the home of her daughter", "Of, Trabzon, Türkiye")).standardPlace).toBeNull();
  });
});

describe("a US state or Canadian province names the one country that holds it", () => {
  const CANADA = [
    "Ontario", "ON", "Canada West", "Upper Canada", "Quebec", "Québec", "QC", "Canada East", "Lower Canada",
    "Nova Scotia", "NS", "New Brunswick", "Nouveau-Brunswick", "NB", "Manitoba", "MB", "British Columbia", "BC",
    "Prince Edward Island", "PE", "Saskatchewan", "SK", "Alberta", "AB", "Newfoundland", "NL",
  ];
  const STATES = [
    "Alabama", "AL", "Alaska", "AK", "Arizona", "AZ", "Arkansas", "AR", "California", "CA", "Colorado", "CO",
    "Connecticut", "CT", "Delaware", "DE", "Florida", "FL", "Georgia", "GA", "Hawaii", "HI", "Idaho", "ID",
    "Illinois", "IL", "Indiana", "IN", "Iowa", "IA", "Kansas", "KS", "Kentucky", "KY", "Louisiana", "LA",
    "Maine", "ME", "Maryland", "MD", "Massachusetts", "MA", "Michigan", "MI", "Minnesota", "MN", "Mississippi",
    "MS", "Missouri", "MO", "Montana", "MT", "Nebraska", "NE", "Nevada", "NV", "New Hampshire", "NH",
    "New Jersey", "NJ", "New Mexico", "NM", "New York", "NY", "North Carolina", "NC", "North Dakota", "ND",
    "Ohio", "OH", "Oklahoma", "OK", "Oregon", "OR", "Pennsylvania", "PA", "Rhode Island", "RI",
    "South Carolina", "SC", "South Dakota", "SD", "Tennessee", "TN", "Texas", "TX", "Utah", "UT", "Vermont", "VT",
    "Virginia", "VA", "Washington", "WA", "West Virginia", "WV", "Wisconsin", "WI", "Wyoming", "WY",
    "District of Columbia", "DC", "Puerto Rico", "PR",
  ];
  const countries = async () => {
    const [canada, us] = [await familySearchPlace("Canada"), await familySearchPlace("United States")];
    if (!canada || !us) throw new Error("FamilySearch has no Canada or United States");
    return { canada, us };
  };

  it.each(CANADA)("reads %j as Canada's", async (division) => {
    const { canada, us } = await countries();
    expect(await countryContradiction(`Somewhere, ${division}`, canada)).toBe(false);
    expect(await countryContradiction(`Somewhere, ${division}`, us)).toBe(true);
  });

  it.each(STATES)("reads %j as the United States'", async (division) => {
    const { canada, us } = await countries();
    expect(await countryContradiction(`Somewhere, ${division}`, us)).toBe(false);
    expect(await countryContradiction(`Somewhere, ${division}`, canada)).toBe(true);
  });
});

describe("placeAnswer: a lookup fills a fact with none whatever its text names, as on main", () => {
  it.each([
    // Texts of the e2e final trees, each filled right on main.
    ["West Topsham, Orange, Vermont", "Topsham, Orange, Vermont, United States"],
    ["Precinct 2, Hill, Texas", "Justice Precinct 2, Hill, Texas, United States"],
    ["Bystré 30, Polička, Čechy, Rakousko", "Bistrau, Polička, Bohemia"],
    ["Maracaibo, Venezuela", "Zulia, Venezuela"],
    ["Santa Rosa de los Andes, Aconcagua, Chile", "Los Andes, Aconcagua, Chile"],
    ["<Simmesport, Avoyelles, Louisiana>", "Simmesport, Avoyelles, Louisiana, United States"],
  ])("fills %j with %j", async (place, lookup) => {
    expect(await placeAnswer(place, [], () => resolveStandardPlace(place))).toEqual({ standardPlace: lookup, from: "lookup" });
  });
});
