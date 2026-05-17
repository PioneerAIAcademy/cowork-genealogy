import type {
  GedcomX,
  GedcomXFact,
  GedcomXName,
  GedcomXNamePart,
  GedcomXNote,
  GedcomXPerson,
  GedcomXPlaceDescription,
  GedcomXQualifier,
  GedcomXRelationship,
  GedcomXSourceDescription,
  GedcomXSourceReference,
  SimplifiedFact,
  SimplifiedGedcomX,
  SimplifiedName,
  SimplifiedPerson,
  SimplifiedPlaceDescription,
  SimplifiedRelationship,
  SimplifiedSourceDescription,
  SimplifiedSourceReference,
} from "../types/gedcomx.js";

const URI_PREFIX = "http://gedcomx.org/";
const CITATION_DETAIL = "http://gedcomx.org/CitationDetail";
const QUALITY_QUALIFIER = "fsmcp:quality";
const PERSISTENT_ID = "http://gedcomx.org/Persistent";
const PARENT_CHILD = "ParentChild";

type NamePartKind = "Prefix" | "Given" | "Surname" | "Suffix";
const KNOWN_NAME_PARTS: readonly NamePartKind[] = [
  "Prefix",
  "Given",
  "Surname",
  "Suffix",
];

// Parent-child relationship subtypes. The simplified short name drops the
// "Parent" suffix from the GedcomX URI because the parent-child context is
// implicit on a ParentChild relationship.
const SUBTYPE_URIS: readonly string[] = [
  URI_PREFIX + "BiologicalParent",
  URI_PREFIX + "AdoptiveParent",
  URI_PREFIX + "StepParent",
  URI_PREFIX + "FosterParent",
  URI_PREFIX + "GuardianParent",
];

function uriToSubtype(uri: string): string | undefined {
  if (!SUBTYPE_URIS.includes(uri)) return undefined;
  // Strip "http://gedcomx.org/" prefix and "Parent" suffix.
  return uri.slice(URI_PREFIX.length, -"Parent".length);
}

function subtypeToUri(subtype: string): string {
  return URI_PREFIX + subtype + "Parent";
}

function stripUri(uri: string | undefined): string | undefined {
  if (typeof uri !== "string") return undefined;
  return uri.startsWith(URI_PREFIX) ? uri.slice(URI_PREFIX.length) : uri;
}

function addUri(value: string | undefined): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return URI_PREFIX + value;
}

function stripFragment(ref: string | undefined): string | undefined {
  if (typeof ref !== "string") return undefined;
  return ref.startsWith("#") ? ref.slice(1) : ref;
}

function addFragment(id: string | undefined): string | undefined {
  if (typeof id !== "string" || id === "") return undefined;
  return id.startsWith("#") ? id : "#" + id;
}

// ─── toSimplified ─────────────────────────────────────────────────────────

export function toSimplified(gedcomx: GedcomX): SimplifiedGedcomX {
  if (!gedcomx || typeof gedcomx !== "object") return {};

  const out: SimplifiedGedcomX = {};

  const persons = Array.isArray(gedcomx.persons) ? gedcomx.persons : [];
  if (persons.length > 0) out.persons = persons.map(simplifyPerson);

  const relationships = Array.isArray(gedcomx.relationships)
    ? gedcomx.relationships
    : [];
  if (relationships.length > 0) {
    out.relationships = relationships.map(simplifyRelationship);
  }

  const sourceDescriptions = Array.isArray(gedcomx.sourceDescriptions)
    ? gedcomx.sourceDescriptions
    : [];
  if (sourceDescriptions.length > 0) {
    out.sources = sourceDescriptions.map(simplifySourceDescription);
  }

  const places = Array.isArray(gedcomx.places) ? gedcomx.places : [];
  if (places.length > 0) out.places = places.map(simplifyPlaceDescription);

  return out;
}

function simplifyPerson(person: GedcomXPerson): SimplifiedPerson {
  const out: SimplifiedPerson = {};
  if (person.id !== undefined) out.id = person.id;

  // Lift the first Persistent identifier (the canonical FamilySearch ARK
  // URL) to a flat `ark` field, mirroring how the spec flattens other
  // single-dominant-value structures (date, place, title). Other
  // identifier types (Primary, Authority, etc.) are dropped — only
  // Persistent is needed by downstream tools.
  const persistent = person.identifiers?.[PERSISTENT_ID];
  if (Array.isArray(persistent) && typeof persistent[0] === "string" && persistent[0].length > 0) {
    out.ark = persistent[0];
  }

  const gender = simplifyGender(person.gender);
  if (gender !== undefined) out.gender = gender;

  if (Array.isArray(person.names) && person.names.length > 0) {
    out.names = person.names.map(simplifyName);
  }

  if (Array.isArray(person.facts) && person.facts.length > 0) {
    out.facts = person.facts.map(simplifyFact);
  }

  if (Array.isArray(person.sources) && person.sources.length > 0) {
    out.sources = person.sources.map(simplifySourceRef);
  }

  return out;
}

