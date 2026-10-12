/**
 * Evidence trail behind issue #3229: does FamilySearch hand person_read the
 * sources it holds for RELATIONSHIPS, and in which shape?
 *
 * QUESTION: on `GET /platform/tree/persons/{pid}?relatives=true&sourceDescriptions=true`
 * (the exact request person_read makes), do `relationships[]` (Couple) and
 * `childAndParentsRelationships[]` carry `sources` or `notes`, and do their refs
 * resolve to a description in the same body's `sourceDescriptions[]`?
 *
 *   Shape 1: refs in the body, descriptions in the body. Conversion work only.
 *   Shape 2: refs in the body, descriptions NOT in the body (as relatives'
 *            person refs were: 0/102 and 2/79 resolved). Each needs a fetch.
 *   Shape 3: no refs in the body. Each edge needs a read of its own.
 *
 * For shape 3 it also asks each relationship's own resources directly, so the
 * cost of a per-edge read is measured rather than guessed:
 *   /platform/tree/couple-relationships/{id}
 *   /platform/tree/couple-relationships/{id}/source-references
 *   /platform/tree/child-and-parents-relationships/{id}
 *   /platform/tree/child-and-parents-relationships/{id}/source-references
 *
 * Why not dev/try-person-read.ts: that prints the TOOL's shaped output, not the
 * raw body FamilySearch sent. (Until #3229 it also dropped relationship sources
 * outright, in normalizeCoupleRelationship, synthesizeParentChild and
 * shapeRelationships.)
 *
 * Usage:
 *   cd packages/engine/mcp-server
 *   npx tsx dev/probe-relationship-sources.ts                 # KNDX-MKG and LVJK-9TQ
 *   npx tsx dev/probe-relationship-sources.ts G7XY-2ZQ        # any subjects
 *   npx tsx dev/probe-relationship-sources.ts --all-edges     # read EVERY edge, not 3 a kind
 *   npx tsx dev/probe-relationship-sources.ts --fanout        # trace the edges the TOOL returns
 *   (requires a prior desktop `login`: npx tsx dev/try-login.ts)
 *
 * Writes every raw body to dev/probe-relationship-sources.out.json (gitignored).
 *
 * RESULTS (2026-10-09, KNDX-MKG and LVJK-9TQ):
 *
 *   Default / --all-edges, one relationship at a time. The person read carries a
 *   ref only on a relationship that names the subject: KNDX-MKG 1 of 6 (Couple
 *   MCDG-G9L), LVJK-9TQ 3 of 15 (CAPRs 98BH-W7J, 98BH-SQ9, 98BH-3QT), each by
 *   `descriptionId`, none in the body's sourceDescriptions[] (shape 2). Reading
 *   those 21 on their own found no ref the read had missed. Relationships that
 *   do not name the subject carry no ref in its read, even when FamilySearch
 *   holds one (3 of 66 do, all on KNDX-MKG).
 *
 *   --fanout, from the edges person_read returns (30 and 45). 8 carry a source,
 *   and every one is in a read the tool already makes. 7 come from the subject's
 *   read: MCDG-G9L, and the 3 CAPRs above, which name the subject and LVT6-6X8 as
 *   parents and so give two edges each. The 8th is KNDX-MKG's parents' Couple
 *   MSRV-F83: the subject's read holds it without refs, and its ref is only in
 *   each parent's read, which the sibling fan-out already makes. That read never
 *   reaches the response for a relationship the subject's read holds: the
 *   subject's read already has every sibling CAPR by id, without refs (29 of 29
 *   over the four parent reads), so the fan-out's prune drops the parent's copy,
 *   and it merges no Couple at all. A parent's ref can only arrive by a fill on
 *   relationship id. (The other 2 sourced relationships of the 66 are behind no
 *   edge person_read returns.) Every relationship behind the other 67 edges (18
 *   and 21) was read on its own and has no source, so shape 3 applies to nothing
 *   the tool returns. The 5 descriptions are fetchable by id: GET
 *   /platform/sources/descriptions/{id}, all 200, one description each whose id
 *   is the one requested, 233-485 ms across three runs.
 *
 *   Relationship notes: never inline (0 of 322 relationship objects in every raw
 *   body). Every relationship read links them instead (`links.notes`, 87 of 87),
 *   and this probe does not follow that link, so whether any exist is unmeasured.
 */
