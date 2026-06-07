import { getValidToken } from "../auth/refresh.js";
import { toSimplifiedStandardized } from "../utils/gedcomx-convert.js";
import type {
  GedcomX,
  GedcomXFact,
  GedcomXRelationship,
  SimplifiedGedcomX,
  SimplifiedPerson,
  SimplifiedRelationship,
} from "../types/gedcomx.js";
import type {
  FSChildAndParentsRelationship,
  FSFact,
  FSPerson,
  FSRelationship,
  FSResourceRef,
  FSSourceDescription,
  FSTreeResponse,
  PersonReadResult,
  PersonReadToolInput,
  TreeFact,
  TreePerson,
  TreeRelationship,
  TreeSource,
} from "../types/person-read.js";

const API_BASE = "https://api.familysearch.org/platform/tree/persons";
const ACCEPT_HEADER = "application/x-fs-v1+json";
const MAX_REDIRECTS = 1;
const PARENT_CHILD_URI = "http://gedcomx.org/ParentChild";

// ─── MCP schema ───────────────────────────────────────────────────────────

export const personReadToolSchema = {
  name: "person_read",
  description:
    "Read person data from the FamilySearch Family Tree. " +
    "Returns simplified GEDCOMX (persons, relationships, sources). " +
    "Set relatives=true to include parents, spouses, and children. " +
    "Set sourceDescriptions=true to include attached sources. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      personId: {
        type: "string",
        description: 'FamilySearch person ID (e.g., "KNDX-MKG"). Required.',
      },
      relatives: {
        type: "boolean",
        description: "Include parents, spouses, and children. Defaults to false.",
      },
      sourceDescriptions: {
        type: "boolean",
        description: "Include attached source citations. Defaults to false.",
      },
    },
    required: ["personId"],
  },
} as const;

// ─── Entry point ──────────────────────────────────────────────────────────

export async function personReadTool(input: PersonReadToolInput): Promise<PersonReadResult> {
  const { personId, relatives = false, sourceDescriptions = false } = input;
  if (typeof personId !== "string" || personId.trim() === "") {
    throw new Error(
      "The person_read tool requires a non-empty personId string (e.g., \"KNDX-MKG\").",
    );
  }
  const token = await getValidToken();
  return fetchAndConvert(
    token,
    personId.trim(),
    relatives,
    sourceDescriptions,
    0,
  );
}

async function fetchAndConvert(
  token: string,
  pid: string,
  relatives: boolean,
  sourceDescriptions: boolean,
  redirectsFollowed: number,
): Promise<PersonReadResult> {
  const url = buildUrl(pid, relatives, sourceDescriptions);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: ACCEPT_HEADER,
      "Accept-Language": "en",
    },
    redirect: "manual",
  });

  // 204: living person, no body — return a stub.
  if (res.status === 204) {
    return livingPersonStub(pid);
  }

  // 301: merged. Follow the Location header to the new ID (capped).
  if (res.status === 301) {
    if (redirectsFollowed >= MAX_REDIRECTS) {
      throw new Error(
        `FamilySearch tree API error: redirect loop while resolving ${pid}.`,
      );
    }
    const location = res.headers.get("location");
    const newId = location ? extractPersonId(location) : null;
    if (!newId) {
      throw new Error(
        `FamilySearch tree API error: 301 redirect missing Location header for ${pid}.`,
      );
    }
    return fetchAndConvert(
      token,
      newId,
      relatives,
      sourceDescriptions,
      redirectsFollowed + 1,
    );
  }

  if (res.status === 401) {
    throw new Error(
      "FamilySearch rejected the access token (401). The session may have " +
        "expired or been revoked — call the login tool to re-authenticate.",
    );
  }
  if (res.status === 403) {
    throw new Error(`Person ${pid} is restricted and cannot be viewed.`);
  }
  if (res.status === 404) {
    throw new Error(`Person ${pid} not found in the FamilySearch Family Tree.`);
  }
  if (res.status === 410) {
    throw new Error(
      `Person ${pid} has been deleted from the FamilySearch Family Tree.`,
    );
  }
  if (res.status === 429) {
    throw new Error(
      "FamilySearch rate limit reached. Wait a moment and try again.",
    );
  }
  if (!res.ok) {
    throw new Error(`FamilySearch tree API error: ${res.status}`);
  }

  const body = (await res.json()) as FSTreeResponse;
  return await convertResponse(body, relatives, sourceDescriptions);
}

// ─── URL + helpers ────────────────────────────────────────────────────────

