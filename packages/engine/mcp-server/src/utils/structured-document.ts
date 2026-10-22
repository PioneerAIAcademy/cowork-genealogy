// structured-document — the document the record-structurer agent emits, its
// validator, and its adapter onto the code extractor (spec §11.7).
//
// The agent READS an unindexed source (a transcription, a pasted obituary, a
// probate file) and returns this document; everything a document could be
// wrong about in the classification layers is decided by `record-extract.ts`,
// exactly as for a FamilySearch-indexed record. So the document has NO key for
// `record_role`, `record_basis`, `informant_proximity`, `information_quality`,
// `informant`, `source_classification` or `record_persona_id`, and the validator
// refuses any unknown key at every level: a model that tries to classify is
// refused by the schema, not asked by a prompt.
//
// camelCase at the wire, like every tool parameter (CLAUDE.md, "Identifier
// casing"); the GedcomX-subset keys are single words, so none has a casing to get
// wrong.

import type { SimplifiedGedcomX, SimplifiedPerson } from "../types/gedcomx.js";
import type { PersonaIndexFields } from "./record-index-fields.js";
import type { ExtractDocument, RecordType } from "./record-extract.js";

export const DOCUMENT_RECORD_TYPES: readonly RecordType[] = [
  "census",
  "marriage",
  "death",
  "burial",
  "birth",
  "christening",
  "land",
  "draft_registration",
  "obituary",
  "probate",
  "newspaper_announcement",
  "other",
];

export const DOCUMENT_FORMS = [
  "page_image",
  "verbatim_transcript",
  "index_entry",
  "abstract",
  "compiled_work",
] as const;
export type DocumentForm = (typeof DOCUMENT_FORMS)[number];

export interface DocumentName {
  given?: string;
  surname?: string;
  uncertain?: true;
  note?: string;
}

export interface DocumentFact {
  type: string;
  value?: string;
  date?: string;
  place?: string;
  /** Which attributes the text does NOT give: computed, e.g. a year from an age. */
  computed?: ("value" | "date" | "place")[];
  /** The reading is doubted; `[?]` stays in the value. Changes no classification. */
  uncertain?: true;
  note?: string;
}

export interface DocumentPerson {
  id: string;
  principal?: true;
  household?: string;
  names: DocumentName[];
  gender?: "male" | "female";
  statedRelation?: string;
  fatherBirthPlace?: string;
  motherBirthPlace?: string;
  facts: DocumentFact[];
}

export interface StructuredDocument {
  recordType: RecordType;
  recordLabel?: string;
  documentForm: DocumentForm;
  census?: { jurisdiction: string; year: number };
  source: {
    title: string;
    repository: string;
    creator?: string;
    created?: string;
    locator?: string;
    url?: string;
    notes?: string;
  };
  informant?: { name: string; relation?: string };
  persons: DocumentPerson[];
  relationships?: { type: "couple" | "parent_child" | "sibling"; person1: string; person2: string; note?: string }[];
  absentPersons?: { name: string; factType?: string; note?: string }[];
}

// ─── validation ─────────────────────────────────────────────────────────────

const KEYS = {
  document: ["recordType", "recordLabel", "documentForm", "census", "source", "informant", "persons", "relationships", "absentPersons"],
  census: ["jurisdiction", "year"],
  source: ["title", "repository", "creator", "created", "locator", "url", "notes"],
  informant: ["name", "relation"],
  person: ["id", "principal", "household", "names", "gender", "statedRelation", "fatherBirthPlace", "motherBirthPlace", "facts"],
  name: ["given", "surname", "uncertain", "note"],
  fact: ["type", "value", "date", "place", "computed", "uncertain", "note"],
  relationship: ["type", "person1", "person2", "note"],
  absent: ["name", "factType", "note"],
} as const;

/** A stated relation that states the person's sex. Roles split mother from
 *  father on gender, so a parent sent with only `statedRelation: "mother"` is
 *  given the gender the text states. */
const SEX_OF_RELATION: Record<string, "male" | "female"> = {
  father: "male", son: "male", husband: "male", brother: "male",
  mother: "female", daughter: "female", wife: "female", sister: "female",
};

/** Record types with one principal whose stated parents are that principal's. */
const PARENT_EDGE_RECORDS: ReadonlySet<string> = new Set(["christening", "birth", "death", "burial"]);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown) => typeof v === "string" && v.trim() !== "";

/**
 * Every problem with `doc`, each naming its JSON path. An empty list means valid.
 * Refuses, per §11.7: any unknown key at any depth (the classification fields
 * included); an out-of-enum `recordType` or `documentForm`; a census without
 * `census`, or `census` on anything else; a person with no name, or a name with
 * neither part; a relationship naming an unknown id or one person twice; a
 * `computed` entry naming an attribute its fact does not carry; no persons.
 */
