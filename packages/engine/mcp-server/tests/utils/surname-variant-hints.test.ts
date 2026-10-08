import { describe, it, expect } from "vitest";
import {
  patronymicVariants,
  surnameVariantHints,
  SURNAME_FIELDS,
} from "../../src/utils/surname-variant-hints.js";

const NIL = { totalMatches: 0 };

describe("patronymicVariants", () => {
  it("abbreviates -datter to the wiki's dr / dtr / d", () => {
    expect(patronymicVariants("Halsteinsdatter")).toEqual([
      "Halsteinsdr",
      "Halsteinsdtr",
      "Halsteinsd",
    ]);
  });

  it("abbreviates the Swedish -dotter the same way", () => {
    expect(patronymicVariants("Larsdotter")).toEqual(["Larsdr", "Larsdtr", "Larsd"]);
  });

  it("matches the ending case-insensitively and keeps an all-caps spelling all caps", () => {
    expect(patronymicVariants("HALSTEINSDATTER")).toEqual([
      "HALSTEINSDR",
      "HALSTEINSDTR",
      "HALSTEINSD",
    ]);
    expect(patronymicVariants("halsteinsDatter")).toEqual([
      "halsteinsdr",
      "halsteinsdtr",
      "halsteinsd",
    ]);
  });

  it("trims before matching", () => {
    expect(patronymicVariants("  Halsteinsdatter ")[0]).toBe("Halsteinsdr");
  });

  it("needs a stem: the bare ending is not a patronymic", () => {
    expect(patronymicVariants("datter")).toEqual([]);
    expect(patronymicVariants(" dotter")).toEqual([]);
  });

  // The rejected male half: -son ends ordinary English surnames, so a hint on it
  // would fire on every English nil.
  it("leaves -son, -sen and already-abbreviated forms alone", () => {
    expect(patronymicVariants("Johnson")).toEqual([]);
    expect(patronymicVariants("Monsen")).toEqual([]);
    expect(patronymicVariants("Halsteinsdr")).toEqual([]);
  });
});

describe("surnameVariantHints", () => {
  it("fires on a nil search and names the field it came from", () => {
    const hint = surnameVariantHints({ surname: "Halsteinsdatter" }, NIL);
    expect(hint?.fields).toEqual([
      {
        field: "surname",
        searched: "Halsteinsdatter",
        variants: ["Halsteinsdr", "Halsteinsdtr", "Halsteinsd"],
      },
    ]);
    expect(hint?.note).toMatch(/did not find the subject/);
    expect(hint?.note).toMatch(/SAME field/);
    expect(hint?.note).toMatch(/not evidence/);
  });

  it("reads every surname field, one entry each, in field order", () => {
    const input = Object.fromEntries(
      SURNAME_FIELDS.map((f) => [f, "Olsdatter"]),
    );
    const hint = surnameVariantHints(input, NIL);
    expect(hint?.fields.map((e) => e.field)).toEqual([...SURNAME_FIELDS]);
  });

  it("skips fields that do not qualify and non-string values", () => {
    const hint = surnameVariantHints(
      {
        surname: "Monsen",
        spouseSurname: "Halsteinsdatter",
        fatherSurname: 7 as unknown as string,
      },
      NIL,
    );
    expect(hint?.fields.map((e) => e.field)).toEqual(["spouseSurname"]);
  });

  it("fires when rows came back but ranking matched nobody", () => {
    const hint = surnameVariantHints(
      { surname: "Halsteinsdatter" },
      { totalMatches: 3, ranked: { subjectResolvable: false } },
    );
    expect(hint).toBeDefined();
  });

  it("stays silent when the search found something", () => {
    expect(surnameVariantHints({ surname: "Halsteinsdatter" }, { totalMatches: 2 })).toBeUndefined();
    expect(
      surnameVariantHints(
        { surname: "Halsteinsdatter" },
        { totalMatches: 2, ranked: { subjectResolvable: true } },
      ),
    ).toBeUndefined();
  });

  it("stays silent on a nil search with no qualifying surname", () => {
    expect(surnameVariantHints({ surname: "Neal" }, NIL)).toBeUndefined();
    expect(surnameVariantHints({ surname: "Johnson" }, NIL)).toBeUndefined();
    expect(surnameVariantHints({}, NIL)).toBeUndefined();
  });
});
