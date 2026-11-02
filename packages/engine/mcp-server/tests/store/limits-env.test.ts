import { describe, it, expect } from "vitest";
import { readLimitsEnv } from "../../src/store/limits-env.js";

// The two process-wide limits build/http.js starts from (self-hosted beta E4).
// Both off unless set, so an unset environment must read as "off" and an
// unusable one must reach the caller's exit-2 branch -- never the other way
// round.

describe("readLimitsEnv", () => {
  it("is off, and valid, when nothing is set", () => {
    const r = readLimitsEnv({});
    expect(r.fsCallsPerMinute).toBeUndefined();
    expect(r.maxTranscriptions).toBeUndefined();
    expect(r.invalid).toEqual([]);
  });

  it("is off when set to empty or whitespace, not invalid", () => {
    const r = readLimitsEnv({
      GENEALOGY_FS_CALLS_PER_MINUTE: "",
      GENEALOGY_MAX_TRANSCRIPTIONS: "   ",
    });
    expect(r.fsCallsPerMinute).toBeUndefined();
    expect(r.maxTranscriptions).toBeUndefined();
    expect(r.invalid).toEqual([]);
  });

  it("reads whole numbers, with surrounding space", () => {
    const r = readLimitsEnv({
      GENEALOGY_FS_CALLS_PER_MINUTE: "120",
      GENEALOGY_MAX_TRANSCRIPTIONS: " 4 ",
    });
    expect(r.fsCallsPerMinute).toBe(120);
    expect(r.maxTranscriptions).toBe(4);
    expect(r.invalid).toEqual([]);
  });

  // The shapes that make a parser silently do nothing: a float, an exponent a
  // naive Number() would accept, a non-number, the literal "NaN" (which must
  // never reach a comparison that is false for it), a negative, and 0 -- which
  // is NOT "off" here, unlike the orphan sweep's interval.
  it.each([
    ["1e3"],
    ["2.5"],
    ["abc"],
    ["NaN"],
    ["-1"],
    ["0"],
    ["0x10"],
    ["12abc"],
  ])("refuses %s rather than reading it as something else", (raw) => {
    const r = readLimitsEnv({ GENEALOGY_FS_CALLS_PER_MINUTE: raw });
    expect(r.invalid).toEqual(["GENEALOGY_FS_CALLS_PER_MINUTE"]);
    // The value is NOT handed on as a working limit.
    expect(r.fsCallsPerMinute).toBeUndefined();
  });

  // The three-state point, and the reason this does not reuse pg-s3-env's
  // `seconds()`: with one sentinel for "unset" and "invalid", an unusable
  // value reads as "off", never reaches the exit-2 branch, and the server
  // starts with the limit silently absent.
  it("separates unset from invalid, so an invalid value is not read as off", () => {
    const unset = readLimitsEnv({});
    const bad = readLimitsEnv({ GENEALOGY_FS_CALLS_PER_MINUTE: "abc" });
    expect(unset.fsCallsPerMinute).toBeUndefined();
    expect(bad.fsCallsPerMinute).toBeUndefined();
    // Same value, different verdict -- that is what `invalid` carries.
    expect(unset.invalid).toEqual([]);
    expect(bad.invalid).toEqual(["GENEALOGY_FS_CALLS_PER_MINUTE"]);
  });

  it("names every invalid variable, not just the first", () => {
    const r = readLimitsEnv({
      GENEALOGY_FS_CALLS_PER_MINUTE: "abc",
      GENEALOGY_MAX_TRANSCRIPTIONS: "-2",
    });
    expect(r.invalid).toEqual([
      "GENEALOGY_FS_CALLS_PER_MINUTE",
      "GENEALOGY_MAX_TRANSCRIPTIONS",
    ]);
  });

  it("reads each variable independently", () => {
    const r = readLimitsEnv({ GENEALOGY_MAX_TRANSCRIPTIONS: "4" });
    expect(r.fsCallsPerMinute).toBeUndefined();
    expect(r.maxTranscriptions).toBe(4);
    expect(r.invalid).toEqual([]);
  });
});