function simplifyGender(
  gender: GedcomXPerson["gender"],
): string | undefined {
  if (!gender || typeof gender !== "object") return undefined;
  const type = (gender as { type?: unknown }).type;
  if (typeof type !== "string") return "Unknown";
  if (type === URI_PREFIX + "Male") return "Male";
  if (type === URI_PREFIX + "Female") return "Female";
  return "Unknown";
}

function simplifyName(name: GedcomXName): SimplifiedName {
  const out: SimplifiedName = {};
  if (name.id !== undefined) out.id = name.id;
  if (name.preferred === true) out.preferred = true;

  const stripped = stripUri(name.type);
  if (stripped !== undefined) out.type = stripped;

  const form = Array.isArray(name.nameForms) ? name.nameForms[0] : undefined;
  if (form) {
    const parts = Array.isArray(form.parts) ? form.parts : [];
    if (parts.length > 0) {
      assignPartsToSimplified(parts, out);
    } else if (typeof form.fullText === "string" && form.fullText.length > 0) {
      console.warn(
        `gedcomx-convert: name has no parts; falling back to fullText split for "${form.fullText}". ` +
          `Latin double-surnames may misclassify.`,
      );
      const text = form.fullText.trim();
      const lastSpace = text.lastIndexOf(" ");
      if (lastSpace === -1) {
        out.given = "";
        out.surname = text;
      } else {
        out.given = text.slice(0, lastSpace);
        out.surname = text.slice(lastSpace + 1);
      }
    }
  }

  if (Array.isArray(name.sources) && name.sources.length > 0) {
    out.sources = name.sources.map(simplifySourceRef);
  }

  return out;
}

function assignPartsToSimplified(
  parts: GedcomXNamePart[],
  out: SimplifiedName,
): void {
  for (const part of parts) {
    const kind = stripUri(part.type);
    if (kind === undefined) continue;
    if (!isKnownNamePart(kind)) {
      console.warn(
        `gedcomx-convert: unknown namePart.type "${kind}" (full URI: "${part.type}"). ` +
          `Recognized types: ${KNOWN_NAME_PARTS.join(", ")}.`,
      );
      continue;
    }
    if (typeof part.value !== "string") continue;
    // First occurrence wins — subsequent duplicates are ignored.
    const field = kind.toLowerCase() as "prefix" | "given" | "surname" | "suffix";
    if (out[field] === undefined) out[field] = part.value;
  }
}

function isKnownNamePart(kind: string): kind is NamePartKind {
  return (KNOWN_NAME_PARTS as readonly string[]).includes(kind);
}

function simplifyFact(fact: GedcomXFact): SimplifiedFact {
  const out: SimplifiedFact = {};
  if (fact.id !== undefined) out.id = fact.id;

  const stripped = stripUri(fact.type);
  if (stripped !== undefined) out.type = stripped;

  if (fact.primary === true) out.primary = true;

  if (fact.date && typeof fact.date.original === "string") {
    out.date = fact.date.original;
  }

  if (fact.place && typeof fact.place.original === "string") {
    out.place = fact.place.original;
  }

  if (Array.isArray(fact.sources) && fact.sources.length > 0) {
    out.sources = fact.sources.map(simplifySourceRef);
  }

  return out;
}

function simplifyRelationship(
  rel: GedcomXRelationship,
): SimplifiedRelationship {
  const out: SimplifiedRelationship = {};
  if (rel.id !== undefined) out.id = rel.id;

  const stripped = stripUri(rel.type);
  if (stripped !== undefined) out.type = stripped;

  const p1 = stripFragment(rel.person1?.resource);
  const p2 = stripFragment(rel.person2?.resource);

  if (stripped === PARENT_CHILD) {
    if (p1 !== undefined) out.parent = p1;
    if (p2 !== undefined) out.child = p2;
  } else {
    if (p1 !== undefined) out.person1 = p1;
    if (p2 !== undefined) out.person2 = p2;
  }

  // For ParentChild only: lift the first recognized subtype-fact out of
  // facts[] and surface it on `subtype`. Other facts pass through.
  const inputFacts = Array.isArray(rel.facts) ? rel.facts : [];
  let remainingFacts: GedcomXFact[] = inputFacts;
  if (stripped === PARENT_CHILD && inputFacts.length > 0) {
    const subtypeIndex = inputFacts.findIndex(
      (f) => typeof f.type === "string" && uriToSubtype(f.type) !== undefined,
    );
    if (subtypeIndex !== -1) {
      const subtypeFact = inputFacts[subtypeIndex];
      out.subtype = uriToSubtype(subtypeFact.type as string);
      remainingFacts = inputFacts.filter((_, i) => i !== subtypeIndex);
    }
  }
  if (remainingFacts.length > 0) {
    out.facts = remainingFacts.map(simplifyFact);
  }

  const notes = simplifyNotes(rel.notes);
  if (notes !== undefined) out.notes = notes;

  if (Array.isArray(rel.sources) && rel.sources.length > 0) {
    out.sources = rel.sources.map(simplifySourceRef);
  }

  return out;
}

