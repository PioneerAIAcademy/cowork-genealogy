import { getValidToken } from "../auth/refresh.js";
import { toSimplifiedStandardized } from "../utils/gedcomx-convert.js";
import { parseUpstreamErrorBody } from "../utils/search-helpers.js";
import type { GedcomX, SimplifiedRelationship } from "../types/gedcomx.js";
import type {
  AncestorPerson,
  FSAncestryResponse,
  FSCurrentUserResponse,
  PersonAncestorsInput,
  PersonAncestorsResult,
} from "../types/person-ancestors.js";

const API_BASE = "https://api.familysearch.org/platform/tree/ancestry";
const FS_CURRENT_USER_URL =
  "https://api.familysearch.org/platform/users/current";
const ACCEPT_HEADER = "application/x-fs-v1+json";
const MAX_REDIRECTS = 1;
const DEFAULT_GENERATIONS = 3;
const MIN_GENERATIONS = 1;
const MAX_GENERATIONS = 8;

// ─── MCP schema ───────────────────────────────────────────────────────────

export const personAncestorsToolSchema = {
  name: "person_ancestors",
  description:
    "Read a person's ancestors (pedigree) from the FamilySearch Family Tree. " +
    "Given a tree-person ID, returns that person plus up to N generations of " +
    "ancestors as simplified GEDCOMX, each tagged with an ascendancyNumber " +
    "(Ahnentafel position: 1 = the person, 2 = father, 3 = mother, 2n/2n+1 = " +
    "that person's parents; the -S suffix marks a spouse). Set generations " +
    "(1-8, default 3) for depth, personDetails: true for full birth/death " +
    "facts on each ancestor, marriageDetails: true for marriage facts between " +
    "couples. If personId is omitted, returns the CURRENT logged-in user's " +
    "own ancestors. For any OTHER (named) person, first call person_search " +
    "to get their personId — do NOT omit personId for someone other than " +
    "the user. Requires authentication — call the login tool first if not " +
    "logged in.",
  inputSchema: {
    type: "object",
    properties: {
      personId: {
        type: "string",
        description:
          'FamilySearch tree-person ID of the root person (e.g. "LZJW-C31"). ' +
          "Optional — omit to use the logged-in user's own tree person " +
          "(returns the user and their ancestors). Omit ONLY for " +
          "self-requests; for a named person, resolve their ID with " +
          "person_search first.",
      },
      generations: {
        type: "number",
        description:
          "Generations of ancestors to return above the root. Integer 1-8. Defaults to 3.",
      },
      spouse: {
        type: "string",
        description:
          'Also include this spouse\'s ancestry. A spouse tree-person ID, or "UNKNOWN" to let FamilySearch choose the spouse.',
      },
      personDetails: {
        type: "boolean",
        description:
          "When true, include a full facts array (Birth, Death, ...) on each person. Defaults to false (name, gender, and ascendancyNumber only — no dates).",
      },
      marriageDetails: {
        type: "boolean",
        description:
          "When true, include relationships (Couple entries with marriage facts) between the ancestral couples. Defaults to false.",
      },
      descendants: {
        type: "boolean",
        description:
          "When true, include additional descendant detail for persons in the pedigree. Defaults to false.",
      },
    },
  },
} as const;

// ─── Entry point ──────────────────────────────────────────────────────────

export async function personAncestorsTool(
  input: PersonAncestorsInput,
): Promise<PersonAncestorsResult> {
  validateInput(input);
  const token = await getValidToken();
  // Resolve the root: the supplied personId, or the logged-in user's own
  // tree person when it's omitted/empty.
  const provided =
    typeof input.personId === "string" ? input.personId.trim() : "";
  const pid = provided !== "" ? provided : await getCurrentUserPersonId(token);
  return fetchAndMap(token, input, pid, 0);
}

function validateInput(input: PersonAncestorsInput): void {
  // personId is optional (omit → current user); only generations is checked.
  const { generations } = input;
  if (generations !== undefined) {
    if (
      !Number.isInteger(generations) ||
      generations < MIN_GENERATIONS ||
      generations > MAX_GENERATIONS
    ) {
      throw new Error("generations must be an integer between 1 and 8.");
    }
  }
}

// Resolve the logged-in user's own tree person when no personId is given.
// Reads ONLY users[0].personId from /platform/users/current — never the
// account PII (helperAccessPin, birthDate, ...) the endpoint also returns.
// Inline here for the single caller; promote to src/auth/ if a second tool
// needs it.
async function getCurrentUserPersonId(token: string): Promise<string> {
  const res = await fetch(FS_CURRENT_USER_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: ACCEPT_HEADER,
    },
  });
  if (res.status === 401) {
    throw new Error(
      "FamilySearch rejected the access token (401). The session may have " +
        "expired or been revoked — call the login tool to re-authenticate.",
    );
  }
  if (!res.ok) {
    throw new Error(
      `FamilySearch could not read your current user: HTTP ${res.status}.`,
    );
  }
  const body = (await res.json()) as FSCurrentUserResponse;
  const personId = body.users?.[0]?.personId;
  if (typeof personId !== "string" || personId.trim() === "") {
    // "Partial user data when Tree Data is unavailable" — no linked person.
    throw new Error(
      "Could not determine your FamilySearch tree person (your account may " +
        "not be linked to one). Pass a personId explicitly.",
    );
  }
  return personId.trim();
}

