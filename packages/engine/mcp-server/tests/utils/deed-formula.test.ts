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
  it("names only the mislabelled party, not a correctly labelled one the phrase also lists", () => {
    const errs = deedFormulaErrors(d(["grantor", "grantee", "grantor", "witness"]), text, "d").join(" ");
    expect(errs).toMatch(/names p3 \(Gad Palmer\) as witnesses/);
    expect(errs).not.toMatch(/p4/);
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

describe("deedFormulaErrors: payer, probate and signer shapes (PR review round 3, #3881)", () => {
  const land = (persons: any[]) =>
    ({ recordType: "land", documentForm: "page_image", source: { title: "d", repository: "r" }, persons }) as StructuredDocument;
  const probate = (persons: any[]) =>
    ({ recordType: "probate", documentForm: "page_image", source: { title: "p", repository: "r" }, persons }) as StructuredDocument;
  const mm = () => land([person("p1", "Paul", "Meacham", "grantor"), person("p2", "John", "Dewey", "grantee")]);

  it("refuses the payer labelled grantor when no Know-ye phrase names a grantor", () => {
    const d = land([person("p1", "Paul", "Meacham", "grantor"), person("p2", "John", "Dewey", "grantor"), person("p3", "Sam", "Smith", "grantee")]);
    const text = "This Indenture between Paul Meacham of the one part and Sam Smith of the other, for forty pounds paid by John Dewey of Westfield";
    expect(deedFormulaErrors(d, text, "d").join(" ")).toMatch(/paid by John Dewey/);
  });

  it("refuses the payer labelled witness the same way", () => {
    const d = land([person("p1", "Paul", "Meacham", "grantor"), person("p2", "John", "Dewey", "witness"), person("p3", "Sam", "Smith", "grantee")]);
    const text = "This Indenture between Paul Meacham of the one part and Sam Smith of the other, for forty pounds paid by John Dewey of Westfield";
    expect(deedFormulaErrors(d, text, "d").join(" ")).toMatch(/paid by John Dewey/);
  });

  it.each([
    ["paid unto me by", "Know ye that I Paul Meacham for $500 paid unto me by John Dewey have sold"],
    ["paid to us by", "Know ye that I Paul Meacham for $500 paid to us by John Dewey have sold"],
    ["paid and secured to me by", "Know ye that I Paul Meacham for $500 paid and secured to me by John Dewey have sold"],
    ["paid him by", "Know ye that I Paul Meacham for $500 paid him by John Dewey have sold"],
    ["which was paid by", "Know ye that I Paul Meacham for $500 which was paid by John Dewey have sold"],
  ])("accepts a deed whose consideration reads '%s', with a mortgage back on the page", (_n, deedText) => {
    const text = `${deedText} unto the said John Dewey. Know all men by these presents that I John Dewey for $500 paid by Paul Meacham do grant unto the said Paul Meacham`;
    expect(deedFormulaErrors(mm(), text, "d")).toEqual([]);
  });

  it.each([
    "the debt, borne and paid by Paul Meacham",
    "the note is fully paid by Paul Meacham",
    "which shall be well and truly paid by the said Paul Meacham",
    "which was duly paid by Paul Meacham",
    "the taxes being paid by Paul Meacham",
  ])("accepts a correct deed whose tax or mortgage clause says '%s'", (clause) => {
    expect(deedFormulaErrors(mm(), `Know ye that I Paul Meacham for $500 paid unto me by John Dewey have sold, ${clause}`, "d")).toEqual([]);
  });

  it("accepts two Know-ye deeds on a page, for the second deed", () => {
    const d = land([person("p1", "John", "Dewey", "grantor"), person("p2", "Sam", "Smith", "grantee")]);
    expect(deedFormulaErrors(d, "Know ye that I Paul Meacham for $40 paid by John Dewey have sold. Know ye that I John Dewey for value received have sold to Sam Smith.", "d")).toEqual([]);
  });

  it("stays silent on a swapped page whose mortgage back names both parties as grantors (the narrowing's cost)", () => {
    const d = land([person("p1", "Paul", "Meacham", "grantee"), person("p2", "John", "Dewey", "grantor")]);
    const text = "Know ye that I Paul Meacham for $500 paid by John Dewey have sold. Know all men by these presents that I John Dewey paid by Paul Meacham do grant";
    expect(deedFormulaErrors(d, text, "d")).toEqual([]);
  });

  it("probate: refuses the administrator made the decedent when the name sits directly before the phrase", () => {
    const d = (porter: any) => probate([porter, person("p2", "Paul", "Meacham")]);
    const porter = person("p1", "Isaac", "Porter", "administrator", [{ type: "probate" }]);
    for (const lead of [
      "Isaac Porter Administrator on the Estate of Paul Meacham late of Southwick deceased",
      "Isaac Porter, Administrator on the Estate of Paul Meacham",
    ]) {
      expect(deedFormulaErrors(d(porter), lead, "d").join(" ")).toMatch(/names p1 \(Isaac Porter\) as the administrator/);
    }
  });

  it("probate: a caption that puts 'of <place>' or 'Esq.' before the phrase is not read (a missed refusal, accepted)", () => {
    const d = probate([person("p1", "Isaac", "Porter", "administrator", [{ type: "probate" }]), person("p2", "Paul", "Meacham")]);
    for (const lead of [
      "Isaac Porter of Westfield in the County of Hampshire, Administrator on the Estate of Paul Meacham",
      "Isaac Porter, Esq., Administrator on the Estate of Paul Meacham",
    ]) {
      expect(deedFormulaErrors(d, lead, "d")).toEqual([]);
    }
  });

  it.each([
    ["a payment to another estate's administrator", "To cash paid Gad Palmer, Administrator of the Estate of John Ingersoll, 5 dollars"],
    ["an adm'r heading", "Account of Isaac Porter, adm'r of the estate of Paul Meacham"],
    ["an Admr. heading", "Isaac Porter Admr."],
    ["an executor's account", "Account of Isaac Porter, Executor of the last will of Paul Meacham"],
    ["no heading phrase", "Paid the funeral charges and the doctor's bill"],
    ["the subscriber", "the subscriber, Administrator on the estate of the late Paul Meacham. To cash paid Gad Palmer, Administrator of the Estate of John Ingersoll"],
  ])("probate: accepts a correct document with %s", (_n, text) => {
    const d = probate([person("p1", "Isaac", "Porter", "administrator"), person("p2", "Paul", "Meacham", undefined, [{ type: "probate" }]), person("p3", "Gad", "Palmer"), person("p4", "John", "Ingersoll")]);
    expect(deedFormulaErrors(d, text, "d")).toEqual([]);
  });

  it("does not read a signer after a semicolon as a witness", () => {
    const d = land([person("p1", "Paul", "Meacham", "grantor"), person("p2", "John", "Dewey", "grantee"), person("p3", "Gad", "Palmer", "witness")]);
    const text = "This Indenture made between Paul Meacham of the one part and John Dewey of the other part. Signed sealed and delivered in presence of Gad Palmer; Paul Meacham (seal)";
    expect(deedFormulaErrors(d, text, "d")).toEqual([]);
  });

  it("does not read 'That Whereas' as a name", () => {
    const d = land([person("p1", "John", "Dewey", "grantee"), person("p2", "Paul", "Meacham", "grantor")]);
    expect(deedFormulaErrors(d, "Know all men by these presents, That Whereas John Dewey recovered judgment", "d")).toEqual([]);
  });

  it("reads 'and' between witnesses (a witness labelled grantor is refused through it)", () => {
    const d = land([person("p1", "Paul", "Meacham", "grantor"), person("p2", "John", "Dewey", "grantee"), person("p3", "Gad", "Palmer", "witness"), person("p4", "John", "Ingersol", "grantor")]);
    expect(deedFormulaErrors(d, "This Indenture. Signed in presence of Gad Palmer and John Ingersol", "d").join(" ")).toMatch(/p4/);
  });

  it("reads the filler in 'paid at or before the ensealing and delivery of these presents by'", () => {
    const d = land([person("p1", "Paul", "Meacham", "grantor"), person("p2", "John", "Dewey", "grantor"), person("p3", "Sam", "Smith", "grantee")]);
    expect(deedFormulaErrors(d, "This Indenture, for $5 paid at or before the ensealing and delivery of these presents by John Dewey of Westfield", "d").join(" ")).toMatch(/paid at or before/);
  });

  it("a party the payer phrase places is not also read as a witness", () => {
    const d = land([person("p1", "Ann", "Seller", "grantor"), person("p2", "Paul", "Roe", "grantee"), person("p3", "Gad", "Palmer", "witness")]);
    const text = "This Indenture, Ann Seller selling, for $5 paid by Paul Roe of Boston. Signed in presence of Gad Palmer, Paul Roe (seal)";
    expect(deedFormulaErrors(d, text, "d")).toEqual([]);
  });
});

describe("deedFormulaErrors: probate captions that name the decedent (PR review round 4, #3881)", () => {
  const probate = (persons: any[]) =>
    ({ recordType: "probate", documentForm: "page_image", source: { title: "p", repository: "r" }, persons }) as StructuredDocument;
  const base = () => [person("p1", "Isaac", "Porter", "administrator"), person("p2", "Paul", "Meacham", undefined, [{ type: "probate" }])];

  it.each([
    "Estate of Paul Meacham of Southwick deceased. Account of the Administrator on the Estate of said deceased.",
    "Paul Meacham of Southwick. The subscriber, Administrator on the Estate of the said deceased, charges himself",
    "Paul Meacham of Southwick, yeoman, deceased.\nThe account of the Administrator on the Estate of the deceased.",
    "An Inventory of the Estate of Paul Meacham of Southwick, sworn to by the Administrator of the Estate of the deceased",
    "Probate of the Estate of Paul Meacham. Account of the subscriber, Administrator on the Estate of Paul Meacham",
    "Estate of Paul Meacham Deceased. Account of the Administrator on the Estate of said deceased",
    "Estate of Paul Meacham of Southwick. Isaac Porter, yeoman, Administrator on the Estate of said deceased",
  ])("accepts correct labels on: %s", (text) => {
    expect(deedFormulaErrors(probate(base()), text, "d")).toEqual([]);
  });

  it("accepts an administratrix who is the decedent's widow", () => {
    const d = probate([person("p1", "Mary", "Meacham", "administratrix"), person("p2", "Paul", "Meacham", undefined, [{ type: "probate" }])]);
    expect(deedFormulaErrors(d, "Estate of Paul Meacham of Southwick. Mary Meacham, widow, Administratrix on the Estate of said Paul Meacham", "d")).toEqual([]);
  });

  it("accepts a son administering his namesake father's estate", () => {
    const d = probate([person("p1", "John", "Smith Jr", "administrator"), person("p2", "John", "Smith", undefined, [{ type: "probate" }])]);
    expect(deedFormulaErrors(d, "John Smith of Hartford, Administrator on the Estate of John Smith late of Hartford", "d")).toEqual([]);
  });
});

describe("deedFormulaErrors: clause-opening words are not names (#3881)", () => {
  const d = {
    recordType: "land", documentForm: "page_image", source: { title: "d", repository: "r" },
    persons: [person("p1", "Paul", "Meacham", "grantor"), person("p2", "John", "Dewey", "grantee")],
  } as StructuredDocument;
  it.each(["Whereas", "That", "The", "This", "Know", "Now", "And", "Which", "Witnesseth"])("does not read '%s' as the start of a name", (word) => {
    expect(deedFormulaErrors(d, `Know all men by these presents, That ${word} John Dewey recovered judgment`, "d")).toEqual([]);
  });
});
