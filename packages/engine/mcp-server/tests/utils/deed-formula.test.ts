import { describe, it, expect } from "vitest";
import { deedFormulaErrors } from "../../src/utils/deed-formula.js";
import type { StructuredDocument } from "../../src/utils/structured-document.js";

const person = (id: string, given: string, surname: string, statedRelation?: string, facts: any[] = []) =>
  ({ id, names: [{ given, surname }], ...(statedRelation ? { statedRelation } : {}), facts }) as any;

const DEED_TEXT =
  "KNOW YE, That I Paul Meacham of Southwick in the County of Hampshire, in consideration of the sum of " +
  "forty pounds paid by John Dewey of Westfield, the receipt whereof I do acknowledge, have sold unto the said John Dewey " +
  "a tract of land. Signed and sealed in presence of Gad Palmer, John Ingersol. Before John Ingersoll Justice of the peace.";

const deed = (roles: Record<string, string | undefined>): StructuredDocument =>
  ({
    recordType: "land",
    documentForm: "page_image",
    source: { title: "deed", repository: "FamilySearch" },
    persons: [
      person("p1", "Paul", "Meacham", roles.p1),
      person("p2", "John", "Dewey", roles.p2),
      person("p3", "Gad", "Palmer", roles.p3),
      person("p4", "John", "Ingersoll", roles.p4),
    ],
  }) as StructuredDocument;

const right = { p1: "grantor", p2: "grantee", p3: "witness", p4: "justice of the peace" };

describe("deedFormulaErrors: land", () => {
  it("accepts the Meacham deed labelled as the page says", () => {
    expect(deedFormulaErrors(deed(right), DEED_TEXT, "d")).toEqual([]);
  });

  it("refuses grantor and grantee swapped, quoting the 'Know ye' phrase", () => {
    const errs = deedFormulaErrors(deed({ ...right, p1: "grantee", p2: "grantor" }), DEED_TEXT, "d").join(" ");
    expect(errs).toMatch(/KNOW YE, That I Paul Meacham/);
    expect(errs).toMatch(/names p1 \(Paul Meacham\) as the grantor/);
  });

  it("refuses a witness labelled a grantor, quoting 'in presence of'", () => {
    const errs = deedFormulaErrors(deed({ ...right, p3: "grantor" }), DEED_TEXT, "d").join(" ");
    expect(errs).toMatch(/in presence of Gad Palmer/);
  });

  it("matches a spelling variant (Ingersol / Ingersoll)", () => {
    const errs = deedFormulaErrors(deed({ ...right, p4: "grantee" }), DEED_TEXT, "d").join(" ");
    expect(errs).toMatch(/in presence of/);
  });

  it("stays silent on a form it does not recognise", () => {
    const indenture = "This Indenture made between Paul Meacham of the one part and John Dewey of the other part witnesseth";
    expect(deedFormulaErrors(deed({ ...right, p1: "grantee", p2: "grantor" }), indenture, "d")).toEqual([]);
  });

  it("stays silent when the phrase names nobody in the document", () => {
    expect(deedFormulaErrors(deed({ ...right, p1: "grantee", p2: "grantor" }), "Know ye that I Zebulon Quill of Boston have sold", "d")).toEqual([]);
  });

  it("refuses only when every matching formula on the page contradicts", () => {
    const twoDeeds = "Know ye that I Paul Meacham of Southwick have sold. Know ye that I John Dewey of Westfield have sold.";
    expect(deedFormulaErrors(deed({ ...right, p1: "grantee", p2: "grantor" }), twoDeeds, "d")).toEqual([]);
    const bothWrong = deedFormulaErrors(deed({ ...right, p1: "grantee", p2: "grantee" }), twoDeeds, "d").join(" ");
    expect(bothWrong).toMatch(/Know ye that I Paul Meacham/);
  });

  it.each([
    ["no 'I' after 'presents that'", "Know all men by these presents that Paul Meacham of Southwick in the County of Hampshire for the sum of forty pounds have sold"],
    ["a comma after 'I'", "Know all men by these Presents, That I, Paul Meacham of Southwick County of Hampshire have sold"],
  ])("reads the grantor from a corpus form: %s", (_n, text) => {
    expect(deedFormulaErrors(deed(right), text, "d")).toEqual([]);
    expect(deedFormulaErrors(deed({ ...right, p1: "grantee", p2: "grantor" }), text, "d").join(" ")).toMatch(/Know all men by these/i);
  });

  it("does not run on other record types", () => {
    const doc = { ...deed(right), recordType: "marriage" } as StructuredDocument;
    expect(deedFormulaErrors(doc, DEED_TEXT, "d")).toEqual([]);
  });
});

describe("deedFormulaErrors: probate", () => {
  const TEXT = "The second account of Isaac Porter, Administrator on the Estate of Paul Meacham late of Southwick deceased.";
  const probate = (porterFacts: any[], paulFacts: any[]): StructuredDocument =>
    ({
      recordType: "probate",
      documentForm: "page_image",
      source: { title: "p", repository: "FamilySearch" },
      persons: [person("p1", "Isaac", "Porter", "administrator", porterFacts), person("p2", "Paul", "Meacham", undefined, paulFacts)],
    }) as StructuredDocument;

  it("accepts the decedent carrying the probate fact", () => {
    expect(deedFormulaErrors(probate([], [{ type: "probate" }]), TEXT, "d")).toEqual([]);
  });

  it("refuses the administrator made the decedent, quoting the phrase", () => {
    const errs = deedFormulaErrors(probate([{ type: "probate" }], []), TEXT, "d").join(" ");
    expect(errs).toMatch(/Administrator on the Estate of Paul Meacham/);
  });

  it("stays silent when the text has no administrator phrase", () => {
    expect(deedFormulaErrors(probate([{ type: "probate" }], []), "Letters were granted on the estate.", "d")).toEqual([]);
  });
});