function simplifyNotes(notes: GedcomXNote[] | undefined): string[] | undefined {
  if (!Array.isArray(notes) || notes.length === 0) return undefined;
  const out: string[] = [];
  for (const note of notes) {
    if (typeof note?.text === "string") out.push(note.text);
  }
  return out.length > 0 ? out : undefined;
}

function simplifySourceRef(
  ref: GedcomXSourceReference,
): SimplifiedSourceReference {
  const out: SimplifiedSourceReference = {};
  const refId = stripFragment(ref.description);
  if (refId !== undefined) out.ref = refId;

  const qualifiers = Array.isArray(ref.qualifiers) ? ref.qualifiers : [];
  const citationDetail = qualifiers.find((q) => q.name === CITATION_DETAIL);
  if (typeof citationDetail?.value === "string") {
    out.page = citationDetail.value;
  }

  const quality = qualifiers.find((q) => q.name === QUALITY_QUALIFIER);
  if (quality && typeof quality.value === "string") {
    out.quality = quality.value;
  }

  return out;
}

function simplifySourceDescription(
  desc: GedcomXSourceDescription,
): SimplifiedSourceDescription {
  const out: SimplifiedSourceDescription = {};
  if (desc.id !== undefined) out.id = desc.id;

  if (Array.isArray(desc.titles) && desc.titles.length > 0) {
    out.title = desc.titles[0].value;
  }

  if (Array.isArray(desc.citations) && desc.citations.length > 0) {
    out.citation = desc.citations[0].value;
  }

  if (typeof desc.about === "string") out.url = desc.about;

  return out;
}

function simplifyPlaceDescription(
  place: GedcomXPlaceDescription,
): SimplifiedPlaceDescription {
  const out: SimplifiedPlaceDescription = {};
  if (place.id !== undefined) out.id = place.id;

  if (Array.isArray(place.names) && place.names.length > 0) {
    out.name = place.names[0].value;
  }

  if (typeof place.latitude === "number") out.latitude = place.latitude;
  if (typeof place.longitude === "number") out.longitude = place.longitude;

  return out;
}

// ─── toGedcomX ────────────────────────────────────────────────────────────

export function toGedcomX(simplified: SimplifiedGedcomX): GedcomX {
  if (!simplified || typeof simplified !== "object") return {};

  const out: GedcomX = {};

  const persons = Array.isArray(simplified.persons) ? simplified.persons : [];
  if (persons.length > 0) out.persons = persons.map(expandPerson);

  const relationships = Array.isArray(simplified.relationships)
    ? simplified.relationships
    : [];
  if (relationships.length > 0) {
    out.relationships = relationships.map(expandRelationship);
  }

  const sources = Array.isArray(simplified.sources) ? simplified.sources : [];
  if (sources.length > 0) {
    out.sourceDescriptions = sources.map(expandSourceDescription);
  }

  const places = Array.isArray(simplified.places) ? simplified.places : [];
  if (places.length > 0) out.places = places.map(expandPlaceDescription);

  return out;
}

function expandPerson(person: SimplifiedPerson): GedcomXPerson {
  const out: GedcomXPerson = {};
  if (person.id !== undefined) out.id = person.id;

  // Rebuild the GedcomX identifiers map from the flat `ark` field.
  if (typeof person.ark === "string" && person.ark.length > 0) {
    out.identifiers = { [PERSISTENT_ID]: [person.ark] };
  }

  const gender = expandGender(person.gender);
  if (gender) out.gender = gender;

  if (Array.isArray(person.names) && person.names.length > 0) {
    out.names = person.names.map(expandName);
  }

  if (Array.isArray(person.facts) && person.facts.length > 0) {
    out.facts = person.facts.map(expandFact);
  }

  if (Array.isArray(person.sources) && person.sources.length > 0) {
    out.sources = person.sources.map(expandSourceRef);
  }

  return out;
}

function expandGender(
  gender: string | undefined,
): GedcomXPerson["gender"] | undefined {
  if (!gender || gender === "Unknown") return undefined;
  return { type: URI_PREFIX + gender };
}

