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
    "Set relatives=true to include parents, siblings, spouses, and children. " +
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
        description:
          "Include parents, siblings, spouses, and children. Siblings are " +
          "reached by reading each parent, so this costs one extra request " +
          "per parent. Defaults to false.",
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
  // Anchored HERE, before the tree read, so the read and the memories paging
  // are spent inside the same budget the 60s bridge abort measures.
  const deadline = Date.now() + OCR_PHASE_BUDGET_MS;
  const pid = personId.trim();
  const { result, resolvedId } = await fetchAndConvert(
    token,
    pid,
    relatives,
    sourceDescriptions,
    0,
    deadline,
  );

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
  // `resolvedId`, never `pid`: for a merged person they differ, and comparing
  // the pre-redirect id against the post-redirect person made this gate false
  // for every merged subject -- no memories, no note, no error, indistinguishable
  // from a person who simply has none.
  if (
    sourceDescriptions &&
    result.persons.some((p) => p.id === resolvedId && !p.living)
  ) {
    result.sources = await mergeMemories(
      resolvedId,
      result.sources,
      principal,
      deadline,
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
 * (docs/architecture.md, "Other environment differences that bite"). An
 * unbudgeted phase does not cost a transcription -- it costs the whole person
 * read, which in Cowork is init-project's first real call.
 *
 * The deadline is anchored at `personReadTool` ENTRY, not at phase entry, so
 * the tree read, THE SIBLING FAN-OUT, and the memories paging are all spent
 * INSIDE it. The fan-out belongs in that list and an earlier version of this
 * comment omitted it: it issues one `relatives=true` read per parent, bounded
 * at SIBLING_FANOUT_CONCURRENCY, and every one of them is on this clock. A
 * subject with several slow parents therefore leaves the memories phase less
 * time, which is lossless -- untranscribed memories come back as metadata with
 * a note -- but it is a real interaction and not a theoretical one. That is what the
 * 60s abort actually measures. Anchored at phase entry the budget was 40s on
 * top of whatever the read had already used -- a slow tree read plus sequential
 * paging (each a `fetchWithRetry`: 30s timeout, 10s retry budget) could put the
 * call past 60s and lose everything, which is the one outcome this exists to
 * prevent. When little or no time is left the phase transcribes nothing and
 * every memory comes back as a metadata entry with a note, which is the
 * documented lossless fallback rather than a new failure mode.
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
 * decision 2 fixed the top level at {persons, relationships, sources} with
 * nothing for a consumer to switch on, and `notes` is already carried here and
 * already excluded from the tree write. (Decision 2 was worded as "no new key";
 * the 2026-09-21 endpoint-closure ruling since added a conditional top-level
 * `notes[]`. It carries no discriminator either, so what decision 2 protects is
 * intact -- but do not read this comment as saying the top level can never gain
 * a key.)
 */
async function transcribeMemories(
  kept: Memory[],
  sources: TreeSource[],
  principal: Principal,
  projectPath: string | undefined,
  deadline: number,
): Promise<void> {
  const byId = new Map(sources.map((s) => [s.id, s]));

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
  deadline: number,
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
    await transcribeMemories(kept, memorySources, principal, projectPath, deadline);
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
    // `url` is the human /memories/<id> page; the artifact lives at a different
    // host entirely. Without this the note telling the agent to retry with
    // `image_transcribe(memoryArtifactUrl)` named a value the response did not
    // contain, so following the instruction threw "Unrecognized
    // memoryArtifactUrl". Response-only, exactly like `text` and `notes`:
    // `TREE_SOURCE_FIELDS` does not list it, so it cannot reach the tree write.
    ...(m.artifactUrl !== undefined ? { artifact_url: m.artifactUrl } : {}),
  };
}

/**
 * Returns the converted person AND the id it actually resolved to.
 *
 * A merged person answers 301 and this function recurses on the new id, so for
 * a merged subject the result's persons carry the POST-redirect id while the
 * caller still holds the one it passed. Every later step keyed on the subject
 * -- the memories gate, and the memories fetch itself -- has to use the
 * resolved id or it silently addresses a person who is not in the response.
 */
async function fetchAndConvert(
  token: string,
  pid: string,
  relatives: boolean,
  sourceDescriptions: boolean,
  redirectsFollowed: number,
  /** Shared with the memories phase; the fan-out is bounded by it too. */
  deadline: number,
): Promise<{ result: PersonReadResult; resolvedId: string }> {
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
    return { result: livingPersonStub(pid), resolvedId: pid };
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
      deadline,
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
  // Siblings are a SECOND hop: FamilySearch gives a person's parents but not
  // their brothers and sisters, so they are reachable only by reading each
  // parent. Merged into the RAW body, before conversion, deliberately -- the
  // subtype on a parent-child link is extracted from CAPRs, place
  // standardization runs once inside toSimplifiedStandardized, and `living` is
  // read back off the raw persons. Merging after conversion would lose all
  // three and mean re-implementing the shape functions by hand.
  const merged = relatives
    ? await mergeSiblings(token, pid, body, deadline)
    : body;
  return {
    result: await convertResponse(merged, relatives, sourceDescriptions, pid),
    resolvedId: pid,
  };
}

// ─── Sibling fan-out ──────────────────────────────────────────────────────

/**
 * In-flight parent reads. A person can have more than two parents -- measured
 * across the 95 committed e2e trees, 438 children have 2, but 4 have 3 and 3
 * have 4 (biological plus adoptive, or an unmerged duplicate). So this is a
 * concurrency ceiling over N, not a two-element assumption.
 */
const SIBLING_FANOUT_CONCURRENCY = 4;

/** Ceiling on one parent read. The effective timeout is the lesser of this and
 *  what is left of the shared deadline, so a slow fan-out cannot push the call
 *  past the 60s bridge abort that would discard the subject as well.
 *
 *  NOT DRIVEN BY A TEST, and said plainly rather than left to be discovered:
 *  no suite here can observe it. The narrowing shows up only as an earlier
 *  AbortSignal inside `fetchWithRetry`, which the `fetch` mock cannot see, and
 *  the `left <= 0` branch is close to unreachable anyway because the subject's
 *  own read is itself capped at 30s plus a 10s retry budget. A fake-timer test
 *  for it was written and deleted: it passed for reasons unrelated to the bound.
 *  What justifies keeping the code is that the unbounded form could add a whole
 *  second fetch wave on a path with a 60s abort that discards everything, and
 *  bounding it is strictly safer than not. */
const PARENT_READ_TIMEOUT_MS = 30_000;

/** The subject's own parents, from the subject's CAPRs, RESTRICTED to those the
 *  subject's read actually returned a person record for. `resourceId` is the
 *  production spelling on a CAPR ref -- `synthesizeParentChild` reads only that
 *  one, and this must agree with it or the two disagree about who a parent is.
 *
 *  The person-record check is not an optimisation. FamilySearch names a parent
 *  in a CAPR without returning their person record (see `dropDanglingEdges`
 *  below -- relationship arrays reach one hop further than `persons[]`), and
 *  fanning out to such a parent is worse than useless: `pruneCaprs` then drops
 *  every edge from that parent for want of the parent endpoint, while the
 *  children it contributed STAY in `persons[]`. `dropDanglingEdges` filters
 *  relationships and never removes a person, so the result was real
 *  half-siblings, carrying real FamilySearch arks, written into the user's tree
 *  with no stated relation to anybody. `validate_research_schema` has no
 *  persons->edges rule, so nothing downstream caught it either. Skipping the
 *  parent costs one request we cannot use and keeps the tree connected. */
function parentIdsOf(body: FSTreeResponse, pid: string): string[] {
  const returned = new Set(
    (body.persons ?? []).map((p) => p.id).filter((id): id is string => Boolean(id)),
  );
  const out = new Set<string>();
  for (const capr of body.childAndParentsRelationships ?? []) {
    if (capr.child?.resourceId !== pid) continue;
    for (const ref of [capr.parent1, capr.parent2]) {
      if (ref?.resourceId && returned.has(ref.resourceId)) out.add(ref.resourceId);
    }
  }
  return [...out];
}

/** `parent|child` keys already emitted by the subject's own CAPRs, so the
 *  fan-out cannot contribute a second copy of an edge the subject read has. */
function edgeKeysOf(body: FSTreeResponse): string[] {
  const out: string[] = [];
  for (const capr of body.childAndParentsRelationships ?? []) {
    const childId = capr.child?.resourceId;
    if (!childId) continue;
    for (const ref of [capr.parent1, capr.parent2]) {
      if (ref?.resourceId) out.push(`${ref.resourceId}|${childId}`);
    }
  }
  return out;
}

/** Does this CAPR make `childId` a child of `parentId`? */
function isChildOf(
  capr: FSChildAndParentsRelationship,
  parentId: string,
): boolean {
  return (
    capr.parent1?.resourceId === parentId || capr.parent2?.resourceId === parentId
  );
}

/** Follow a merged parent's 301 to the surviving id, capped like the subject's
 *  own redirect chain. Returns null rather than throwing on any dead end: the
 *  fan-out is an enrichment and must never cost the caller their subject. */
async function followMergedParent(
  token: string,
  res: Response,
  followed = 0,
): Promise<ParentRead | null> {
  if (followed >= MAX_REDIRECTS) return null;
  const location = res.headers.get("location");
  const newId = location ? extractPersonId(location) : null;
  if (!newId) return null;
  const next = await fetchWithRetry(buildUrl(newId, true, false), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: ACCEPT_HEADER,
      "Accept-Language": "en",
    },
    redirect: "manual",
  });
  if (next.status === 301) return followMergedParent(token, next, followed + 1);
  if (next.status !== 200) return null;
  return { body: (await next.json()) as FSTreeResponse, resolvedId: newId };
}

