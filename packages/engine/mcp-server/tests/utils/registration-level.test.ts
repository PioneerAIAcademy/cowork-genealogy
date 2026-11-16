import { describe, it, expect } from "vitest";
import { normalizeRegistrationStart } from "../../src/utils/registration-level.js";
import { VALIDATOR_ENUMS } from "../../src/validation/validator.js";

const allowed = VALIDATOR_ENUMS.registration_level;
const row = (level: unknown, extra: Record<string, unknown> = {}) => ({ event: "birth", level, year: 1852, source_url: "https://example.org/v", ...extra });
const read = (level: unknown, extra: Record<string, unknown> = {}) =>
  (normalizeRegistrationStart([row(level, extra)], allowed) as Array<Record<string, unknown>>).map((r) => [r.level, r.note]);

describe("normalizeRegistrationStart", () => {
  it("returns the same array when every level is already in the list", () => {
    const rows = [row("state"), row("province"), row("municipality"), row("district")];
    expect(normalizeRegistrationStart(rows, allowed)).toBe(rows);
  });

  // Every form below was a refused entry append in a unit or real run.
  it.each([
    ["national (GRO)", [["national", "national (GRO)"]]],
    ["county (Philadelphia only)", [["county", "county (Philadelphia only)"]]],
    ["national (England and Wales)", [["national", "national (England and Wales)"]]],
    ["national (registration district)", [["national", "national (registration district)"]]],
    ["statewide", [["state", undefined]]],
    ["Nationwide", [["national", undefined]]],
    ["county/town", [["county", undefined], ["town", undefined]]],
    ["county/state", [["county", undefined], ["state", undefined]]],
    ["county and town", [["county", undefined], ["town", undefined]]],
    ["State level", [["state", undefined]]],
    ["colony/province (optional licence)", [["province", "colony/province (optional licence)"]]],
  ])("reads %j", (level, expected) => {
    expect(read(level)).toEqual(expected);
  });

  it("names no level from a word inside the brackets, and leaves the row alone", () => {
    const rows = [row("non-Catholic civil registry (parallel to parish)")];
    expect(normalizeRegistrationStart(rows, allowed)).toBe(rows);
  });

  it.each(["federal", "", "   ", "canton", "wide", "worldwide"])("leaves %j for the validator", (level) => {
    const rows = [row(level)];
    expect(normalizeRegistrationStart(rows, allowed)).toBe(rows);
  });

  it.each([[null], [42], [["state"]], [undefined]])("leaves a level of %j alone", (level) => {
    const rows = [row(level)];
    expect(normalizeRegistrationStart(rows, allowed)).toBe(rows);
  });

  it("keeps a note the row already has", () => {
    expect(read("national (GRO)", { note: "General Register Office" })).toEqual([["national", "General Register Office"]]);
  });

  it("copies the row's other fields onto each level it splits into", () => {
    const out = normalizeRegistrationStart([row("county/town")], allowed) as Array<Record<string, unknown>>;
    expect(out).toEqual([row("county"), row("town")]);
  });

  it("names a repeated level once", () => {
    expect(read("county / county")).toEqual([["county", undefined]]);
  });

  it("returns anything that is not an array as it came", () => {
    for (const v of [null, undefined, "state", { level: "statewide" }]) expect(normalizeRegistrationStart(v, allowed)).toBe(v);
  });

  it("rewrites only the rows it can read", () => {
    const bad = row("federal");
    const good = row("town");
    const out = normalizeRegistrationStart([bad, row("statewide"), good], allowed) as unknown[];
    expect(out[0]).toBe(bad);
    expect(out[1]).toEqual(row("state"));
    expect(out[2]).toBe(good);
  });
});