import { writeFileSync } from "node:fs";
import { LOCAL } from "../src/auth/principal.js";
import { personReadTool } from "../src/tools/person-read.js";
import { fsFetch } from "../src/utils/fs-fetch.js";

const TREE = "https://api.familysearch.org/platform/tree";
const HEADERS = { Accept: "application/x-fs-v1+json", "Accept-Language": "en" };
const PER_KIND_SAMPLE = 3;

type Obj = Record<string, any>;

async function getJson(url: string): Promise<{ status: number; body: Obj | null }> {
  const res = await fsFetch(LOCAL, url, { headers: HEADERS, redirect: "manual" });
  const text = await res.text();
  let body: Obj | null = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { unparsed: text.slice(0, 500) };
    }
  }
  return { status: res.status, body };
}

/** How a ref names its description: a fragment (#id), a full URL, or an id field. */
function refForm(r: Obj): string {
  if (typeof r.descriptionId === "string") return "descriptionId";
  const d = r.description;
  if (typeof d !== "string") return "none";
  if (d.startsWith("#")) return "fragment";
  if (/^https?:\/\//.test(d)) return "url";
  return "other";
}

function refTarget(r: Obj): string | undefined {
  if (typeof r.descriptionId === "string") return r.descriptionId;
  const d = r.description;
  if (typeof d !== "string") return undefined;
  return d.startsWith("#") ? d.slice(1) : d.slice(d.lastIndexOf("/") + 1);
}

function tally(label: string, rels: Obj[], descIds: Set<string>) {
  const out: Obj = {
    label,
    count: rels.length,
    withSources: 0,
    refs: 0,
    refForms: {} as Record<string, number>,
    resolvedInBody: 0,
    withNotes: 0,
    keysSeen: {} as Record<string, number>,
  };
  for (const r of rels) {
    for (const k of Object.keys(r)) out.keysSeen[k] = (out.keysSeen[k] ?? 0) + 1;
    const refs: Obj[] = Array.isArray(r.sources) ? r.sources : [];
    if (refs.length > 0) out.withSources++;
    for (const ref of refs) {
      out.refs++;
      const form = refForm(ref);
      out.refForms[form] = (out.refForms[form] ?? 0) + 1;
      const target = refTarget(ref);
      if (target && descIds.has(target)) out.resolvedInBody++;
    }
    if (Array.isArray(r.notes) && r.notes.length > 0) out.withNotes++;
  }
  return out;
}

async function probeSubject(pid: string, raw: Obj): Promise<Obj> {
  const read = await getJson(`${TREE}/persons/${encodeURIComponent(pid)}?relatives=true&sourceDescriptions=true`);
  raw[`${pid}/person`] = read;
  if (read.status !== 200 || !read.body) return { pid, status: read.status };
  const body = read.body;
  const descIds = new Set<string>(
    (body.sourceDescriptions ?? []).map((d: Obj) => d.id).filter((x: unknown) => typeof x === "string"),
  );
  const rels: Obj[] = body.relationships ?? [];
  const couples = rels.filter((r) => !String(r.type ?? "").endsWith("ParentChild"));
  const bareParentChild = rels.filter((r) => String(r.type ?? "").endsWith("ParentChild"));
  const caprs: Obj[] = body.childAndParentsRelationships ?? [];
  const personIds = new Set<string>(
    (body.persons ?? []).map((p: Obj) => p.id).filter((x: unknown) => typeof x === "string"),
  );
  const summary: Obj = {
    pid,
    status: read.status,
    sourceDescriptions: descIds.size,
    couples: tally("relationships[] Couple", couples, descIds),
    bareParentChild: tally("relationships[] ParentChild", bareParentChild, descIds),
    caprs: tally("childAndParentsRelationships[]", caprs, descIds),
    perEdge: [] as Obj[],
  };

  const perKind = ALL_EDGES ? Infinity : PER_KIND_SAMPLE;
  const sample: Array<[string, string]> = [
    ...couples.slice(0, perKind).map((r) => ["couple-relationships", r.id] as [string, string]),
    ...caprs.slice(0, perKind).map((r) => ["child-and-parents-relationships", r.id] as [string, string]),
  ].filter(([, id]) => typeof id === "string");
  for (const [kind, id] of sample) {
    for (const suffix of ALL_EDGES ? [""] : ["", "/source-references"]) {
      const url = `${TREE}/${kind}/${encodeURIComponent(id)}${suffix}`;
      const started = Date.now();
      const got = await getJson(url);
      const ms = Date.now() - started;
      raw[`${pid}/${kind}/${id}${suffix}`] = got;
      const holder: Obj[] =
        got.body?.relationships ?? got.body?.childAndParentsRelationships ?? [];
      const refs: Obj[] = holder.flatMap((h) => (Array.isArray(h.sources) ? h.sources : []));
      const edge = holder[0] ?? {};
      const ends = [edge.person1, edge.person2, edge.parent1, edge.parent2, edge.child]
        .map((x: Obj | undefined) => x?.resourceId)
        .filter((x: unknown): x is string => typeof x === "string");
      summary.perEdge.push({
        url: `${kind}/${id}${suffix}`,
        status: got.status,
        ms,
        refs: refs.length,
        refForms: refs.map(refForm),
        descriptionIds: refs.map((r) => r.descriptionId).filter((x: unknown) => typeof x === "string"),
        involvesSubject: ends.includes(pid),
        endpointsInBody: ends.length > 0 && ends.every((e: string) => personIds.has(e)),
        descriptionsInBody: (got.body?.sourceDescriptions ?? []).length,
      });
    }
  }

  // Shape 2's fetch: can each referenced description be read on its own, and at
  // what cost? One read per distinct description id seen on any edge.
  const descIdsSeen = new Set<string>();
  for (const r of [...couples, ...caprs]) {
    for (const ref of (Array.isArray(r.sources) ? r.sources : []) as Obj[]) {
      if (typeof ref.descriptionId === "string") descIdsSeen.add(ref.descriptionId);
    }
  }
  for (const e of summary.perEdge as Obj[]) for (const d of e.descriptionIds ?? []) descIdsSeen.add(d);
  summary.descriptionFetches = [] as Obj[];
  for (const did of descIdsSeen) {
    const url = `https://api.familysearch.org/platform/sources/descriptions/${encodeURIComponent(did)}`;
    const started = Date.now();
    const got = await getJson(url);
    raw[`${pid}/descriptions/${did}`] = got;
    const sd: Obj = (got.body?.sourceDescriptions ?? [])[0] ?? {};
    summary.descriptionFetches.push({
      id: did,
      status: got.status,
      ms: Date.now() - started,
      returnedId: sd.id,
      hasTitle: Array.isArray(sd.titles) && sd.titles.length > 0,
      hasCitation: Array.isArray(sd.citations) && sd.citations.length > 0,
      about: typeof sd.about === "string" ? sd.about.slice(0, 80) : undefined,
    });
  }
  return summary;
}

// ─── --fanout: what person_read can carry onto the edges it RETURNS ────────
//
// The per-relationship view above undercounts what the tool already holds.
// person_read also reads each of the subject's parents (the sibling fan-out,
// `relatives=true`, no `sourceDescriptions`), and in a parent's own read the
// edges touching that parent are subject-edges too. It also overcounts what is
// left: a child-and-parents relationship naming the subject yields an edge from
// the OTHER parent as well, which a per-edge "involves the subject" test calls a
// relatives' edge. So this mode starts from the edges the tool returns and traces
// each one to the read, if any, that carries its relationship's refs.

const rid = (x: Obj | undefined): string | undefined =>
  typeof x?.resourceId === "string" ? x.resourceId : undefined;

function refIds(sources: unknown): string[] {
  return (Array.isArray(sources) ? sources : [])
    .map((r: Obj) => refTarget(r))
    .filter((x): x is string => typeof x === "string");
}

interface Rel {
  id: string;
  kind: "couple" | "capr";
  p1?: string;
  p2?: string;
  parent1?: string;
  parent2?: string;
  child?: string;
  /** read label -> description ids on this relationship in that read ([] = present, no refs) */
  refsBy: Record<string, string[]>;
}

function indexRels(body: Obj, label: string, rels: Map<string, Rel>): void {
  for (const r of (body.relationships ?? []) as Obj[]) {
    if (String(r.type ?? "").endsWith("ParentChild") || typeof r.id !== "string") continue;
    const rel = rels.get(r.id) ?? { id: r.id, kind: "couple", p1: rid(r.person1), p2: rid(r.person2), refsBy: {} };
    rel.refsBy[label] = refIds(r.sources);
    rels.set(r.id, rel);
  }
  for (const c of (body.childAndParentsRelationships ?? []) as Obj[]) {
    if (typeof c.id !== "string") continue;
    const rel = rels.get(c.id) ?? {
      id: c.id, kind: "capr", parent1: rid(c.parent1), parent2: rid(c.parent2), child: rid(c.child), refsBy: {},
    };
    rel.refsBy[label] = refIds(c.sources);
    rels.set(c.id, rel);
  }
}

async function probeFanout(pid: string, raw: Obj): Promise<Obj> {
  const subj = await getJson(`${TREE}/persons/${encodeURIComponent(pid)}?relatives=true&sourceDescriptions=true`);
  raw[`${pid}/fanout/subject`] = subj;
  if (subj.status !== 200 || !subj.body) return { pid, status: subj.status };
  const rels = new Map<string, Rel>();
  indexRels(subj.body, "subject", rels);

  // parentIdsOf: the subject's parents that its read returned a person record for.
  const returned = new Set(((subj.body.persons ?? []) as Obj[]).map((p) => p.id));
  const parents = new Set<string>();
  for (const c of (subj.body.childAndParentsRelationships ?? []) as Obj[]) {
    if (rid(c.child) !== pid) continue;
    for (const p of [rid(c.parent1), rid(c.parent2)]) if (p && returned.has(p)) parents.add(p);
  }
  const subjectCaprIds = new Set(
    ((subj.body.childAndParentsRelationships ?? []) as Obj[]).map((c) => c.id),
  );
  const parentReads: Obj[] = [];
  for (const parent of parents) {
    const got = await getJson(`${TREE}/persons/${encodeURIComponent(parent)}?relatives=true`);
    raw[`${pid}/fanout/parent/${parent}`] = got;
    // The fan-out's candidates: this parent's children other than the subject.
    const siblingCaprs = ((got.body?.childAndParentsRelationships ?? []) as Obj[]).filter(
      (c) => rid(c.child) !== pid && (rid(c.parent1) === parent || rid(c.parent2) === parent),
    );
    parentReads.push({
      parent,
      status: got.status,
      siblingCaprs: siblingCaprs.length,
      siblingCaprsAlreadyInSubjectRead: siblingCaprs.filter((c) => subjectCaprIds.has(c.id)).length,
    });
    if (got.status === 200 && got.body) indexRels(got.body, `parent:${parent}`, rels);
  }

  // The edges the tool returns, from the tool itself.
  const tool = await personReadTool({ personId: pid }, LOCAL);
  const toolSourceIds = new Set(tool.sources.map((s) => s.id));
  const edges: Obj[] = [];
  for (const e of tool.relationships as Obj[]) {
    const backing = [...rels.values()].filter((r) =>
      e.type === "Couple"
        ? r.kind === "couple" && new Set([r.p1, r.p2]).size === 2 &&
          [e.person1, e.person2].every((x) => x === r.p1 || x === r.p2)
        : r.kind === "capr" && r.child === e.child && (r.parent1 === e.parent || r.parent2 === e.parent),
    );
    const fromSubject = backing.flatMap((r) => r.refsBy.subject ?? []);
    // Refs a parent's read holds for a relationship the response returns. They can
    // reach the response only by a fill on relationship id: the subject's read holds
    // every sibling CAPR by id already, without refs (see `parentReads`), so
    // mergeSiblings' prune drops the parent's copy as already emitted, and it never
    // merges a Couple.
    const fromParents = backing.flatMap((r) =>
      Object.entries(r.refsBy).filter(([k]) => k.startsWith("parent:")).flatMap(([, v]) => v),
    );
    edges.push({
      type: e.type,
      ends: e.type === "Couple" ? [e.person1, e.person2] : [e.parent, e.child],
      involvesSubject: [e.person1, e.person2, e.parent, e.child].includes(pid),
      backing: backing.map((r) => r.id),
      route: fromSubject.length > 0 ? "subject-read" : fromParents.length > 0 ? "parent-read" : "none-in-reads",
      descriptionIds: [...new Set([...fromSubject, ...fromParents])],
    });
  }

  // What a per-edge read finds for the edges no read already covers.
  const unread = new Set(edges.filter((e) => e.route === "none-in-reads").flatMap((e) => e.backing as string[]));
  const perEdge: Obj[] = [];
  for (const id of unread) {
    const rel = rels.get(id)!;
    const kind = rel.kind === "couple" ? "couple-relationships" : "child-and-parents-relationships";
    const started = Date.now();
    const got = await getJson(`${TREE}/${kind}/${encodeURIComponent(id)}`);
    raw[`${pid}/fanout/edge/${id}`] = got;
    const holder: Obj[] = got.body?.relationships ?? got.body?.childAndParentsRelationships ?? [];
    perEdge.push({ id, kind, status: got.status, ms: Date.now() - started, descriptionIds: holder.flatMap((h) => refIds(h.sources)) });
  }
  const perEdgeRefs = new Map(perEdge.map((p) => [p.id, p.descriptionIds as string[]]));
  for (const e of edges) {
    if (e.route !== "none-in-reads") continue;
    const ids = (e.backing as string[]).flatMap((id) => perEdgeRefs.get(id) ?? []);
    if (ids.length > 0) { e.route = "per-edge-read-only"; e.descriptionIds = [...new Set(ids)]; }
    else e.route = "none";
  }

  // Each description id once: already in the tool's sources[], or fetched.
  const allIds = [...new Set(edges.flatMap((e) => e.descriptionIds as string[]))];
  const descriptions: Obj[] = [];
  for (const did of allIds) {
    if (toolSourceIds.has(did)) { descriptions.push({ id: did, inToolSources: true }); continue; }
    const started = Date.now();
    const got = await getJson(`https://api.familysearch.org/platform/sources/descriptions/${encodeURIComponent(did)}`);
    raw[`${pid}/fanout/description/${did}`] = got;
    descriptions.push({ id: did, inToolSources: false, status: got.status, ms: Date.now() - started });
  }

  const byRoute: Record<string, number> = {};
  for (const e of edges) byRoute[e.route] = (byRoute[e.route] ?? 0) + 1;
  return {
    pid,
    parentReads,
    edgesReturned: edges.length,
    edgesWithNoBackingRelationship: edges.filter((e) => (e.backing as string[]).length === 0).length,
    byRoute,
    edgesWithRefs: edges.filter((e) => (e.descriptionIds as string[]).length > 0),
    perEdgeReads: perEdge,
    descriptions,
  };
}

const ALL_EDGES = process.argv.includes("--all-edges");
const FANOUT = process.argv.includes("--fanout");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const subjects = args.length > 0 ? args : ["KNDX-MKG", "LVJK-9TQ"];
const raw: Obj = {};
const summaries: Obj[] = [];
for (const pid of subjects) summaries.push(FANOUT ? await probeFanout(pid, raw) : await probeSubject(pid, raw));
console.log(JSON.stringify(summaries, null, 2));

const OUT = "dev/probe-relationship-sources.out.json";
writeFileSync(OUT, JSON.stringify({ summaries, raw }, null, 2), { encoding: "utf-8" });
console.error(`raw bodies written to ${OUT}`);