/** A parent's read plus the id it actually resolved to. They differ only for a
 *  merged parent, and that difference has to be carried: the merged body's
 *  CAPRs name the SURVIVING id, while `known` -- and therefore every edge that
 *  can survive `pruneCaprs` -- is keyed on the id the subject's own read used.
 *  Matching on one and emitting the other is what makes a merged parent's
 *  siblings arrive linked instead of orphaned. */
interface ParentRead {
  body: FSTreeResponse;
  resolvedId: string;
}

/** Rewrite a CAPR's parent endpoints from the surviving id back to the id the
 *  subject's read used. A no-op when they are the same, which is every
 *  unmerged parent. */
function remapParentRefs(
  capr: FSChildAndParentsRelationship,
  from: string,
  to: string,
): FSChildAndParentsRelationship {
  if (from === to) return capr;
  const fix = (ref: typeof capr.parent1) =>
    ref?.resourceId === from ? { ...ref, resourceId: to } : ref;
  return { ...capr, parent1: fix(capr.parent1), parent2: fix(capr.parent2) };
}

/**
 * Read each parent and merge in the subject's siblings.
 *
 * What a parent's read returns that nobody asked for: the subject's
 * grandparents, the parent's other spouses, non-spouse co-parents, the
 * subject's own other parent, and the grandparents' Couple. Rather than
 * enumerate those exclusions -- the card lists three of the five -- this keeps
 * exactly one category: persons who are CHILDREN of that parent. Everything
 * else drops out in one move.
 *
 * NOTHING HERE THROWS. A parent that 403s, 404s, 410s, 429s, times out, or
 * comes back as a 204 living stub simply yields no siblings from that parent;
 * the subject's own read still succeeds. A sibling fan-out is an enrichment and
 * must never cost the caller the person they actually asked for.
 */
