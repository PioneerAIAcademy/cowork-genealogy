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

describe("deedFormulaErrors: shapes a correct document takes (PR review, #3881)", () => {
  const doc = (persons: any[], recordType = "land") =>
    ({ recordType, documentForm: "page_image", source: { title: "d", repository: "r" }, persons }) as StructuredDocument;
  const meacham = (extra: any[] = []) =>
    doc([
      person("p1", "Paul", "Meacham", "grantor"),
      person("p2", "John", "Dewey", "grantee"),
      person("p3", "Gad", "Palmer", "witness"),
      person("p4", "John", "Ingersoll", "witness"),
      ...extra,
    ]);

  it.each([
    ["signers on the lines after the witness line", "in presence of\nGad Palmer\nJohn Ingersol\nPaul Meacham (seal)"],
    ["a witness clause run into the acknowledgment", "in presence of Gad Palmer, John Ingersol Hampshire ss Then Paul Meacham personally appeared"],
    ["the same without ss", "in presence of Gad Palmer, John Ingersol Hampshire Then Paul Meacham personally appeared"],
    ["a signature and witness column run together", "In the presence of ℗ us as witnesses : Paul Meacham Russell E"],
    ["a signer after the witnesses' sentence", "in presence of Gad Palmer, John Ingersol. Paul Meacham (seal)"],
    ["a signer on the witness header line (two columns)", "Signed sealed and delivered in presence of     Paul Meacham (seal)\nGad Palmer\nJohn Ingersol"],
    ["a signer on one line with the witnesses", "Signed in presence of Gad Palmer, Paul Meacham (seal)"],
    ["a later tax clause naming the grantor", "The taxes for 1907 are to be paid by Paul Meacham."],
    ["a mortgage already paid by the grantor", "free of the mortgage to Sam Jones which was paid by Paul Meacham in full."],
  ])("accepts %s", (_n, text) => {
    expect(deedFormulaErrors(meacham(), `Know ye that I Paul Meacham of Southwick have sold to John Dewey. ${text}`, "d")).toEqual([]);
  });

  it("accepts father and son with one name (John Dewey / John Dewey Jr)", () => {
    const d = doc([person("p1", "John", "Dewey", "grantor"), person("p2", "John", "Dewey Jr", "grantee")]);
    const text = "Know all men by these presents that I John Dewey of Hartford for forty pounds paid by John Dewey Jr of Boston have sold unto the said John Dewey Jr";
    expect(deedFormulaErrors(d, text, "d")).toEqual([]);
  });

  it("accepts a probate administrator and decedent who share a name", () => {
    const d = doc([person("p1", "John", "Smith Jr", "administrator"), person("p2", "John", "Smith", undefined, [{ type: "probate" }])], "probate");
    expect(deedFormulaErrors(d, "The account of John Smith Jr Administrator on the Estate of John Smith late of Hartford deceased", "d")).toEqual([]);
  });

  it.each([
    ["a recording certificate", "Received for record and recorded by Elias Lyman Register", { given: "Elias", surname: "Lyman", rel: "register" }],
    ["an abutter", "for fifty dollars to me paid have sold to John Dewey a lot bounded east by Eli Ward", { given: "Eli", surname: "Ward", rel: "witness" }],
    ["an executor's deed", "Know all men by these presents that whereas Eli Ward late of Hartford deceased", { given: "Eli", surname: "Ward", rel: "witness" }],
    ["an indenture recital", "being the same land conveyed unto the said Eli Ward by William Jones", { given: "Eli", surname: "Ward", rel: "witness" }],
    ["a receipt acknowledgment", "the receipt of which is hereby acknowledged and conveyed unto Eli Ward", { given: "Eli", surname: "Ward", rel: "witness" }],
  ])("accepts %s that names a party who is not the grantor or grantee", (_n, text, x) => {
    expect(deedFormulaErrors(meacham([person("p5", x.given, x.surname, x.rel)]), text, "d")).toEqual([]);
  });

  it("reads witnesses only to the end of the 'in presence of' line", () => {
    const text = "This indenture between Paul Meacham and John Dewey. Signed in presence of Gad Palmer,\nPaul Meacham (seal)";
    expect(deedFormulaErrors(meacham(), text, "d")).toEqual([]);
  });

  it("accepts a husband paying for a deed to his wife", () => {
    const d = doc([person("p1", "Ann", "Seller", "grantor"), person("p2", "Mary", "Roe", "grantee"), person("p3", "Paul", "Roe", "husband")]);
    expect(deedFormulaErrors(d, "Know ye that I Ann Seller for forty pounds paid by Paul Roe of Boston have sold", "d")).toEqual([]);
  });

  it("accepts Johnson and Johnston as two parties", () => {
    const d = doc([person("p1", "Sam", "Johnson", "grantor"), person("p2", "Sam", "Johnston", "grantee")]);
    expect(deedFormulaErrors(d, "Know ye that I Sam Johnston of X paid by Sam Johnson of Y have sold", "d")).toEqual([]);
  });

  it.each([
    ["abbreviated given names", "Know all men by these presents, That I, Jno. Meacham, for $500 paid me by Abel Dewey of Boston"],
    ["paid at or before the ensealing and delivery of these presents by", "Know ye that I Jno. Meacham for $500 paid at or before the ensealing and delivery of these presents by Abel Dewey"],
    ["the Massachusetts in hand paid, before the ensealing hereof, by", "Know ye that I Jno. Meacham in consideration of $500 to me in hand paid, before the ensealing hereof, by Abel Dewey"],
  ])("reads %s, accepting the right labels and refusing swapped ones", (_n, text) => {
    const mk = (a: string, b: string) => doc([person("p1", "Jno", "Meacham", a), person("p2", "Abel", "Dewey", b)]);
    expect(deedFormulaErrors(mk("grantor", "grantee"), text, "d")).toEqual([]);
    expect(deedFormulaErrors(mk("grantee", "grantor"), text, "d").join(" ")).toMatch(/the transcription says/);
  });

  it("accepts a probate caption that names the estate before the administrator", () => {
    const d = doc([person("p1", "Isaac", "Porter", "administrator"), person("p2", "Paul", "Meacham", undefined, [{ type: "probate" }])], "probate");
    expect(deedFormulaErrors(d, "Estate of Paul Meacham in account with Isaac Porter Administrator on the Estate of said deceased", "d")).toEqual([]);
  });

  it("accepts the subscriber, Administrator on the estate of the late X", () => {
    const d = doc([person("p1", "Isaac", "Porter", "administrator"), person("p2", "Paul", "Meacham", undefined, [{ type: "probate" }])], "probate");
    expect(deedFormulaErrors(d, "the subscriber, Administrator on the estate of the late Paul Meacham", "d")).toEqual([]);
  });
});