export function validateStructuredDocument(doc: unknown, path = "document"): string[] {
  const errs: string[] = [];
  const unknownKeys = (o: Record<string, unknown>, allowed: readonly string[], at: string) => {
    for (const k of Object.keys(o)) {
      if (!allowed.includes(k)) {
        errs.push(`${at}.${k}: not a document field. The document carries what the text says; roles and classifications are decided in code.`);
      }
    }
  };
  if (!isObj(doc)) return [`${path}: must be an object`];
  unknownKeys(doc, KEYS.document, path);

  if (!DOCUMENT_RECORD_TYPES.includes(doc.recordType as RecordType)) {
    errs.push(`${path}.recordType: must be one of ${DOCUMENT_RECORD_TYPES.join(", ")}`);
  }
  if (!(DOCUMENT_FORMS as readonly string[]).includes(doc.documentForm as string)) {
    errs.push(`${path}.documentForm: must be one of ${DOCUMENT_FORMS.join(", ")}`);
  }
  if (doc.recordLabel !== undefined && typeof doc.recordLabel !== "string") errs.push(`${path}.recordLabel: must be a string`);

  if (doc.recordType === "census") {
    if (!isObj(doc.census)) {
      errs.push(`${path}.census: required on a census ({ jurisdiction, year }): it decides whether the schedule had a relationship column`);
    } else {
      unknownKeys(doc.census, KEYS.census, `${path}.census`);
      if (!isStr(doc.census.jurisdiction)) errs.push(`${path}.census.jurisdiction: required`);
      if (typeof doc.census.year !== "number" || !Number.isInteger(doc.census.year)) errs.push(`${path}.census.year: must be an integer year`);
    }
  } else if (doc.census !== undefined) {
    errs.push(`${path}.census: only a census carries a census block`);
  }

  if (!isObj(doc.source)) {
    errs.push(`${path}.source: required ({ title, repository, … })`);
  } else {
    unknownKeys(doc.source, KEYS.source, `${path}.source`);
    if (!isStr(doc.source.title)) errs.push(`${path}.source.title: required`);
    if (!isStr(doc.source.repository)) errs.push(`${path}.source.repository: required`);
  }

  if (doc.informant !== undefined) {
    if (!isObj(doc.informant)) errs.push(`${path}.informant: must be an object`);
    else {
      unknownKeys(doc.informant, KEYS.informant, `${path}.informant`);
      if (!isStr(doc.informant.name)) errs.push(`${path}.informant.name: required`);
    }
  }

  const ids = new Set<string>();
  if (!Array.isArray(doc.persons) || doc.persons.length === 0) {
    errs.push(`${path}.persons: must be a non-empty list`);
  } else {
    doc.persons.forEach((p, i) => {
      const at = `${path}.persons[${i}]`;
      if (!isObj(p)) return errs.push(`${at}: must be an object`);
      unknownKeys(p, KEYS.person, at);
      if (!isStr(p.id)) errs.push(`${at}.id: required`);
      else if (ids.has(p.id as string)) errs.push(`${at}.id: '${p.id}' is used twice`);
      else ids.add(p.id as string);
      if (p.gender !== undefined && p.gender !== "male" && p.gender !== "female") {
        errs.push(`${at}.gender: must be male or female, or omitted`);
      }
      if (p.statedRelation !== undefined && p.statedRelation !== null && typeof p.statedRelation !== "string") {
        errs.push(`${at}.statedRelation: must be a string, or omitted`);
      }
      if (p.principal !== undefined && p.principal !== true) errs.push(`${at}.principal: true, or omitted`);
      if (!Array.isArray(p.names) || p.names.length === 0) {
        errs.push(`${at}.names: every person needs at least one name`);
      } else {
        p.names.forEach((n, j) => {
          const nat = `${at}.names[${j}]`;
          if (!isObj(n)) return errs.push(`${nat}: must be an object`);
          unknownKeys(n, KEYS.name, nat);
          if (!isStr(n.given) && !isStr(n.surname)) errs.push(`${nat}: needs a given name or a surname`);
        });
      }
      if (!Array.isArray(p.facts)) {
        errs.push(`${at}.facts: must be a list (empty when the text gives none)`);
      } else {
        p.facts.forEach((f, j) => {
          const fat = `${at}.facts[${j}]`;
          if (!isObj(f)) return errs.push(`${fat}: must be an object`);
          unknownKeys(f, KEYS.fact, fat);
          if (!isStr(f.type)) errs.push(`${fat}.type: required`);
          if (f.computed !== undefined) {
            if (!Array.isArray(f.computed)) errs.push(`${fat}.computed: must be a list of attributes`);
            else
              for (const c of f.computed) {
                if (c !== "value" && c !== "date" && c !== "place") {
                  errs.push(`${fat}.computed: '${String(c)}' is not an attribute (value, date, place)`);
                } else if (!isStr(f[c])) {
                  errs.push(`${fat}.computed: names '${c}', which this fact does not carry`);
                }
              }
          }
        });
      }
    });
  }

  if (doc.relationships !== undefined) {
    if (!Array.isArray(doc.relationships)) errs.push(`${path}.relationships: must be a list`);
    else
      doc.relationships.forEach((r, i) => {
        const at = `${path}.relationships[${i}]`;
        if (!isObj(r)) return errs.push(`${at}: must be an object`);
        unknownKeys(r, KEYS.relationship, at);
        if (r.type !== "couple" && r.type !== "parent_child" && r.type !== "sibling") {
          errs.push(`${at}.type: must be couple, parent_child or sibling`);
        }
        for (const k of ["person1", "person2"] as const) {
          if (!isStr(r[k]) || !ids.has(r[k] as string)) errs.push(`${at}.${k}: must name a person id in this document`);
        }
        if (isStr(r.person1) && r.person1 === r.person2) errs.push(`${at}: names one person twice`);
      });
  }

  if (doc.absentPersons !== undefined) {
    if (!Array.isArray(doc.absentPersons)) errs.push(`${path}.absentPersons: must be a list`);
    else
      doc.absentPersons.forEach((a, i) => {
        const at = `${path}.absentPersons[${i}]`;
        if (!isObj(a)) return errs.push(`${at}: must be an object`);
        unknownKeys(a, KEYS.absent, at);
        if (!isStr(a.name)) errs.push(`${at}.name: required`);
      });
  }
  return errs;
}

