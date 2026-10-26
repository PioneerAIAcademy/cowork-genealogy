// deed-formula — checks a land or probate document's role labels against the
// transcription's own formula (spec §11.7). record-structurer labels the
// parties; the page says who the grantor, grantee, witnesses and administrator
// are in fixed phrases, so a label the phrase contradicts is refused.
//
// Silent by design: a form the phrases do not recognise (an indenture "between X
// of the one part and Y of the other", a quitclaim, an abstract), a phrase whose
// names match no party, and an unreadable text all refuse nothing. A phrase
// that matches wrongly refuses a correct write, so the list stays short and each
// pattern is built from transcriptions in the corpus.

import type { DocumentPerson, StructuredDocument } from "./structured-document.js";
import { landSides, probateDecedentId } from "./structured-document.js";

const words = (s: string) => s.toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter(Boolean);

/** Edit distance <= 1, for OCR and spelling drift (Ingersoll / Ingersol). */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.slice(i) === l.slice(i + 1);
}

/** Whether the party's first given name and surname both appear in `region`. */
function named(p: DocumentPerson, region: string): boolean {
  const w = words(region);
  const n = p.names[0];
  const given = words(n?.given ?? "")[0];
  const surname = words(n?.surname ?? "").pop();
  if (!surname) return false;
  const has = (t: string) => w.some((x) => near(x, t));
  return has(surname) && (!given || has(given));
}

const label = (p: DocumentPerson) => {
  const n = p.names[0];
  return `${p.id} (${[n?.given, n?.surname].filter(Boolean).join(" ")})`;
};

// A run of names ends at the first of these.
const END = String.raw`(?=\s+(?:of|in\s+consideration|for\s+and|for\s+the\s+sum|have|hath|do|being|late|the\s+receipt|before|at\s+and|signed|sealed|know)\b|[,;]|$)`;

const GRANTOR = new RegExp(String.raw`\bKnow\s+(?:ye|all\s+men)(?:\s+by\s+these\s+presents)?[,:]?\s+(?:that\s+)?(?:(?:I|we)\b[,:]?\s+)?(.{3,120}?)${END}`, "gi");
const GRANTEE = [
  new RegExp(String.raw`\b(?:paid|received)\b.{0,120}?\bby\s+(?:the\s+said\s+)?(.{3,120}?)${END}`, "gi"),
  new RegExp(String.raw`\bunto\s+(?:the\s+said\s+)?(.{3,120}?)${END}`, "gi"),
];
const WITNESS = new RegExp(String.raw`\bin\s+(?:the\s+)?presence\s+of\s+(.{3,160}?)(?=\s+(?:before|signed|sealed|know)\b|[.;]|$)`, "gi");
const ADMINISTRATOR = new RegExp(
  String.raw`(\S[^,.;]{2,80}?),?\s+Administrat(?:or|rix)\s+(?:on|of)\s+the\s+Estate\s+of\s+(.{3,100}?)(?=\s+(?:late|deceased|of)\b|[,;.]|$)`,
  "gi",
);

interface Hit {
  phrase: string;
  region: string;
}

function hits(re: RegExp, text: string, group = 1): Hit[] {
  return [...text.matchAll(new RegExp(re.source, re.flags))].map((m) => ({ phrase: m[0].trim(), region: m[group] }));
}

/** Every formula phrase `text` carries, for auditing the patterns against a corpus. */
export function formulaPhrases(rawText: string): { formula: string; phrase: string; region: string }[] {
  const text = rawText.replace(/\s+/g, " ");
  return [
    ...hits(GRANTOR, text).map((h) => ({ formula: "grantor", ...h })),
    ...GRANTEE.flatMap((re) => hits(re, text)).map((h) => ({ formula: "grantee", ...h })),
    ...hits(WITNESS, text).map((h) => ({ formula: "witness", ...h })),
    ...hits(ADMINISTRATOR, text, 2).map((h) => ({ formula: "administrator", ...h })),
  ];
}

/**
 * Errors for a document whose labels a phrase in `text` contradicts. A formula
 * matched more than once (a page holding two deeds) refuses only when every
 * match that names a party contradicts the labels.
 */
export function deedFormulaErrors(doc: StructuredDocument, rawText: string, path: string): string[] {
  const text = rawText.replace(/\s+/g, " ");
  const errs: string[] = [];

  // `agrees(hit)` is true when the phrase names a party and the labels agree; a
  // hit naming no party is not evidence either way.
  const verdict = (hs: Hit[], agrees: (named: DocumentPerson[]) => boolean) => {
    const informative = hs
      .map((h) => ({ h, who: doc.persons.filter((p) => named(p, h.region)) }))
      .filter((x) => x.who.length > 0);
    return informative.length > 0 && informative.every((x) => !agrees(x.who)) ? informative[0] : undefined;
  };
  const refuse = (what: string, h: Hit, who: DocumentPerson[], found: string) =>
    errs.push(
      `${path}: the transcription says "${h.phrase}", which names ${who.map(label).join(" and ")} as ${what}, ` +
        `but the document ${found}. Relabel the parties by that phrase and resend.`,
    );

  if (doc.recordType === "land") {
    const sides = landSides(doc);
    const side = (p: DocumentPerson) => sides.get(p.id);

    const g = verdict(hits(GRANTOR, text), (who) => who.some((p) => side(p) === "grantor") && !who.some((p) => side(p) === "grantee"));
    if (g) refuse("the grantor", g.h, g.who, `labels ${g.who.map((p) => `${p.id} as ${side(p) ?? "neither grantor nor grantee"}`).join(" and ")}`);

    const e = verdict(GRANTEE.flatMap((re) => hits(re, text)), (who) => who.some((p) => side(p) === "grantee") && !who.some((p) => side(p) === "grantor"));
    if (e) refuse("the grantee", e.h, e.who, `labels ${e.who.map((p) => `${p.id} as ${side(p) ?? "neither grantor nor grantee"}`).join(" and ")}`);

    const w = verdict(hits(WITNESS, text), (who) => who.every((p) => !side(p)));
    if (w) refuse("witnesses", w.h, w.who, `labels ${w.who.map((p) => `${p.id} as ${side(p) ?? "a witness"}`).join(" and ")}`);
  }

  if (doc.recordType === "probate") {
    const id = probateDecedentId(doc) ?? (doc.persons.find((p) => p.principal) ?? doc.persons[0])?.id;
    const decedent = doc.persons.find((p) => p.id === id);
    if (decedent) {
      const bad = hits(ADMINISTRATOR, text)
        .map((h) => {
          const m = new RegExp(ADMINISTRATOR.source, "i").exec(h.phrase);
          return { h, administrator: m?.[1] ?? "", estate: m?.[2] ?? "" };
        })
        .filter((x) => named(decedent, x.administrator) || doc.persons.some((p) => named(p, x.estate) && p.id !== decedent.id));
      const consistent = hits(ADMINISTRATOR, text).length > bad.length;
      if (bad.length > 0 && !consistent) {
        errs.push(
          `${path}: the transcription says "${bad[0].h.phrase}", so the decedent is the estate's owner, ` +
            `but the document makes ${label(decedent)} the decedent. Put the probate, will or death fact ` +
            `on the estate's owner and resend.`,
        );
      }
    }
  }
  return errs;
}
