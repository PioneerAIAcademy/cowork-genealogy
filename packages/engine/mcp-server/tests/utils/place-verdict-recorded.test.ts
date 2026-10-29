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
import { __clearPlaceResolverCachesForTests, resolveStandardPlace } from "../../src/utils/place-resolver.js";

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

  it("may lie in the country the text ends with in place of being named by it", async () => {
    expect(await judged("La Unión, Guerrero, Mexico", "La Unión, Guerrero, Mexico")).toEqual({
      standardPlace: "La Unión de Isidoro Montes de Oca, Guerrero, Mexico",
      warning:
        "standard_place 'La Unión, Guerrero, Mexico' for 'La Unión, Guerrero, Mexico' was replaced by 'La Unión de " +
        "Isidoro Montes de Oca, Guerrero, Mexico', the engine's lookup: FamilySearch's place standard has no place of " +
        `that name. ${KEPT_WHEN}`,
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