// ─── adapter onto the extractor ─────────────────────────────────────────────

/** What document mode tells `extractRecord` that a sidecar cannot. */
export interface DocumentMode {
  recordType: RecordType;
  /** `null` when a census's jurisdiction is not in the year table. */
  censusStates?: boolean | null;
  /** Probate: the file holds a will (testator) rather than an intestate petition (decedent). */
  hasWill?: boolean;
  informantName?: string;
  /** person id -> the text's own relation word. */
  statedRelations: Map<string, string>;
  /** `${personId}#${factIndex}` -> the fact's marks. */
  factMarks: Map<string, { computed: string[]; note?: string; uncertain?: true }>;
  /** person id -> a note on the name reading. */
  nameNotes: Map<string, string>;
  /** The year of the event the source is about (the death on an obituary). */
  eventYear?: number;
  /** The principal's event fact type, snake_case (`death`, `marriage`, `birth`…). */
  eventType?: string;
}

const PRINCIPAL_EVENT: Partial<Record<RecordType, RegExp>> = {
  obituary: /^death$/,
  newspaper_announcement: /^(birth|marriage|engagement|anniversary)$/,
  probate: /^death$/,
};

/** `uncertain: true` on a name means the reading keeps its `[?]`; an agent that
 *  sets the flag and drops the marker still gets one. A fact's flag rides
 *  `factMarks` and is applied to the assertion's value in the extractor. */
const markDoubted = (s: string) => `${s} [?]`;

const yearOf = (v: string | undefined) => {
  const m = String(v ?? "").match(/\d{4}/);
  return m ? Number(m[0]) : undefined;
};

/**
 * The document as the `ExtractDocument` the extractor already reads, plus the
 * `DocumentMode` carrying what a sidecar has no field for. Assumes a document
 * `validateStructuredDocument` passed.
 */