function buildUrl(
  pid: string,
  relatives: boolean,
  sourceDescriptions: boolean,
): string {
  const params: string[] = [];
  if (relatives) params.push("relatives=true");
  if (sourceDescriptions) params.push("sourceDescriptions=true");
  const qs = params.length > 0 ? `?${params.join("&")}` : "";
  return `${API_BASE}/${encodeURIComponent(pid)}${qs}`;
}

function extractPersonId(locationHeader: string): string | null {
  const match = locationHeader.match(/\/persons\/([^/?#]+)/);
  return match ? match[1] : null;
}

function livingPersonStub(pid: string): PersonReadResult {
  return {
    persons: [
      {
        id: pid,
        gender: "Unknown",
        living: true,
        names: [{ given: "", surname: "" }],
      },
    ],
    relationships: [],
    sources: [],
  };
}

// ─── Conversion: FS-extended GEDCOMX → simplified → tree-spec shape ──────

async function convertResponse(
  body: FSTreeResponse,
  relatives: boolean,
  sourceDescriptions: boolean,
): Promise<PersonReadResult> {
  // Pre-process relationships:
  //
  // FamilySearch returns the same parent-child links in two places —
  // bare ParentChild entries in `relationships[]` (no subtype facts)
  // and grouped CAPR entries in `childAndParentsRelationships[]` (with
  // parent1Facts/parent2Facts that carry the subtype). To keep subtype
  // info, drop the bare ParentChild entries and replace them with
  // synthetic ParentChild entries built from CAPRs. Couple entries
  // pass through unchanged so Pascal handles marriage facts.
  const fsRelationships = body.relationships ?? [];
  const coupleEntries = fsRelationships.filter(
    (r) => !isParentChildType(r.type),
  );
  // FS couple refs are `resourceId`-only; `toSimplified` reads `resource`.
  // Normalize before conversion so couple participants aren't dropped.
  const normalizedCouples = coupleEntries.map(normalizeCoupleRelationship);
  const synthesizedRelationships = synthesizeParentChild(
    body.childAndParentsRelationships ?? [],
  );
  const gedcomxInput: GedcomX = {
    persons: body.persons,
    relationships: [...normalizedCouples, ...synthesizedRelationships],
    sourceDescriptions: body.sourceDescriptions,
  };

  const simplified = await toSimplifiedStandardized(gedcomxInput);

  // Post-process: shape the simplified output into the tree-spec types
  // (add `living` from raw, narrow names, filter SD_* metadata sources).
  // Fact-level URI cleanup and value preservation now happen inside
  // toSimplified, so the converter's facts flow straight through.
  return {
    persons: shapePersons(simplified.persons ?? [], body.persons ?? []),
    relationships: relatives
      ? shapeRelationships(simplified.relationships ?? [])
      : [],
    sources: sourceDescriptions
      ? shapeSources(simplified.sources ?? [], body.sourceDescriptions ?? [])
      : [],
  };
}

function isParentChildType(type: string | undefined): boolean {
  if (!type) return false;
  return type === PARENT_CHILD_URI || type.endsWith("/ParentChild");
}

// FS person refs come as either `resource` ("#KNDX-MKG" or an absolute
// URL) or `resourceId` (bare ID). `toSimplified` only reads `resource`,
// so coerce `resourceId` into a `#`-prefixed fragment ref.
function normalizeRef(
  ref: FSResourceRef | undefined,
): { resource: string } | undefined {
  if (!ref) return undefined;
  if (typeof ref.resource === "string" && ref.resource !== "") {
    return { resource: ref.resource };
  }
  if (typeof ref.resourceId === "string" && ref.resourceId !== "") {
    return { resource: `#${ref.resourceId}` };
  }
  return undefined;
}

function normalizeCoupleRelationship(r: FSRelationship): GedcomXRelationship {
  const out: GedcomXRelationship = {};
  if (r.id !== undefined) out.id = r.id;
  if (r.type !== undefined) out.type = r.type;
  const p1 = normalizeRef(r.person1);
  const p2 = normalizeRef(r.person2);
  if (p1) out.person1 = p1;
  if (p2) out.person2 = p2;
  if (r.facts) out.facts = r.facts as GedcomXFact[];
  return out;
}

function synthesizeParentChild(
  caprs: FSChildAndParentsRelationship[],
): GedcomXRelationship[] {
  const out: GedcomXRelationship[] = [];
  for (const capr of caprs) {
    const childId = capr.child?.resourceId;
    if (!childId) continue;
    const parents: Array<{
      ref: { resourceId?: string };
      facts: FSFact[] | undefined;
    }> = [
      { ref: capr.parent1 ?? {}, facts: capr.parent1Facts },
      { ref: capr.parent2 ?? {}, facts: capr.parent2Facts },
    ];
    for (const { ref, facts } of parents) {
      const parentId = ref.resourceId;
      if (!parentId) continue;
      out.push({
        type: PARENT_CHILD_URI,
        person1: { resource: `#${parentId}` },
        person2: { resource: `#${childId}` },
        facts: facts as GedcomXFact[] | undefined,
      });
    }
  }
  return out;
}

// ─── Shape persons ───────────────────────────────────────────────────────

function shapePersons(
  simplifiedPersons: SimplifiedPerson[],
  rawPersons: FSPerson[],
): TreePerson[] {
  const rawById = new Map<string, FSPerson>();
  for (const p of rawPersons) {
    if (p.id) rawById.set(p.id, p);
  }
  const out: TreePerson[] = [];
  for (const sp of simplifiedPersons) {
    const id = sp.id;
    if (!id) continue;
    const raw = rawById.get(id);
    const firstName = sp.names?.[0];
    out.push({
      id,
      gender: sp.gender ?? "Unknown",
      living: raw?.living === true,
      names: [
        {
          given: firstName?.given ?? "",
          surname: firstName?.surname ?? "",
          ...(firstName?.prefix ? { prefix: firstName.prefix } : {}),
          ...(firstName?.suffix ? { suffix: firstName.suffix } : {}),
        },
      ],
      ...(sp.facts && sp.facts.length > 0
        ? { facts: sp.facts.filter((f): f is TreeFact => typeof f.type === "string") }
        : {}),
    });
  }
  return out;
}

// ─── Shape relationships ─────────────────────────────────────────────────

function shapeRelationships(
  simplifiedRelationships: SimplifiedRelationship[],
): TreeRelationship[] {
  const out: TreeRelationship[] = [];
  for (const sr of simplifiedRelationships) {
    if (sr.type === "ParentChild") {
      if (!sr.parent || !sr.child) continue;
      out.push({
        type: "ParentChild",
        parent: extractPersonRef(sr.parent),
        child: extractPersonRef(sr.child),
        ...(sr.subtype ? { subtype: sr.subtype } : {}),
      });
    } else if (sr.type === "Couple") {
      if (!sr.person1 || !sr.person2) continue;
      const rel: TreeRelationship = {
        type: "Couple",
        person1: extractPersonRef(sr.person1),
        person2: extractPersonRef(sr.person2),
      };
      if (sr.facts && sr.facts.length > 0) {
        rel.facts = sr.facts.filter((f): f is TreeFact => typeof f.type === "string");
      }
      out.push(rel);
    }
  }
  return out;
}

// Person refs from FS can be a bare ID ("KNDX-MKG"), a fragment ref
// ("#KNDX-MKG" — handled by Pascal's stripFragment), or an absolute
// URL when the person isn't in this response
// ("https://api.familysearch.org/platform/tree/persons/9Q79-VMQ").
// The spec requires bare IDs; strip the URL prefix to get there.
function extractPersonRef(ref: string): string {
  const slashIdx = ref.lastIndexOf("/");
  return slashIdx >= 0 ? ref.slice(slashIdx + 1) : ref;
}

// ─── Shape sources ───────────────────────────────────────────────────────

function shapeSources(
  simplifiedSources: SimplifiedGedcomX["sources"] = [],
  rawSources: FSSourceDescription[],
): TreeSource[] {
  const rawById = new Map<string, FSSourceDescription>();
  for (const sd of rawSources) {
    if (sd.id) rawById.set(sd.id, sd);
  }
  const out: TreeSource[] = [];
  for (const s of simplifiedSources) {
    const id = s.id;
    if (!id) continue;
    // Skip FS metadata entries.
    if (id.startsWith("SD_")) continue;
    const raw = rawById.get(id);
    const notes = collectNotes(raw?.notes);
    out.push({
      id,
      title: s.title ?? "",
      ...(s.citation !== undefined ? { citation: s.citation } : {}),
      ...(s.url !== undefined ? { url: s.url } : {}),
      ...(notes.length > 0 ? { notes } : {}),
    });
  }
  return out;
}

function collectNotes(
  rawNotes: Array<{ value?: string }> | undefined,
): string[] {
  if (!Array.isArray(rawNotes)) return [];
  const out: string[] = [];
  for (const n of rawNotes) {
    if (typeof n?.value === "string" && n.value !== "") {
      out.push(n.value);
    }
  }
  return out;
}

// Re-export tool input type for index.ts wiring.
export type { PersonReadToolInput };