describe("deedFormulaErrors: what must still be refused (#3881)", () => {
  const text = "Know ye that I Paul Meacham of Southwick for forty pounds paid by John Dewey of Westfield have sold. In presence of Gad Palmer, John Ingersol.";
  const d = (roles: string[]) =>
    ({
      recordType: "land", documentForm: "page_image", source: { title: "d", repository: "r" },
      persons: [person("p1", "Paul", "Meacham", roles[0]), person("p2", "John", "Dewey", roles[1]), person("p3", "Gad", "Palmer", roles[2]), person("p4", "John", "Ingersoll", roles[3])],
    }) as StructuredDocument;

  it("refuses the issue's Meacham table", () => {
    expect(deedFormulaErrors(d(["grantee", "grantor", "grantor", "grantor"]), text, "d").length).toBeGreaterThan(0);
  });
  it("refuses a witness labelled grantee", () => {
    expect(deedFormulaErrors(d(["grantor", "grantee", "grantee", "witness"]), text, "d").join(" ")).toMatch(/in presence of/i);
  });
  it("refuses the grantor labelled witness", () => {
    expect(deedFormulaErrors(d(["witness", "grantee", "witness", "witness"]), text, "d").join(" ")).toMatch(/Know ye that I Paul Meacham/);
  });
  it("refuses the payer labelled grantor when only the payer phrase contradicts", () => {
    const errs = deedFormulaErrors(d(["grantor", "grantor", "witness", "witness"]), text, "d").join(" ");
    expect(errs).toMatch(/paid by John Dewey/);
    expect(errs).not.toMatch(/Know ye/);
  });
  it("refuses the payer labelled witness", () => {
    expect(deedFormulaErrors(d(["grantor", "witness", "witness", "witness"]), text, "d").join(" ")).toMatch(/paid by John Dewey/);
  });

  it("counts only phrases that name a party when several administrator phrases appear", () => {
    const probate = {
      recordType: "probate", documentForm: "page_image", source: { title: "p", repository: "r" },
      persons: [person("p1", "Isaac", "Porter", "administrator", [{ type: "probate" }]), person("p2", "Paul", "Meacham")],
    } as StructuredDocument;
    const two = "Isaac Porter Administrator on the Estate of Paul Meacham late of Southwick. Zed Quill Administrator on the Estate of Amy Zed.";
    expect(deedFormulaErrors(probate, two, "d").join(" ")).toMatch(/Administrator on the Estate of Paul Meacham/);
  });

  it("does not throw on a name that is not a string", () => {
    const odd = { recordType: "land", documentForm: "page_image", source: { title: "d", repository: "r" }, persons: [{ id: "p1", names: [{ given: 5, surname: "Meacham" }], statedRelation: "grantor", facts: [] }] } as any;
    expect(() => deedFormulaErrors(odd, text, "d")).not.toThrow();
  });
});
