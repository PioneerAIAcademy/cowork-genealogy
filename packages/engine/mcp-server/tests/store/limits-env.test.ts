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
    expect(r.sharedCollectionsCache).toBeUndefined();
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
    // NOT handed on as a working limit -- and specifically `null`, not
    // `undefined`: the caller must be unable to confuse "invalid" with "off".
    expect(r.fsCallsPerMinute).toBeNull();
  });

  // The three-state point, and the reason this does not reuse pg-s3-env's
  // `seconds()`: with one sentinel for "unset" and "invalid", an unusable
  // value reads as "off", never reaches the exit-2 branch, and the server
  // starts with the limit silently absent.
  it("separates unset from invalid, so an invalid value is not read as off", () => {
    const unset = readLimitsEnv({});
    const bad = readLimitsEnv({ GENEALOGY_FS_CALLS_PER_MINUTE: "abc" });
    expect(unset.fsCallsPerMinute).toBeUndefined();
    // The whole point: a different value, so a caller that forgets `invalid`
    // still cannot pass this to configureFsBudget as if it were "off".
    expect(bad.fsCallsPerMinute).toBeNull();
    // Same value, different verdict -- that is what `invalid` carries.
    expect(unset.invalid).toEqual([]);
    expect(bad.invalid).toEqual(["GENEALOGY_FS_CALLS_PER_MINUTE"]);
  });

  it("refuses a value above the ceiling", () => {
    // The budget stores one timestamp per admitted call, so an absurd rate
    // would grow an unbounded array; pg-s3-env caps its interval for the same
    // class of reason.
    const r = readLimitsEnv({ GENEALOGY_FS_CALLS_PER_MINUTE: "1000000000" });
    expect(r.invalid).toEqual(["GENEALOGY_FS_CALLS_PER_MINUTE"]);
    expect(r.fsCallsPerMinute).toBeNull();
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

describe("readLimitsEnv: GENEALOGY_SHARED_COLLECTIONS_CACHE", () => {
  it.each([
    ["true", true],
    [" true ", true],
    ["false", false],
    ["", undefined],
    ["  ", undefined],
  ])("reads %j as %s", (raw, want) => {
    const r = readLimitsEnv({ GENEALOGY_SHARED_COLLECTIONS_CACHE: raw });
    expect(r.sharedCollectionsCache).toBe(want);
    expect(r.invalid).toEqual([]);
  });

  // A spelling a person might reach for must not read as "off" and start a
  // server whose cache is quietly per token.
  it.each([["TRUE"], ["yes"], ["1"], ["on"], ["0"]])("refuses %j", (raw) => {
    const r = readLimitsEnv({ GENEALOGY_SHARED_COLLECTIONS_CACHE: raw });
    expect(r.sharedCollectionsCache).toBeNull();
    expect(r.invalid).toEqual(["GENEALOGY_SHARED_COLLECTIONS_CACHE"]);
  });
});
