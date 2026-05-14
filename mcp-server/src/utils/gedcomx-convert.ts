import type {
  GedcomX,
  GedcomXFact,
  GedcomXName,
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
const EVENT_QUALIFIER = "fsmcp:event";
const RESIDENCE_URI = "http://gedcomx.org/Residence";
const PARENT_CHILD = "ParentChild";
const COUPLE = "Couple";

function stripUri(uri: string | undefined): string | undefined {
  if (typeof uri !== "string") return undefined;
  return uri.startsWith(URI_PREFIX) ? uri.slice(URI_PREFIX.length) : uri;
}

function addUri(value: string | undefined): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  // Pass through anything that already looks like a URI (has a scheme).
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
  if (persons.length > 0) {
    out.persons = persons.map(simplifyPerson);
  }

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
  if (places.length > 0) {
    out.places = places.map(simplifyPlaceDescription);
  }

  return out;
}

function simplifyPerson(person: GedcomXPerson): SimplifiedPerson {
  const out: SimplifiedPerson = {};
  if (person.id !== undefined) out.id = person.id;

  const gender = simplifyGender(person.gender);
  if (gender !== undefined) out.gender = gender;

  if (Array.isArray(person.names) && person.names.length > 0) {
    out.names = person.names.map((name, i) => simplifyName(name, i === 0));
  }

  if (Array.isArray(person.facts) && person.facts.length > 0) {
    out.facts = person.facts.map((fact, i) => simplifyFact(fact, i === 0));
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

function simplifyName(name: GedcomXName, isFirst: boolean): SimplifiedName {
  const out: SimplifiedName = {};
  if (name.id !== undefined) out.id = name.id;
  if (isFirst) out.preferred = true;

  const stripped = stripUri(name.type);
  if (stripped !== undefined) out.type = stripped;

  const form = Array.isArray(name.nameForms) ? name.nameForms[0] : undefined;
  if (form) {
    const parts = Array.isArray(form.parts) ? form.parts : [];
    if (parts.length > 0) {
      const givenPart = parts.find((p) => stripUri(p.type) === "Given");
      const surnamePart = parts.find((p) => stripUri(p.type) === "Surname");
      if (typeof givenPart?.value === "string") out.given = givenPart.value;
      if (typeof surnamePart?.value === "string") {
        out.surname = surnamePart.value;
      }
    } else if (typeof form.fullText === "string" && form.fullText.length > 0) {
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

function simplifyFact(fact: GedcomXFact, isFirst: boolean): SimplifiedFact {
  const out: SimplifiedFact = {};
  if (fact.id !== undefined) out.id = fact.id;

  const stripped = stripUri(fact.type);
  if (stripped !== undefined) out.type = stripped;

  if (isFirst) out.primary = true;

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
    // Couple, or unknown types — preserve person1/person2 positionally
    if (p1 !== undefined) out.person1 = p1;
    if (p2 !== undefined) out.person2 = p2;
  }

  if (Array.isArray(rel.facts) && rel.facts.length > 0) {
    out.facts = rel.facts.map((fact, i) => simplifyFact(fact, i === 0));
  }

  if (Array.isArray(rel.sources) && rel.sources.length > 0) {
    out.sources = rel.sources.map(simplifySourceRef);
  }

  return out;
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
    const n = Number(quality.value);
    if (Number.isFinite(n)) out.quality = n;
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
  if (places.length > 0) {
    out.places = places.map(expandPlaceDescription);
  }

  return out;
}

function expandPerson(person: SimplifiedPerson): GedcomXPerson {
  const out: GedcomXPerson = {};
  if (person.id !== undefined) out.id = person.id;

  const gender = expandGender(person.gender);
  if (gender) out.gender = gender;

  if (Array.isArray(person.names) && person.names.length > 0) {
    const ordered = orderByFlag(person.names, "preferred");
    out.names = ordered.map(expandName);
  }

  if (Array.isArray(person.facts) && person.facts.length > 0) {
    const ordered = orderByFlag(person.facts, "primary");
    out.facts = ordered.map(expandFact);
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
  const typeUri = addUri(name.type);
  if (typeUri !== undefined) out.type = typeUri;

  const given = typeof name.given === "string" ? name.given : "";
  const surname = typeof name.surname === "string" ? name.surname : "";
  const hasGiven = given.length > 0;
  const hasSurname = surname.length > 0;

  if (hasGiven || hasSurname) {
    const fullText = `${given} ${surname}`.trim();
    const parts: { type: string; value: string }[] = [];
    if (hasGiven) parts.push({ type: URI_PREFIX + "Given", value: given });
    if (hasSurname) {
      parts.push({ type: URI_PREFIX + "Surname", value: surname });
    }
    out.nameForms = [{ fullText, parts }];
  }

  if (Array.isArray(name.sources) && name.sources.length > 0) {
    out.sources = name.sources.map(expandSourceRef);
  }

  return out;
}

function expandFact(fact: SimplifiedFact): GedcomXFact {
  const out: GedcomXFact = {};
  if (fact.id !== undefined) out.id = fact.id;

  // Rule 13: Census → Residence + fsmcp:event qualifier
  if (fact.type === "Census") {
    out.type = RESIDENCE_URI;
    out.qualifiers = [{ name: EVENT_QUALIFIER, value: "Census" }];
  } else {
    const typeUri = addUri(fact.type);
    if (typeUri !== undefined) out.type = typeUri;
  }

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

  if (Array.isArray(rel.facts) && rel.facts.length > 0) {
    const ordered = orderByFlag(rel.facts, "primary");
    out.facts = ordered.map(expandFact);
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
  if (typeof ref.quality === "number") {
    qualifiers.push({ name: QUALITY_QUALIFIER, value: String(ref.quality) });
  }
  if (qualifiers.length > 0) out.qualifiers = qualifiers;

  return out;
}

function expandSourceDescription(
  desc: SimplifiedSourceDescription,
): GedcomXSourceDescription {
  const out: GedcomXSourceDescription = {};
  if (desc.id !== undefined) out.id = desc.id;

  if (typeof desc.title === "string") {
    out.titles = [{ value: desc.title }];
  }

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

  if (typeof place.name === "string") {
    out.names = [{ value: place.name }];
  }

  if (typeof place.latitude === "number") out.latitude = place.latitude;
  if (typeof place.longitude === "number") out.longitude = place.longitude;

  return out;
}

// Move entries with a true flag to the front, preserving the relative order
// of the rest. Used to honour the omit-when-false convention on round-trip.
function orderByFlag<T extends { preferred?: boolean; primary?: boolean }>(
  items: T[],
  flag: "preferred" | "primary",
): T[] {
  const flagged = items.filter((item) => item[flag] === true);
  const rest = items.filter((item) => item[flag] !== true);
  return [...flagged, ...rest];
}