// ─── Fetch + status handling (mirrors person_read's host contract) ─────────

async function fetchAndMap(
  token: string,
  input: PersonAncestorsInput,
  pid: string,
  redirectsFollowed: number,
): Promise<PersonAncestorsResult> {
  const url = buildUrl(input, pid);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: ACCEPT_HEADER,
    },
    redirect: "manual",
  });

  // 204: no pedigree available — return an empty graph.
  if (res.status === 204) {
    return { persons: [] };
  }

  // 301: person merged. Follow the Location header to the new ID (capped).
  if (res.status === 301) {
    if (redirectsFollowed >= MAX_REDIRECTS) {
      throw new Error(
        `FamilySearch ancestry API error: redirect loop while resolving ${pid}.`,
      );
    }
    const location = res.headers.get("location");
    const newId = location ? extractPersonId(location) : null;
    if (!newId) {
      throw new Error(
        `FamilySearch ancestry API error: 301 redirect missing Location header for ${pid}.`,
      );
    }
    return fetchAndMap(token, input, newId, redirectsFollowed + 1);
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
  if (res.status === 400) {
    let detail: string | null = null;
    try {
      detail = parseUpstreamErrorBody(await res.json());
    } catch {
      detail = null;
    }
    throw new Error(
      `FamilySearch ancestry request rejected: ${detail ?? "HTTP 400"}.`,
    );
  }
  if (res.status === 429) {
    throw new Error(
      "FamilySearch rate limit reached. Wait a moment and try again.",
    );
  }
  if (!res.ok) {
    throw new Error(`FamilySearch ancestry API error: ${res.status}.`);
  }

  const body = (await res.json()) as FSAncestryResponse;
  return await mapResponse(body, input.marriageDetails === true);
}

// ─── URL builder ────────────────────────────────────────────────────────────

function buildUrl(input: PersonAncestorsInput, pid: string): string {
  const params: string[] = [`person=${encodeURIComponent(pid)}`];
  const generations = input.generations ?? DEFAULT_GENERATIONS;
  params.push(`generations=${generations}`);
  if (input.spouse) params.push(`spouse=${encodeURIComponent(input.spouse)}`);
  if (input.personDetails) params.push("personDetails=true");
  if (input.marriageDetails) params.push("marriageDetails=true");
  if (input.descendants) params.push("descendants=true");
  return `${API_BASE}?${params.join("&")}`;
}

// ─── Mapping: FS ancestry → simplified graph + ascendancyNumber ────────────

async function mapResponse(
  body: FSAncestryResponse,
  marriageDetails: boolean,
): Promise<PersonAncestorsResult> {
  const rawPersons = body.persons ?? [];

  // Convert persons (and couples, when requested) in one pass.
  const simplified = await toSimplifiedStandardized({
    persons: rawPersons,
    relationships: marriageDetails ? (body.relationships ?? []) : [],
  } as unknown as GedcomX);

  // Index raw ascendancy numbers by person id (toSimplified drops `display`).
  const ascById = new Map<string, string>();
  for (const p of rawPersons) {
    if (p.id && typeof p.display?.ascendancyNumber === "string") {
      ascById.set(p.id, p.display.ascendancyNumber);
    }
  }

  const persons: AncestorPerson[] = [];
  for (const sp of simplified.persons ?? []) {
    if (!sp.id) continue;
    const ascendancyNumber = ascById.get(sp.id);
    if (ascendancyNumber === undefined) continue; // defensive — every ancestry person has one
    // Drop per-person source references: the ancestry response carries no
    // sourceDescriptions, so these would be dangling. Mutates this result
    // only — toSimplified is untouched, so other callers keep their sources.
    delete sp.sources;
    persons.push({ ...sp, ascendancyNumber });
  }

  const result: PersonAncestorsResult = { persons };
  if (marriageDetails) {
    result.relationships = (simplified.relationships ?? []).map(
      shapeRelationship,
    );
  }
  return result;
}

// Couple person refs come out of toSimplified as absolute URLs
// (…/persons/<id>); strip to the bare tree ID, same as person_read.
function shapeRelationship(r: SimplifiedRelationship): SimplifiedRelationship {
  const out: SimplifiedRelationship = { ...r };
  if (out.person1) out.person1 = bareId(out.person1);
  if (out.person2) out.person2 = bareId(out.person2);
  return out;
}

function bareId(ref: string): string {
  const slash = ref.lastIndexOf("/");
  return slash >= 0 ? ref.slice(slash + 1) : ref;
}

// The ancestry 301 (merged person) Location format is not probe-confirmed (no
// merged test ID was on hand); handle both FamilySearch redirect shapes — a
// `person=<id>` query param and a `…/persons/<id>` path segment.
function extractPersonId(location: string): string | null {
  const query = location.match(/[?&]person=([^&]+)/);
  if (query) return decodeURIComponent(query[1]);
  const path = location.match(/\/persons\/([^/?#]+)/);
  if (path) return path[1];
  return null;
}

// Re-export tool input type for index.ts wiring.
export type { PersonAncestorsInput };