function expandName(name: SimplifiedName): GedcomXName {
  const out: GedcomXName = {};
  if (name.id !== undefined) out.id = name.id;
  if (name.preferred === true) out.preferred = true;

  const typeUri = addUri(name.type);
  if (typeUri !== undefined) out.type = typeUri;

  const orderedFields: NamePartKind[] = ["Prefix", "Given", "Surname", "Suffix"];
  const partsToEmit: { type: string; value: string }[] = [];
  const textPieces: string[] = [];

  for (const kind of orderedFields) {
    const field = kind.toLowerCase() as "prefix" | "given" | "surname" | "suffix";
    const value = name[field];
    if (typeof value !== "string" || value.length === 0) continue;
    partsToEmit.push({ type: URI_PREFIX + kind, value });
    textPieces.push(value);
  }

  if (partsToEmit.length > 0) {
    out.nameForms = [
      {
        fullText: textPieces.join(" "),
        parts: partsToEmit,
      },
    ];
  }

  if (Array.isArray(name.sources) && name.sources.length > 0) {
    out.sources = name.sources.map(expandSourceRef);
  }

  return out;
}

function expandFact(fact: SimplifiedFact): GedcomXFact {
  const out: GedcomXFact = {};
  if (fact.id !== undefined) out.id = fact.id;

  const typeUri = addUri(fact.type);
  if (typeUri !== undefined) out.type = typeUri;

  if (fact.primary === true) out.primary = true;

  if (typeof fact.date === "string") out.date = { original: fact.date };
  if (typeof fact.place === "string") out.place = { original: fact.place };

  if (Array.isArray(fact.sources) && fact.sources.length > 0) {
    out.sources = fact.sources.map(expandSourceRef);
  }

  return out;
}

function expandRelationship(
  rel: SimplifiedRelationship,
): GedcomXRelationship {
  const out: GedcomXRelationship = {};
  if (rel.id !== undefined) out.id = rel.id;
  const typeUri = addUri(rel.type);
  if (typeUri !== undefined) out.type = typeUri;

  if (rel.type === PARENT_CHILD) {
    const p1 = addFragment(rel.parent);
    const p2 = addFragment(rel.child);
    if (p1 !== undefined) out.person1 = { resource: p1 };
    if (p2 !== undefined) out.person2 = { resource: p2 };
  } else {
    const p1 = addFragment(rel.person1);
    const p2 = addFragment(rel.person2);
    if (p1 !== undefined) out.person1 = { resource: p1 };
    if (p2 !== undefined) out.person2 = { resource: p2 };
  }

  // For ParentChild only: if a subtype is set, prepend a subtype-fact to
  // the GedcomX facts[] array. Other facts retain their original order.
  const expandedFacts: GedcomXFact[] = [];
  if (rel.type === PARENT_CHILD && typeof rel.subtype === "string") {
    expandedFacts.push({ type: subtypeToUri(rel.subtype) });
  }
  if (Array.isArray(rel.facts) && rel.facts.length > 0) {
    for (const f of rel.facts) expandedFacts.push(expandFact(f));
  }
  if (expandedFacts.length > 0) out.facts = expandedFacts;

  if (Array.isArray(rel.notes) && rel.notes.length > 0) {
    out.notes = rel.notes.map((text) => ({ text }));
  }

  if (Array.isArray(rel.sources) && rel.sources.length > 0) {
    out.sources = rel.sources.map(expandSourceRef);
  }

  return out;
}

function expandSourceRef(
  ref: SimplifiedSourceReference,
): GedcomXSourceReference {
  const out: GedcomXSourceReference = {};
  const desc = addFragment(ref.ref);
  if (desc !== undefined) out.description = desc;

  const qualifiers: GedcomXQualifier[] = [];
  if (typeof ref.page === "string") {
    qualifiers.push({ name: CITATION_DETAIL, value: ref.page });
  }
  if (typeof ref.quality === "string") {
    qualifiers.push({ name: QUALITY_QUALIFIER, value: ref.quality });
  }
  if (qualifiers.length > 0) out.qualifiers = qualifiers;

  return out;
}

function expandSourceDescription(
  desc: SimplifiedSourceDescription,
): GedcomXSourceDescription {
  const out: GedcomXSourceDescription = {};
  if (desc.id !== undefined) out.id = desc.id;

  if (typeof desc.title === "string") out.titles = [{ value: desc.title }];
  if (typeof desc.citation === "string") {
    out.citations = [{ value: desc.citation }];
  }
  if (typeof desc.url === "string") out.about = desc.url;

  return out;
}

function expandPlaceDescription(
  place: SimplifiedPlaceDescription,
): GedcomXPlaceDescription {
  const out: GedcomXPlaceDescription = {};
  if (place.id !== undefined) out.id = place.id;

  if (typeof place.name === "string") out.names = [{ value: place.name }];
  if (typeof place.latitude === "number") out.latitude = place.latitude;
  if (typeof place.longitude === "number") out.longitude = place.longitude;

  return out;
}