async function mergeSiblings(
  token: string,
  pid: string,
  body: FSTreeResponse,
  deadline: number,
): Promise<FSTreeResponse> {
  const parentIds = parentIdsOf(body, pid);
  // No parents => ZERO extra calls. This is what keeps the isolated-person
  // path at exactly one request.
  if (parentIds.length === 0) return body;

  const parentBodies = await mapWithConcurrency(
    parentIds,
    SIBLING_FANOUT_CONCURRENCY,
    async (parentId) => {
      const left = deadline - Date.now();
      // Nothing left on the shared clock: this parent yields no siblings, the
      // same outcome a 403 or a timeout gives. Better than starting a read that
      // can only push the whole call past the 60s bridge abort, which discards
      // the subject too.
      if (left <= 0) return null;
      try {
        const res = await fetchWithRetry(buildUrl(parentId, true, false), {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: ACCEPT_HEADER,
            "Accept-Language": "en",
          },
          redirect: "manual",
        }, Math.min(PARENT_READ_TIMEOUT_MS, left));
        // 301 = merged, which is routine and not an error. The subject's own
        // read follows it (`fetchAndConvert`); a parent read that treated it as
        // "no siblings" lost every sibling behind a merge, silently.
        if (res.status === 301) return await followMergedParent(token, res);
        // Anything else that is not a 200 with a body means "no siblings from
        // this parent" -- including 204, which is a living person with no body
        // at all and would throw on .json().
        if (res.status !== 200) return null;
        return {
          body: (await res.json()) as FSTreeResponse,
          resolvedId: parentId,
        };
      } catch {
        return null;
      }
    },
  );

  const persons = [...(body.persons ?? [])];
  const known = new Set(
    persons.map((p) => p.id).filter((id): id is string => Boolean(id)),
  );
  const candidateCaprs: FSChildAndParentsRelationship[] = [];

  parentIds.forEach((parentId, i) => {
    const parentRead = parentBodies[i];
    if (!parentRead) return;
    const { body: parentBody, resolvedId } = parentRead;
    const personById = new Map(
      (parentBody.persons ?? [])
        .filter((p) => p.id)
        .map((p) => [p.id as string, p]),
    );
    for (const capr of parentBody.childAndParentsRelationships ?? []) {
      const childId = capr.child?.resourceId;
      if (!childId || childId === pid) continue;
      if (!isChildOf(capr, resolvedId)) continue;
      const person = personById.get(childId);
      // A CAPR can name a child whose person record the response did not
      // include -- relationships reach one hop further than persons[]. Adding
      // the edge without the person is exactly the dangling endpoint that
      // fails the whole project_create write.
      if (!person) continue;
      if (!known.has(childId)) {
        persons.push(person);
        known.add(childId);
      }
      candidateCaprs.push(remapParentRefs(capr, resolvedId, parentId));
    }
  });

  return {
    ...body,
    persons,
    childAndParentsRelationships: [
      ...(body.childAndParentsRelationships ?? []),
      ...pruneCaprs(candidateCaprs, known, edgeKeysOf(body)),
    ],
  };
}

