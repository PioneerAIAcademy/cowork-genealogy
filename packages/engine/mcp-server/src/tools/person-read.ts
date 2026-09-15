import type { Principal } from "../auth/principal.js";
import { getValidToken } from "../auth/refresh.js";
import { toSimplifiedStandardized } from "../utils/gedcomx-convert.js";
import { fetchWithRetry } from "../utils/http.js";
import {
  fetchMemories,
  fetchPortraitId,
  fetchStoryText,
  filterSourceStyle,
  isStoryText,
  isTranscribable,
  rankForTranscription,
  type Memory,
} from "../utils/memories.js";
import { mapWithConcurrency } from "../utils/place-resolver.js";
import { imageTranscribeTool } from "./image-transcribe.js";
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
    "Set sourceDescriptions=true to include attached sources — for a " +
    "non-living subject this also returns source-style memories (scanned " +
    "wills, certificates, obituaries, family stories), transcribed where the " +
    "read's time budget allowed. " +
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
      projectPath: {
        type: "string",
        description:
          "Optional absolute path to the project folder. When set, any memory " +
          "scan transcribed during this read is saved under images/ and its " +
          "project-relative path returned on that source as image_ref, so a " +
          "retained source can cite it. Without it the scan is transcribed but " +
          "not kept.",
      },
    },
    required: ["personId"],
  },
} as const;

// ─── Entry point ──────────────────────────────────────────────────────────

export async function personReadTool(input: PersonReadToolInput, principal: Principal): Promise<PersonReadResult> {
  const {
    personId,
    relatives = false,
    sourceDescriptions = false,
    projectPath,
  } = input;
  if (typeof personId !== "string" || personId.trim() === "") {
    throw new Error(
      "The person_read tool requires a non-empty personId string (e.g., \"KNDX-MKG\").",
    );
  }
  const token = await getValidToken(principal);
  const pid = personId.trim();
  const result = await fetchAndConvert(token, pid, relatives, sourceDescriptions, 0);

  // Memories ride the EXISTING sourceDescriptions flag (lead, 2026-08-19): a
  // third flag was declined because init-project already shipped a bug from
  // omitting one of the two that exist (issue #1475).
  //
  // SUBJECT ONLY, never relatives. With Half 1's parent fan-out a per-relative
  // memories fetch would be unbounded -- the 63-child subject in feedback issue
  // #1795 is the case that makes it unaffordable. This is what acceptance 7
  // forbids; it does NOT forbid paging the subject's own memories.
  //
  // A living person (204) has no memories to fetch and no sources array to
  // merge into.
  if (sourceDescriptions && result.persons.some((p) => p.id === pid && !p.living)) {
    result.sources = await mergeMemories(
      pid,
      result.sources,
      principal,
      projectPath,
    );
  }
  return result;
}

/**
 * Fetch, filter and merge this person's memories into the tree sources.
 *
 * FAIL-SOFT BY CONTRACT. A memories outage must never fail the read: project
 * creation would be blocked entirely by a subsystem the caller did not ask
 * about. Any throw here returns the tree sources untouched, logged to stderr.
 * Recorded in the spec's error table as a deliberate silent degradation.
 */
/**
 * The transcription phase's wall-clock budget, for the WHOLE phase rather than
 * per memory.
 *
 * Sized under the Cowork device bridge's 60s abort on every MCP call
 * (docs/architecture.md, "Other environment differences that bite"), with the
 * tree read and the memories fetch already spent inside the same call. An
 * unbudgeted phase does not cost a transcription -- it costs the whole person
 * read, which in Cowork is init-project's first real call.
 *
 * image_transcribe measures p50 18.7s / p90 40.6s / max 50.1s over 59 live
 * reads (2026-09-08, current default model). So 40s clears a typical scan and
 * abandons a pathological one, which is the intended trade. Do NOT re-size this
 * from OCR_TIMEOUT_MS (180s), which is a hang-catcher, nor from the spec's old
 * p90 79s figure, which came from run-log timelines measured per SDK message
 * rather than per tool call.
 */
const OCR_PHASE_BUDGET_MS = 40_000;

/**
 * In-flight transcriptions. A bandwidth ceiling for simultaneous multi-MB
 * downloads, NOT a limit on how much work gets done -- there is deliberately no
 * count cap (ruled 2026-09-15 on probe item 10: the risk is artifact size, not
 * count, and the 14.4MB outlier is audio, which the filter drops before OCR is
 * ever reached).
 */