export function documentToExtract(
  recordId: string,
  doc: StructuredDocument,
  censusStatedRelationships: (place: string | undefined, year: number | undefined) => boolean | null,
): { extract: ExtractDocument; mode: DocumentMode } {
  const statedRelations = new Map<string, string>();
  const factMarks = new Map<string, { computed: string[]; note?: string; uncertain?: true }>();
  const nameNotes = new Map<string, string>();
  const indexFields: Record<string, PersonaIndexFields> = {};

  const persons: SimplifiedPerson[] = doc.persons.map((p, i) => {
    if (p.statedRelation) statedRelations.set(p.id, p.statedRelation);
    const nameNote = p.names.map((n) => n.note).filter(Boolean).join("; ");
    if (nameNote) nameNotes.set(p.id, nameNote);
    p.facts.forEach((f, j) => {
      if ((f.computed && f.computed.length) || f.note || f.uncertain) {
        factMarks.set(`${p.id}#${j}`, {
          computed: [...(f.computed ?? [])],
          ...(f.note ? { note: f.note } : {}),
          ...(f.uncertain ? { uncertain: true as const } : {}),
        });
      }
    });
    const fields: PersonaIndexFields = {
      sortKey: String(i).padStart(6, "0"),
      householdId: p.household ?? "1",
      // A census's relationship-to-head column is the only relation the
      // extractor reads off `indexFields`; whether the schedule HAD that column
      // is the year table's call, never the document's.
      ...(doc.recordType === "census" && p.statedRelation ? { relationshipToHead: p.statedRelation } : {}),
      ...(p.fatherBirthPlace ? { fatherBirthPlace: p.fatherBirthPlace } : {}),
      ...(p.motherBirthPlace ? { motherBirthPlace: p.motherBirthPlace } : {}),
    };
    indexFields[p.id] = fields;
    const gender = p.gender ?? SEX_OF_RELATION[p.statedRelation?.trim().toLowerCase() ?? ""];
    return {
      id: p.id,
      ...(p.principal ? { principal: true } : {}),
      ...(gender ? { gender: gender === "male" ? "Male" : "Female" } : {}),
      names: p.names.map((n) => {
        const doubted = n.uncertain && ![n.given, n.surname].some((s) => s?.includes("[?]"));
        return {
          ...(n.given ? { given: doubted && !n.surname ? markDoubted(n.given) : n.given } : {}),
          ...(n.surname ? { surname: doubted ? markDoubted(n.surname) : n.surname } : {}),
        };
      }),
      facts: p.facts.map((f) => ({
        type: f.type,
        ...(f.value !== undefined ? { value: f.value } : {}),
        ...(f.date !== undefined ? { date: f.date } : {}),
        ...(f.place !== undefined ? { place: f.place } : {}),
      })),
    } as SimplifiedPerson;
  });

  const relationships = (doc.relationships ?? []).map((r) =>
    r.type === "parent_child"
      ? { type: "http://gedcomx.org/ParentChild", parent: r.person1, child: r.person2 }
      : { type: r.type === "couple" ? "http://gedcomx.org/Couple" : "http://gedcomx.org/Sibling", person1: r.person1, person2: r.person2 },
  ) as { type: string; parent?: string; child?: string; person1?: string; person2?: string }[];
  // `statedRelation` is the relation to the principal, so on a vital record
  // with exactly one flagged principal a stated father or mother with no edge
  // is that principal's parent: the edge is added rather than the parent left
  // tied to no one. With no flag there is no principal to tie them to.
  const flagged = doc.persons.filter((p) => p.principal);
  if (PARENT_EDGE_RECORDS.has(doc.recordType) && flagged.length === 1) {
    const principalId = flagged[0].id;
    for (const p of doc.persons) {
      const rel = p.statedRelation?.trim().toLowerCase();
      if (p.id === principalId || (rel !== "father" && rel !== "mother")) continue;
      if (relationships.some((r) => r.type === "http://gedcomx.org/ParentChild" && r.parent === p.id)) continue;
      relationships.push({ type: "http://gedcomx.org/ParentChild", parent: p.id, child: principalId });
    }
  }

  const gedcomx = {
    sources: [{ resource_type: "http://gedcomx.org/Collection", title: doc.source.title }],
    persons,
    relationships,
  } as unknown as SimplifiedGedcomX;

  const principals = doc.persons.filter((p) => p.principal);
  const principal = principals[0] ?? doc.persons[0];
  const eventRe = PRINCIPAL_EVENT[doc.recordType];
  const events = eventRe ? principal?.facts.filter((f) => eventRe.test(f.type.toLowerCase())) ?? [] : [];
  // A pair event beats a birth, for any number of principals: a wedding notice
  // that also gives the groom's birthplace is not a birth announcement, so the
  // order the agent sent the facts in does not decide it. Among pair events,
  // the one every principal carries wins.
  const allCarry = (f: (typeof events)[number]) =>
    principals.slice(1).every((o) => o.facts.some((g) => g.type.toLowerCase() === f.type.toLowerCase()));
  const pairs = events.filter((f) => f.type.toLowerCase() !== "birth");
  const eventFact = pairs.find(allCarry) ?? pairs[0] ?? events[0];
  const eventYear = yearOf(eventFact?.date);

  const hasWill =
    doc.recordType === "probate"
      ? /\bwill\b|testament/i.test(doc.recordLabel ?? "") ||
        doc.persons.some((p) => p.facts.some((f) => /^(will|will_execution|testament)$/i.test(f.type)))
      : undefined;

  return {
    extract: { recordId, gedcomx, indexFields },
    mode: {
      recordType: doc.recordType,
      ...(doc.recordType === "census"
        ? { censusStates: censusStatedRelationships(doc.census?.jurisdiction, doc.census?.year) }
        : {}),
      ...(hasWill !== undefined ? { hasWill } : {}),
      ...(doc.informant?.name ? { informantName: doc.informant.name } : {}),
      statedRelations,
      factMarks,
      nameNotes,
      ...(eventYear !== undefined ? { eventYear } : {}),
      ...(eventFact ? { eventType: eventFact.type.toLowerCase() } : {}),
    },
  };
}
