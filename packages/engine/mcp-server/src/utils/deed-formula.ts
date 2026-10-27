// deed-formula — checks a land or probate document's role labels against the
// transcription's own formula (spec §11.7). record-structurer labels the
// parties; the page says who the grantor, grantee, witnesses and administrator
// are in a few fixed phrases, and a label such a phrase contradicts is refused.
//
// Built for precision over recall, because a pattern that matches wrongly
// refuses a correct write and the agent has no way to write that deed. So:
//   - a phrase anchors on its own words, then names are read as a strict list of
//     capitalized words (2-4 per name, split by a comma, "and" or "&"), never as
//     "whatever follows up to a period";
//   - a name that matches no party, or more than one (a father and son, Johnson
//     and Johnston), is dropped, and a phrase left with no name refuses nothing;
//   - a formula that matches several times refuses only when every occurrence
//     that names a party contradicts the labels;
//   - the witness clause is read only to the end of its own line, so a signature
//     block on the next lines is never a witness.
// A form the phrases do not recognise (an indenture "between X of the one part",
// a quitclaim, an abstract) and an unreadable text refuse nothing.

import type { DocumentPerson, StructuredDocument } from "./structured-document.js";
import { landSides, partyName, probateDecedentOrDefault } from "./structured-document.js";
import { levenshteinDistance } from "./string-similarity.js";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const lower = (s: string) => s.toLowerCase().replace(/[^a-z'-]/g, "");

/** Abbreviations whose period is not the end of a sentence. */
const ABBREVIATION = new Set(["jno", "wm", "thos", "chas", "geo", "jas", "robt", "saml", "benj", "jr", "sr", "esq", "st", "mr", "mrs", "dr"]);

const NAME_TOKEN = /^[A-Z][A-Za-z'’-]*\.?$/;

/**
 * Names read off the start of `rest`: a list of names, each 2-4 capitalized
 * words, split by a comma, "and" or "&". A lowercase word ends a name; so does a
 * sentence-ending period. Returns the names and the text they were read from.
 */
function readNames(rest: string): { names: string[][]; text: string } {
  const tokens = rest.trim().split(/\s+/);
  let i = 0;
  if (/^the$/i.test(tokens[0] ?? "") && /^said$/i.test(tokens[1] ?? "")) i = 2;
  else if (/^said$/i.test(tokens[0] ?? "")) i = 1;
  const names: string[][] = [];
  for (;;) {
    const cur: string[] = [];
    let end: "comma" | "sentence" | null = null;
    while (i < tokens.length && cur.length < 4) {
      const raw = tokens[i];
      const core = raw.replace(/[,;:]+$/, "");
      if (!NAME_TOKEN.test(core)) break;
      cur.push(core.replace(/\.$/, ""));
      i++;
      if (/[,;:]$/.test(raw)) { end = "comma"; break; }
      if (core.endsWith(".") && core.length > 2 && !ABBREVIATION.has(lower(core))) { end = "sentence"; break; }
    }
    if (cur.length < 2) break;
    names.push(cur);
    if (end === "sentence") break;
    if (end !== "comma") {
      if (!/^(and|&)$/i.test(tokens[i] ?? "")) break;
      i++;
    }
  }
  return { names, text: tokens.slice(0, i).join(" ") };
}

/** The 2-4 capitalized words ending just before the end of `before`. */
function readNameBefore(before: string): string[] | undefined {
  const tokens = before.trim().split(/\s+/);
  const cur: string[] = [];
  for (let j = tokens.length - 1; j >= 0 && cur.length < 4; j--) {
    const core = tokens[j].replace(/[,;:]+$/, "");
    if (!NAME_TOKEN.test(core) || (j < tokens.length - 1 && /[,;:]$/.test(tokens[j]))) break;
    cur.unshift(core.replace(/\.$/, ""));
  }
  return cur.length >= 2 ? cur : undefined;
}

/** Equal, or one edit apart for words of 5+ letters (Ingersol / Ingersoll). */
const near = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && levenshteinDistance(a, b) <= 1);

/** The one party a name matches (given name and surname both), or undefined when
 *  it matches none or several. */
function partyFor(doc: StructuredDocument, name: string[]): DocumentPerson | undefined {
  const w = name.map(lower).filter(Boolean);
  const found = doc.persons.filter((p) => {
    const n = p.names[0];
    const given = lower(str(n?.given).split(/\s+/)[0] ?? "");
    const surname = lower(str(n?.surname).split(/\s+/).filter(Boolean).pop() ?? "");
    return !!surname && w.some((x) => near(x, surname)) && (!given || w.some((x) => near(x, given)));
  });
  return found.length === 1 ? found[0] : undefined;
}

interface Hit {
  phrase: string;
  parties: DocumentPerson[];
}

const GRANTOR = /\bKnow\s+(?:ye|all\s+men)(?:\s+by\s+these\s+presents)?[,:]?\s+(?:that\s+)?(?:(?:I|we)\b[,:]?\s+)?/gi;
const PAID_BY = /(?<!\b(?:be|been|is|are|was|were)\s+)\bpaid\b(?:[,\s]+(?:to\s+me|me|in\s+hand|at|or|before|the|ensealing|and|delivery|of|these|presents|hereof)){0,10}?[,\s]+by\s+/gi;
const IN_PRESENCE = /\bin\s+(?:the\s+)?presence\s+of[ \t]+/gi;
const ADMINISTRATOR = /\bAdministrat(?:or|rix)\s+(?:on|of)\s+the\s+Estate\s+of\s+/gi;

function hitsAfter(doc: StructuredDocument, text: string, anchor: RegExp, lineOnly = false): Hit[] {
  return [...text.matchAll(new RegExp(anchor.source, anchor.flags))].map((m) => {
    const start = m.index! + m[0].length;
    const rest = text.slice(start, start + 240);
    const { names, text: read } = readNames(lineOnly ? rest.split(/\r?\n/)[0] : rest);
    const parties = [...new Set(names.map((n) => partyFor(doc, n)).filter((p): p is DocumentPerson => !!p))];
    return { phrase: `${m[0]}${read}`.replace(/\s+/g, " ").trim(), parties };
  });
}

/** Every formula phrase `rawText` carries, for auditing the patterns against a corpus. */
export function formulaPhrases(rawText: string): { formula: string; phrase: string; names: string[] }[] {
  const text = rawText.replace(/\s+/g, " ");
  const read = (formula: string, source: string, anchor: RegExp, lineOnly = false) =>
    [...source.matchAll(new RegExp(anchor.source, anchor.flags))].map((m) => {
      const rest = source.slice(m.index! + m[0].length, m.index! + m[0].length + 240);
      const r = readNames(lineOnly ? rest.split(/\r?\n/)[0] : rest);
      return { formula, phrase: `${m[0]}${r.text}`.replace(/\s+/g, " ").trim(), names: r.names.map((n) => n.join(" ")) };
    });
  return [
    ...read("grantor", text, GRANTOR),
    ...read("grantee", text, PAID_BY),
    ...read("witness", rawText, IN_PRESENCE, true),
    ...read("administrator", text, ADMINISTRATOR),
  ];
}

/**
 * Errors for a document whose labels a phrase in `rawText` contradicts. Land: the
 * grantor, the payer and the witnesses. Probate: the administrator and the
 * estate's owner. Nothing else is read.
 */
export function deedFormulaErrors(doc: StructuredDocument, rawText: string, path: string): string[] {
  const text = rawText.replace(/\s+/g, " ");
  const errs: string[] = [];

  const informative = (hs: Hit[]) => hs.filter((h) => h.parties.length > 0);
  // `mislabelled` picks the parties the error names, so the agent is not told to
  // relabel a party the phrase lists and the labels already agree on.
  const refuseIf = (hs: Hit[], contradicts: (h: Hit) => boolean, what: string, mislabelled: (p: DocumentPerson) => boolean) => {
    const inf = informative(hs);
    if (inf.length === 0 || !inf.every(contradicts)) return;
    const h = inf[0];
    const named = h.parties.filter(mislabelled);
    errs.push(
      `${path}: the transcription says "${h.phrase}", which names ${named.map((p) => partyName(doc, p.id)).join(" and ")} as ${what}, ` +
        `but the document labels ${named.length > 1 ? "them" : "that party"} otherwise. Relabel ${named.length > 1 ? "those parties" : "that party"} by the phrase and resend.`,
    );
  };

  if (doc.recordType === "land") {
    const sides = landSides(doc);
    const kind = (p: DocumentPerson): "grantor" | "grantee" | "witness" | "other" => {
      const s = sides.get(p.id);
      if (s) return s;
      return /^(witness|justice of the peace|register|notary|clerk)\b/.test(str(p.statedRelation).trim().toLowerCase()) ? "witness" : "other";
    };
    refuseIf(
      hitsAfter(doc, text, GRANTOR),
      (h) => !h.parties.some((p) => kind(p) === "grantor") && h.parties.some((p) => kind(p) === "grantee" || kind(p) === "witness"),
      "the grantor",
      (p) => kind(p) === "grantee" || kind(p) === "witness",
    );
    refuseIf(hitsAfter(doc, text, PAID_BY), (h) => h.parties.some((p) => kind(p) === "grantor" || kind(p) === "witness"), "the one paying (the grantee's side)", (p) => kind(p) === "grantor" || kind(p) === "witness");
    const placed = new Set(
      [...hitsAfter(doc, text, GRANTOR), ...hitsAfter(doc, text, PAID_BY)].flatMap((h) => h.parties.map((p) => p.id)),
    );
    refuseIf(
      hitsAfter(doc, rawText, IN_PRESENCE, true).map((h) => ({ ...h, parties: h.parties.filter((p) => !placed.has(p.id)) })),
      (h) => h.parties.some((p) => kind(p) === "grantor" || kind(p) === "grantee"),
      "witnesses",
      (p) => kind(p) === "grantor" || kind(p) === "grantee",
    );
  }

  if (doc.recordType === "probate") {
    const decedent = probateDecedentOrDefault(doc);
    const hs = [...text.matchAll(new RegExp(ADMINISTRATOR.source, ADMINISTRATOR.flags))].map((m) => {
      const admin = readNameBefore(text.slice(0, m.index));
      const estate = readNames(text.slice(m.index! + m[0].length, m.index! + m[0].length + 240));
      return {
        phrase: `${admin ? `${admin.join(" ")} ` : ""}${m[0]}${estate.text}`.replace(/\s+/g, " ").trim(),
        administrator: admin ? partyFor(doc, admin) : undefined,
        owners: [...new Set(estate.names.map((n) => partyFor(doc, n)).filter((p): p is DocumentPerson => !!p))],
      };
    });
    const inf = hs.filter((h) => h.administrator || h.owners.length > 0);
    const bad = (h: (typeof hs)[number]) =>
      h.administrator?.id === decedent || (h.owners.length > 0 && !h.owners.some((p) => p.id === decedent));
    if (decedent !== undefined && inf.length > 0 && inf.every(bad)) {
      errs.push(
        `${path}: the transcription says "${inf[0].phrase}", so the decedent is the estate's owner, ` +
          `but the document makes ${partyName(doc, decedent)} the decedent. Put the probate, will or death fact ` +
          `on the estate's owner and resend.`,
      );
    }
  }
  return errs;
}