/**
 * Keep only the parent endpoints that made it into `persons`, and drop a CAPR
 * that has none left.
 *
 * `synthesizeParentChild` expands one CAPR into one edge PER PARENT, so an
 * unpruned CAPR naming a co-parent we did not import emits an edge whose parent
 * is not in `persons[]`. validator.ts:1847 makes that a hard error
 * (`parent '...' not found in persons`) and `project_create` -- alone among the
 * tree writers, it never calls `sanitizeTree` -- refuses the ENTIRE write.
 *
 * BUT THIS IS NO LONGER THE LAST LINE OF DEFENCE, and an earlier version of
 * this comment claiming it was got that wrong. `dropDanglingEdges` runs over
 * the CONVERTED output and drops any edge with an endpoint outside `persons[]`,
 * so deleting the `known.has` tests below fails no test in the suite -- it is
 * masked. What this pass still buys is narrower and worth keeping: it prunes on
 * the RAW body, so the dangling edge is never synthesised in the first place,
 * and it is what makes the `persons[]` contributed by the fan-out match the
 * edges that will survive. Do not mistake "no test fails when I delete it" for
 * "it does nothing" -- the backstop is what the tests are seeing.
 *
 * A half-sibling therefore arrives linked to the shared parent only. That is
 * the truth of what was imported, not a loss.
 */