const OCR_CONCURRENCY = 5;

/**
 * Transcribe the kept memories in place, under one phase budget.
 *
 * Every failure degrades to a metadata-only entry and NOTHING here throws: no
 * OpenRouter key, an OCR error, a per-image timeout, a 403 on the artifact --
 * person_read must never fail for an OCR reason. That is acceptance 6's
 * fail-soft rule extended to this leg.
 *
 * Whatever the budget did not reach comes back as metadata with a note saying
 * so, rather than being dropped. The note goes on the source itself because
 * decision 2 fixed the top level at {persons, relationships, sources} -- no new
 * key, nothing for a consumer to switch on -- and `notes` is already carried and
 * already excluded from the tree write.
 */
async function transcribeMemories(
  kept: Memory[],
  sources: TreeSource[],
  principal: Principal,
  projectPath: string | undefined,
): Promise<void> {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const deadline = Date.now() + OCR_PHASE_BUDGET_MS;

  /**
   * Workers publish here rather than writing straight to the sources.
   *
   * The phase stops at the deadline whether or not every worker has finished,
   * so a straggler can still settle after person_read has returned its result.
   * Writing to the source objects directly would mutate a payload the caller
   * already holds; writing here means a late finisher updates a map nobody
   * reads again.
   */
  const finished = new Map<
    string,
    { text?: string; image_ref?: string; notes?: string[] }
  >();

  const work = mapWithConcurrency(kept, OCR_CONCURRENCY, async (m) => {
    // Never START work the budget cannot pay for.
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    try {
      if (isStoryText(m)) {
        if (!m.artifactUrl) return void finished.set(m.id, {});
        const text = await fetchStoryText(m);
        finished.set(
          m.id,
          text ? { text } : { notes: ["Story text unavailable."] },
        );
        return;
      }
      // Nothing to transcribe is not a failure: no artifact URL, or media the
      // OCR leg cannot read. Recorded as done-with-nothing so it does not
      // later read as something the budget failed to reach.
      if (!isTranscribable(m) || !m.artifactUrl) return void finished.set(m.id, {});
      // Retention is for SCANS only. imageFilenameFor hardcodes `.jpg` and
      // gcUnreferencedImages sweeps `images/*.jpg`, so retaining a PDF here
      // would write a PDF under a .jpg name -- unreadable to the viewer and
      // mis-swept by the GC. A PDF is still transcribed; its text is the point,
      // and `url` always leads back to the artifact.
      const retain = projectPath && m.mediaType.toLowerCase().startsWith("image/");
      const out = await imageTranscribeTool(
        {
          memoryArtifactUrl: m.artifactUrl,
          ...(retain ? { projectPath } : {}),
        },
        principal,
        // Cap this call at what is left of the phase so a straggler aborts its
        // own OCR fetch rather than running on after the phase gave up on it.
        // This does NOT reach the artifact download leg, which carries its own
        // 90s budget -- which is why the phase-level stop below exists too.
        { ocrTimeoutMs: remaining, imageKey: m.id },
      );
      finished.set(m.id, {
        ...(out.transcription.trim() ? { text: out.transcription } : {}),
        ...(out.imageRef ? { image_ref: out.imageRef } : {}),
        ...(out.truncated && out.truncationNotice
          ? { notes: [out.truncationNotice] }
          : {}),
      });
    } catch (err) {
      // Deliberately swallowed, per memory. mapWithConcurrency runs its workers
      // under Promise.all, so a rejection here would abandon the others mid-
      // flight -- the same escape that made the portrait leg outlive the call.
      process.stderr.write(
        `person_read: transcription failed for memory ${m.id}: ${String(err)}\n`,
      );
      finished.set(m.id, {
        notes: [
          "Not transcribed: the transcription attempt failed. Retry with " +
            "image_transcribe (memoryArtifactUrl).",
        ],
      });
    }
  });

  // The phase-level stop. Checking the budget only before starting an item
  // bounds nothing once several are already in flight, and the per-call cap
  // above cannot reach the artifact download's own 90s timeout. This is what
  // actually holds the read under the Cowork bridge's 60s abort.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
  });
  try {
    await Promise.race([work, expiry]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  for (const m of kept) {
    const source = byId.get(m.id);
    if (!source) continue;
    const result = finished.get(m.id);
    if (!result) {
      // Not reached before the budget expired. It still comes back -- as
      // metadata, saying why, per decision 4.
      source.notes = [
        ...(source.notes ?? []),
        "Not transcribed: the read's transcription budget ran out. Transcribe " +
          "it directly with image_transcribe (memoryArtifactUrl).",
      ];
      continue;
    }
    if (result.text) source.text = result.text;
    if (result.image_ref) source.image_ref = result.image_ref;
    if (result.notes) source.notes = [...(source.notes ?? []), ...result.notes];
  }
}

async function mergeMemories(
  pid: string,
  treeSources: TreeSource[],
  principal: Principal,
  projectPath?: string,
): Promise<TreeSource[]> {
  try {
    // allSettled, NOT all. Both of these go through fetchWithRetry, which
    // retries a transient failure on a JITTERED TIMER under a 10s budget.
    // Promise.all rejects the instant the memories leg fails and abandons the
    // portrait leg mid-retry -- still running, no longer awaited, firing its
    // next attempt after person_read has already returned. Measured: that
    // escaped fetch made an unrelated test in person-read.test.ts fail 4 runs
    // in 10 by consuming the response its own retry was queued to get.
    // allSettled also stops a portrait failure from discarding every memory:
    // the portrait id only suppresses the profile photo, so losing it costs
    // one unwanted row, where the old shape lost the whole merge.
    const [memoriesResult, portraitResult] = await Promise.allSettled([
      fetchMemories(pid, principal),
      fetchPortraitId(pid, principal),
    ]);
    if (memoriesResult.status === "rejected") throw memoriesResult.reason;
    const portraitId =
      portraitResult.status === "fulfilled" ? portraitResult.value : null;
    const kept = rankForTranscription(
      filterSourceStyle(memoriesResult.value, portraitId),
    );
    // No dedupe against tree sources: the two id spaces are DISJOINT, measured
    // (tree `SD_PERSON_KWCJ-RN4` vs memory `3475`, 0 overlap on both persons
    // sampled). An id-keyed dedupe could never fire, so it is not written.
    const memorySources = kept.map(toTreeSource);
    await transcribeMemories(kept, memorySources, principal, projectPath);
    return [...treeSources, ...memorySources];
  } catch (err) {
    process.stderr.write(
      `person_read: memories fetch failed for ${pid}, returning tree sources only: ${String(err)}\n`,
    );
    return treeSources;
  }
}

/** A memory as an ordinary source row. No discriminator field and no new
 *  top-level key: the response stays exactly {persons, relationships, sources}
 *  so no downstream reader has to branch on memory-vs-source (lead, 2026-08-21). */
function toTreeSource(m: Memory): TreeSource {
  return {
    id: m.id,
    // Never empty: a tree source with an empty title fails the write
    // downstream. `Memory.title` already falls back to filename, then to
    // "FamilySearch memory <id>".
    title: m.title,
    ...(m.url !== undefined ? { url: m.url } : {}),
  };
}

async function fetchAndConvert(
  token: string,
  pid: string,
  relatives: boolean,
  sourceDescriptions: boolean,
  redirectsFollowed: number,
): Promise<PersonReadResult> {
  const url = buildUrl(pid, relatives, sourceDescriptions);
  const res = await fetchWithRetry(url, {
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
    // The converter already orders names preferred-first (#1318), so mapping
    // in place preserves the first-position convention. `names` is required
    // with minItems 1, so a person FS returned without any name still gets the
    // empty placeholder the living-person stub uses.
    const names = (sp.names ?? []).map((n) => ({
      ...(n.id ? { id: n.id } : {}),
      given: n.given ?? "",
      surname: n.surname ?? "",
      ...(n.preferred === true ? { preferred: true as const } : {}),
      ...(n.type ? { type: n.type } : {}),
      ...(n.prefix ? { prefix: n.prefix } : {}),
      ...(n.suffix ? { suffix: n.suffix } : {}),
    }));
    out.push({
      id,
      ...(sp.ark ? { ark: sp.ark } : {}),
      gender: sp.gender ?? "Unknown",
      living: raw?.living === true,
      names: names.length > 0 ? names : [{ given: "", surname: "" }],
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