function pruneCaprs(
  caprs: FSChildAndParentsRelationship[],
  known: Set<string>,
  alreadyEmitted: Iterable<string> = [],
): FSChildAndParentsRelationship[] {
  const seen = new Set<string>(alreadyEmitted);
  const out: FSChildAndParentsRelationship[] = [];
  for (const capr of caprs) {
    const childId = capr.child?.resourceId;
    if (!childId || !known.has(childId)) continue;
    const parent1 = capr.parent1?.resourceId;
    const parent2 = capr.parent2?.resourceId;
    const keep1 = parent1 !== undefined && known.has(parent1);
    const keep2 = parent2 !== undefined && known.has(parent2);
    if (!keep1 && !keep2) continue;
    // Dedup per PARENT-CHILD PAIR, not per CAPR. `synthesizeParentChild`
    // expands one CAPR into one edge PER PARENT, so a CAPR-shaped key is the
    // wrong granularity: a sibling carrying two CAPRs that name the same parent
    // -- {DAD, MUM} and {DAD} alone, which is what a biological plus an
    // adoptive record looks like -- has two distinct CAPR keys and emitted
    // DAD->SIB twice. Measured before this fix:
    //   ["DAD-001->SIB-100", "MUM-002->SIB-100", "DAD-001->SIB-100"]
    const emit1 = keep1 && !seen.has(`${parent1}|${childId}`);
    const emit2 = keep2 && !seen.has(`${parent2}|${childId}`);
    if (!emit1 && !emit2) continue;
    if (emit1) seen.add(`${parent1}|${childId}`);
    if (emit2) seen.add(`${parent2}|${childId}`);
    out.push({
      ...capr,
      ...(emit1 ? {} : { parent1: undefined, parent1Facts: undefined }),
      ...(emit2 ? {} : { parent2: undefined, parent2Facts: undefined }),
    });
  }
  return out;
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
  /** The POST-redirect subject id, so a dropped edge can be recognised as the
   *  subject's own parentage rather than a distant relative's. */
  pid: string,
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
  const persons = shapePersons(simplified.persons ?? [], body.persons ?? []);
  const personIds = new Set(
    persons.map((p) => p.id).filter((id): id is string => Boolean(id)),
  );
  const shaped = relatives ? shapeRelationships(simplified.relationships ?? []) : [];
  const kept = relatives ? dropDanglingEdges(shaped, personIds) : [];
  return {
    persons: relatives ? dropStrandedPersons(persons, kept, pid) : persons,
    relationships: kept,
    sources: sourceDescriptions
      ? shapeSources(simplified.sources ?? [], body.sourceDescriptions ?? [])
      : [],
    ...droppedEdgeNotes(shaped, kept, pid),
  };
}

/**
 * Drop a person left attached to nothing once endpoint closure has run.
 *
 * `dropDanglingEdges` filters relationships and never removes a person, so when
 * the dropped edge was a person's ONLY edge, that person stays in `persons[]`
 * with no stated relation to anybody. `parentIdsOf` already stops the fan-out
 * producing this, but the fan-out is not the only source: the same shape
 * arrives from the SUBJECT'S own read, where nothing filters it.
 *
 * `validate_research_schema` will not catch it -- it checks edges against
 * persons and has no persons-to-edges rule (the only `orphan` rule in the repo
 * is for `results/` sidecars) -- so a stranded person reaches the user's tree
 * silently. On the merge base the same input emitted the edge and
 * `project_create` refused the whole write, loudly; the drop is what strands
 * them, so the drop owns the cleanup.
 *
 * Unevidenced rather than observed: across all 95 tracked unstripped e2e trees
 * the count of persons named by no relationship is zero, and `author.py` runs
 * the identical drop-edges-keep-persons step on real captured data without ever
 * stranding one. This closes the guarantee rather than fixing a sighting.
 *
 * The SUBJECT is never dropped: a genuinely isolated person is a valid read and
 * returning nothing for them would be the worse bug.
 */
function dropStrandedPersons(
  persons: TreePerson[],
  relationships: TreeRelationship[],
  pid: string,
): TreePerson[] {
  const linked = new Set<string>();
  for (const r of relationships) {
    for (const endpoint of [r.parent, r.child, r.person1, r.person2]) {
      if (endpoint) linked.add(endpoint);
    }
  }
  return persons.filter((p) => !p.id || p.id === pid || linked.has(p.id));
}

/**
 * A `notes[]` entry when endpoint closure dropped something, and nothing at all
 * when it did not.
 *
 * Counts and types only, per the ruling -- ids would name persons the caller
 * never asked about and cannot look up, since the whole reason the edge went is
 * that its far endpoint is not in `persons[]`.
 *
 * The subject's own parentage is called out separately because it is the case
 * that actually costs the caller something: a dropped edge to a distant
 * relative loses a hint, while a dropped edge to the SUBJECT'S parent loses the
 * answer to what they asked. Before endpoint closure this surfaced as
 * `project_create` refusing the entire write -- loud, and impossible to miss.
 */
function droppedEdgeNotes(
  shaped: TreeRelationship[],
  kept: TreeRelationship[],
  pid: string,
): { notes?: string[] } {
  if (shaped.length === kept.length) return {};
  const keptSet = new Set(kept);
  const dropped = shaped.filter((r) => !keptSet.has(r));
  const byType = new Map<string, number>();
  for (const r of dropped) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
  const breakdown = [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, n]) => `${n} ${type}`)
    .join(", ");
  const notes = [
    `Dropped ${dropped.length} relationship(s) whose endpoints are not in ` +
      `persons[] (${breakdown}). FamilySearch names kin one hop beyond the ` +
      `persons it returns; such an edge fails the project_create write ` +
      `outright, so it is not emitted.`,
  ];
  const ownParentage = dropped.filter(
    (r) => r.type === "ParentChild" && r.child === pid,
  ).length;
  if (ownParentage > 0) {
    notes.push(
      `${ownParentage} of those is a parent of the requested person: this ` +
        `person has a parent in FamilySearch whose record was not returned, ` +
        `so the parentage is NOT represented in relationships[].`,
    );
  }
  return { notes };
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

/**
 * Drop any relationship with an endpoint that is not a returned person.
 *
 * FamilySearch's relationship arrays reach ONE HOP FURTHER than its persons
 * array: a read names the subject's great-grandparents, a child's spouse, or a
 * non-spouse co-parent without returning a person record for them. Its refs even
 * carry an absolute-URL form used, in this file's own words, "when the person
 * isn't in this response".
 *
 * Emitting those edges is not free. `validate_research_schema` treats an
 * unresolvable endpoint as a HARD error on all four spellings -- `parent` and
 * `child` (validator.ts:1847/1852), `person1` and `person2` (1873/1878) -- and
 * `project_create`, alone among the tree writers in never calling
 * `sanitizeTree`, refuses the ENTIRE write on any error. So one edge pointing a
 * hop past the data costs the user their whole project, and the failure names a
 * person they never asked about.
 *
 * Dropping the edge loses nothing a caller could have used: the far endpoint is
 * not in `persons[]`, so there is no person to link to. What is lost is the hint
 * that some further relative exists -- the trade the card's rule 4 makes
 * deliberately, now made for every emitted edge rather than only for the ones
 * the sibling fan-out contributes.
 */
function dropDanglingEdges(
  relationships: TreeRelationship[],
  personIds: Set<string>,
): TreeRelationship[] {
  return relationships.filter((r) =>
    [r.parent, r.child, r.person1, r.person2].every(
      (endpoint) => endpoint === undefined || personIds.has(endpoint),
    ),
  );
}

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
