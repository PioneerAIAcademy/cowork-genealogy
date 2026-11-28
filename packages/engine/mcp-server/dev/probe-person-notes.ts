/**
 * Evidence trail behind issue #4585: does FamilySearch's API return a tree
 * person's Collaborate-tab notes and discussions?
 *
 * QUESTION: from feedback #4508, auditing Orpha (Brooks) Wheaton (LZPF-WMT), the
 * agent could not see what the person's Collaborate tab said. A note there — John
 * Brooks's 1788 will, which names his children and does not name Orpha — is the
 * evidence that the parents usually attached to her are wrong. No engine tool
 * reads that tab. Can one?
 *
 *   "Returns them" = at least one response carries the text of that note.
 *   A 200 with an empty list, a 204, a 403 or a 404 means "does not return them".
 *   A thrown request, a 3xx, or a non-200 on the subject's own person read is
 *   INCONCLUSIVE — never a negative. See `verdict()`.
 *
 * Two traps this script exists to avoid, both of which produce a false negative
 * indistinguishable from a real one:
 *
 *   1. An empty result is only evidence about the API if the Collaborate tab
 *      demonstrably has content at the same moment. The feedback is from
 *      2026-11-12 and a note is user-generated content anyone can delete. A
 *      discussion is also attached BY REFERENCE, and the tester never said whose
 *      tab she read it on — the note argues Orpha is NOT a child of John Brooks,
 *      so it sits as plausibly on his profile as on hers. Hence the parent sweep,
 *      on by default, and the UI check named in the RESULTS block.
 *   2. Counting `notes` at the body root. In GedcomX a person's notes hang off
 *      conclusion objects, not the root, so a root-only count reports 0 on a body
 *      with `persons[0].notes[]` populated. Hence `findCollabArrays`, a recursive
 *      walk that records each array's JSON path.
 *
 * Usage:
 *   cd packages/engine/mcp-server
 *   npx tsx dev/probe-person-notes.ts                  # LZPF-WMT and its parents
 *   npx tsx dev/probe-person-notes.ts G7XY-2ZQ ...     # any subjects
 *   npx tsx dev/probe-person-notes.ts --no-parents     # subjects only
 *   (requires a prior login: npx tsx dev/try-login.ts)
 *
 * Writes every raw body to dev/probe-person-notes.out.json (gitignored), from a
 * `finally` so a throw partway still leaves the bodies already collected.
 *
 * VERDICT BRANCHES (checked 2026-11-27, synthetic summaries, no network). The
 * negative is what cancels step 2, so each branch was run, both the ones that
 * must produce it and the ones that must refuse to:
 *
 *   subject bare read 403, relatives 200   -> INCONCLUSIVE
 *   subject bare read 204 (living)         -> INCONCLUSIVE
 *   partial throw (one endpoint status 0)  -> INCONCLUSIVE
 *   "1788" in the body but not in a note   -> DOES NOT RETURN THEM
 *   301 not followed                       -> INCONCLUSIVE
 *   3xx on a notes link                    -> INCONCLUSIVE
 *   every request threw                    -> INCONCLUSIVE
 *   "1788" inside a collaborate item       -> RETURNS THEM
 *   collaborate content, not that note     -> RETURNS NOTES/DISCUSSIONS, not it
 *   403 with an HTML body (Imperva)        -> INCONCLUSIVE
 *   204 living person                      -> INCONCLUSIVE
 *   every endpoint answered, all empty     -> DOES NOT RETURN THEM
 *   301 followed, then 200, notes 404      -> DOES NOT RETURN THEM
 *   a swept PARENT restricted, subject ok  -> DOES NOT RETURN THEM
 *
 * The last three are the other direction: the guards above must not leave the
 * probe unable to report a real negative.
 *
 * RESULTS (2026-11-27, LZPF-WMT "Orpha Brooks"). VANTAGE POINT: run from a
 * machine OUTSIDE the church/FamilySearch network, signed in with an ordinary
 * personal FamilySearch account carrying no church or employee affiliation. No
 * re-run by anyone else is needed. Every response was
 * `application/x-fs-v1+json`; no 403 and no HTML body anywhere, so Imperva did
 * not intervene.
 *
 * ANSWER: YES — the API returns them. Both notes and discussions.
 *
 *   GET /platform/tree/persons/LZPF-WMT/notes                      -> 200
 *     One note at `$.persons[0].notes[0]`, id 963952a5-…, subject "Orpha Brooks
 *     not in the John Brooks and Dorothy Birdsey family.", and its `text` is the
 *     tester's paste on #4508 WORD FOR WORD, 1788 will and all. This is the
 *     endpoint the issue called an unverified guess; it is real.
 *
 *   GET /platform/tree/persons/LZPF-WMT/discussion-references      -> 404
 *     The other guess is wrong — but not because discussions are unavailable.
 *     They arrive inline on the person instead (below).
 *
 *   GET /platform/tree/persons/LZPF-WMT                            -> 200
 *     Top-level keys: childAndParentsRelationships, description, persons,
 *     places, relationships, sourceDescriptions. **No `links` object at all** —
 *     so "follow links.notes / links['discussion-references']", which the issue
 *     names as the discovery route, finds nothing. Instead the references are
 *     INLINE: `$.persons[0].discussion-references`, 2 of them, each with an
 *     href to the discussion itself.
 *
 *   GET /platform/tree/persons/LZPF-WMT?relatives=true             -> 200
 *     16 persons, 74 child-and-parents relationships. Carries the same 2 inline
 *     references for the subject plus 4 more for relatives (persons[2], [7],
 *     [15]) — a person's references ride along in any read that returns them.
 *
 *   GET /platform/discussions/discussions/ds.disc.MMM4-Z44K        -> 200
 *   GET /platform/discussions/discussions/ds.disc.MMM9-MFLM        -> 200
 *     Each returns the full discussion under a top-level `discussions[]`:
 *     "Could Orpha Brooks have been an orphan who was cared for by the John and
 *     Dorothy Brooks' clan?" and "Legacy Disputes". So the two-hop route works:
 *     read the person, take each inline reference's href, GET it.
 *
 * PARENT SWEEP swept nobody, and that is a finding rather than a failure: across
 * those 74 relationships Orpha appears as a parent 14 times and as a CHILD zero
 * times. No parents are attached to her in Family Tree today — the attachment
 * the note disputes is already gone.
 *
 * WHAT THIS MEANS FOR STEP 2: the data is there and costs one extra GET for
 * notes, plus one per discussion reference already present in the person body
 * the tool reads. Worth noting for the spec: the note is keyed under `persons[]`
 * in the /notes response, and `links` cannot be relied on for discovery.
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { LOCAL } from "../src/auth/principal.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fsFetch } from "../src/utils/fs-fetch.js";
import {
  TREE_PERSON_ACCEPT,
  TREE_PERSONS_BASE,
  classifyTreePersonStatus,
  extractPersonId,
} from "../src/utils/tree-person-status.js";

type Obj = Record<string, any>;

/**
 * `fsFetch` sets only `Authorization` (its `mergeAuth`), so the browser UA is
 * ours to send. FamilySearch sits behind Imperva, which 403s a non-browser UA;
 * without this a 403 cannot be told apart from the API's own answer. Shipped
 * code sends it: src/utils/relative-sources.ts, src/utils/memories.ts.
 */
const HEADERS: Record<string, string> = {
  Accept: TREE_PERSON_ACCEPT,
  "Accept-Language": "en",
  "User-Agent": BROWSER_USER_AGENT,
};

interface Got {
  url: string;
  status: number;
  ok: boolean;
  contentType?: string;
  location?: string;
  body: Obj | null;
  text?: string;
  error?: string;
}

/**
 * Never propagates a throw. `fsFetch` throws rather than returning in three live
 * cases — `getValidToken` with no usable token (before any network I/O), a
 * `Retry-After` past the retry budget, and an exhausted network/timeout — and one
 * throw on any endpoint would otherwise discard every body already collected.
 * A thrown request becomes `status: 0`, which `verdict()` treats as inconclusive
 * rather than as a negative.
 */
async function getJson(url: string): Promise<Got> {
  try {
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
    return {
      url,
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get("content-type") ?? undefined,
      location: res.headers.get("location") ?? undefined,
      body,
      text,
    };
  } catch (err) {
    return { url, status: 0, ok: false, body: null, error: String(err) };
  }
}

// ─── finding the collaborate content, wherever it hangs ───────────────────

const COLLAB_KEYS = new Set([
  "notes",
  "discussions",
  "discussion-references",
  "discussionReferences",
]);

interface FoundArray {
  path: string;
  key: string;
  count: number;
  items: Obj[];
}

/** Every notes/discussions array anywhere in the body, with its JSON path. */
function findCollabArrays(node: unknown, path = "$", out: FoundArray[] = []): FoundArray[] {
  if (Array.isArray(node)) {
    node.forEach((v, i) => findCollabArrays(v, `${path}[${i}]`, out));
    return out;
  }
  if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Obj)) {
      const child = `${path}.${k}`;
      if (COLLAB_KEYS.has(k) && Array.isArray(v)) {
        out.push({ path: child, key: k, count: v.length, items: v as Obj[] });
      }
      findCollabArrays(v, child, out);
    }
  }
  return out;
}

/** One note or discussion, as the issue asks it be recorded. */
function describeItem(it: Obj): Obj {
  const text =
    typeof it.text === "string"
      ? it.text
      : typeof it.details === "string"
        ? it.details
        : undefined;
  return {
    id: it.id ?? it.resourceId,
    subject: it.subject ?? it.title,
    textHead: text === undefined ? undefined : text.slice(0, 200),
    href: hrefOf(it),
  };
}

/** A discussion reference points at the discussion itself; follow what it gives. */
function hrefOf(it: Obj): string | undefined {
  for (const candidate of [it.links?.discussion?.href, it.resource, it.href]) {
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
}

function linkHref(body: Obj | null, name: string): string | undefined {
  const href = body?.links?.[name]?.href;
  return typeof href === "string" ? href : undefined;
}

/** A 403 whose body is HTML is Imperva, not the API. */
function impervaHtml(g: Got): boolean {
  if (g.status !== 403) return false;
  if ((g.contentType ?? "").toLowerCase().includes("text/html")) return true;
  return (g.text ?? "").trimStart().startsWith("<");
}

/** The text of every collaborate item, untruncated — what the 1788 scan reads. */
function collabText(found: FoundArray[]): string {
  return found
    .flatMap((f) => f.items)
    .map((it) =>
      typeof it.text === "string" ? it.text : typeof it.details === "string" ? it.details : "",
    )
    .join("\n");
}

function summarize(label: string, g: Got, isPersonRead: boolean): Obj {
  const found = g.body === null ? [] : findCollabArrays(g.body);
  const collabArrays = found.map((f) => ({
    path: f.path,
    key: f.key,
    count: f.count,
    items: f.items.slice(0, 10).map(describeItem),
  }));
  return {
    label,
    url: g.url,
    status: g.status,
    treePersonStatus: isPersonRead
      ? classifyTreePersonStatus({ status: g.status, ok: g.ok })
      : undefined,
    contentType: g.contentType,
    location: g.location,
    error: g.error,
    topLevelKeys: g.body === null ? [] : Object.keys(g.body),
    linksKeys: g.body?.links ? Object.keys(g.body.links) : undefined,
    collabArrays,
    collabItemCount: collabArrays.reduce((n, c) => n + c.count, 0),
    impervaHtml: impervaHtml(g),
    /**
     * Scoped to collaborate item text, NOT the whole body. John Brooks died in
     * 1788, so his death fact puts "1788" in an ordinary person body with no
     * collaborate content at all — and `verdict()` tests this first, so a
     * body-wide scan returns "RETURNS THEM" on a bare person read.
     */
    mentions1788: collabText(found).includes("1788"),
    /** Kept for eyeballing the raw dump; deliberately NOT read by `verdict()`. */
    bodyMentions1788: (g.text ?? "").includes("1788"),
  };
}

// ─── the person sweep ─────────────────────────────────────────────────────

function parentIdsOf(body: Obj, pid: string): string[] {
  const out = new Set<string>();
  for (const capr of (body.childAndParentsRelationships ?? []) as Obj[]) {
    if (capr.child?.resourceId !== pid) continue;
    for (const parent of [capr.parent1, capr.parent2]) {
      const id = parent?.resourceId;
      if (typeof id === "string") out.add(id);
    }
  }
  return [...out];
}

/** Name the sweep's persons, so "the attached parents" can be checked by eye. */
function nameOf(body: Obj | null, pid: string): string | undefined {
  const person = ((body?.persons ?? []) as Obj[]).find((p) => p.id === pid);
  const name = person?.display?.name ?? person?.names?.[0]?.nameForms?.[0]?.fullText;
  return typeof name === "string" ? name : undefined;
}

async function probePerson(pid: string, raw: Obj): Promise<Obj> {
  const requests: Obj[] = [];
  const ask = async (label: string, url: string, isPersonRead = false): Promise<Got> => {
    const got = await getJson(url);
    raw[`${pid}/${label}`] = got;
    requests.push(summarize(label, got, isPersonRead));
    return got;
  };

  // 1 — the bare read, for the links keys. The issue's discovery step.
  let bare = await ask("person", `${TREE_PERSONS_BASE}/${encodeURIComponent(pid)}`, true);

  // A merged person answers 301 with an empty body; follow it once so an empty
  // body is not mistaken for "the API returns nothing".
  let effectivePid = pid;
  if (classifyTreePersonStatus({ status: bare.status, ok: bare.ok }) === "merged") {
    const survivor = bare.location ? extractPersonId(bare.location) : null;
    if (survivor !== null) {
      effectivePid = survivor;
      bare = await ask("person.merged", `${TREE_PERSONS_BASE}/${encodeURIComponent(survivor)}`, true);
    }
  }

  // 1b — relatives, for the parent sweep. `childAndParentsRelationships[]` is
  // absent without this; a sweep off the bare read would find nobody.
  const withRelatives = await ask(
    "person.relatives",
    `${TREE_PERSONS_BASE}/${encodeURIComponent(effectivePid)}?relatives=true`,
    true,
  );

  // 2 — follow whatever the body links as notes or discussions.
  for (const name of ["notes", "discussion-references", "discussions"]) {
    const href = linkHref(bare.body, name) ?? linkHref(withRelatives.body, name);
    if (href === undefined) continue;
    const got = await ask(`link.${name}`, href);
    // A reference names the discussion; read each one it points at.
    const targets = findCollabArrays(got.body ?? {})
      .flatMap((f) => f.items.map(hrefOf))
      .filter((h): h is string => typeof h === "string");
    for (const [i, target] of [...new Set(targets)].entries()) {
      await ask(`link.${name}.target${i}`, target);
    }
  }

  // 2b — MEASURED 2026-11-27: this endpoint returns no `links` object at all
  // (`linksKeys: []`), and the references are INLINE on the person instead —
  // `$.persons[0].discussion-references`, each carrying an href to the
  // discussion. Step 2 above therefore never fires, and without this the
  // discussions the issue asks for are found and never read. Taken from the
  // BARE read, which returns the subject alone; the `?relatives=true` body
  // carries relatives' references too, which are not this question.
  const inlineTargets = findCollabArrays(bare.body ?? {})
    .flatMap((f) => f.items.map(hrefOf))
    .filter((h): h is string => typeof h === "string");
  for (const [i, target] of [...new Set(inlineTargets)].entries()) {
    await ask(`discussion${i}`, target);
  }

  // 3 — the issue's two unverified guesses. A 404 here is a finding, not a bug.
  for (const suffix of ["notes", "discussion-references"]) {
    await ask(`guess.${suffix}`, `${TREE_PERSONS_BASE}/${encodeURIComponent(effectivePid)}/${suffix}`);
  }

  const parentIds = withRelatives.body === null ? [] : parentIdsOf(withRelatives.body, effectivePid);
  return {
    pid,
    effectivePid,
    name: nameOf(bare.body, effectivePid) ?? nameOf(withRelatives.body, effectivePid),
    linksKeys: bare.body?.links ? Object.keys(bare.body.links) : [],
    parents: parentIds.map((id) => ({ pid: id, name: nameOf(withRelatives.body, id) })),
    requests,
  };
}

// ─── verdict ──────────────────────────────────────────────────────────────

/**
 * The issue's mapping plus the row it omits. A run that never reached
 * FamilySearch, or a redirect, or a non-200 on the subject's own person read, is
 * INCONCLUSIVE — reporting any of those as "does not return them" is how step 2
 * gets cancelled on a false negative.
 */
export function verdict(summaries: Obj[]): Obj {
  const requests: Obj[] = summaries.flatMap((s) => s.requests as Obj[]);
  const reached = requests.filter((r) => r.status !== 0);
  const threw = requests.filter((r) => r.status === 0);
  const withContent = requests.filter((r) => (r.collabItemCount as number) > 0);
  const testerNote = requests.filter((r) => r.mentions1788 === true);
  const personReads = requests.filter((r) => r.treePersonStatus !== undefined);
  // The SUBJECT's own bare read is the one that discovers the `links` keys, so
  // a negative is only readable if it returned a body. A followed 301 answers
  // as `person.merged`, so either spelling counts. Parents are excluded: one
  // being restricted or living limits the sweep, it does not invalidate the run.
  const subjectsWithoutBody = summaries
    .filter((s) => s.sweptAs !== "parent")
    .filter((s) => {
      const primary = (s.requests as Obj[]).filter(
        (r) => r.label === "person" || r.label === "person.merged",
      );
      return !primary.some((r) => r.status === 200);
    });
  const unfollowedRedirect = requests.filter(
    (r) =>
      r.treePersonStatus === undefined &&
      (r.status as number) >= 300 &&
      (r.status as number) < 400,
  );

  if (reached.length === 0) {
    return {
      verdict: "INCONCLUSIVE",
      why: "no request reached FamilySearch (every status is 0 — typically no valid token; run dev/try-login.ts)",
      errors: [...new Set(requests.map((r) => r.error).filter(Boolean))],
    };
  }
  if (testerNote.length > 0) {
    return {
      verdict: "RETURNS THEM",
      why: "a response carries text containing 1788 — confirm by eye against the tester's note in the .out.json",
      at: testerNote.map((r) => r.label),
    };
  }
  if (withContent.length > 0) {
    return {
      verdict: "RETURNS NOTES/DISCUSSIONS, but not the tester's note",
      why: "collaborate arrays came back populated; the 1788 will was not among them",
      at: withContent.map((r) => ({ label: r.label, count: r.collabItemCount })),
    };
  }
  if (requests.some((r) => r.impervaHtml === true)) {
    return { verdict: "INCONCLUSIVE", why: "a 403 with an HTML body — that is Imperva, not the API" };
  }
  if (subjectsWithoutBody.length > 0) {
    return {
      verdict: "INCONCLUSIVE",
      why: "a subject's own person read returned no body, so the links discovery never ran and nothing was meaningfully asked of the notes endpoints. On this endpoint 204 is a living person and 403 is a person not viewable — both person-level answers that say nothing about whether the API serves collaborate notes",
      at: subjectsWithoutBody.map((s) => ({
        pid: s.pid,
        reads: (s.requests as Obj[])
          .filter((r) => r.treePersonStatus !== undefined)
          .map((r) => ({ label: r.label, status: r.status, treePersonStatus: r.treePersonStatus })),
      })),
    };
  }
  // A partial failure is not a negative: the one endpoint that threw may be the
  // one that holds the notes. Only a run where everything answered can say no.
  if (threw.length > 0) {
    return {
      verdict: "INCONCLUSIVE",
      why: "some requests never reached FamilySearch, so no negative can be read from this run",
      at: threw.map((r) => ({ label: r.label, error: r.error })),
    };
  }
  if (unfollowedRedirect.length > 0) {
    return {
      verdict: "INCONCLUSIVE",
      why: "a request answered with a redirect that was not followed, so its body was never read",
      at: unfollowedRedirect.map((r) => ({ label: r.label, status: r.status, location: r.location })),
    };
  }
  return {
    verdict: "DOES NOT RETURN THEM",
    why: "every endpoint answered, and none carried a note or discussion",
    statuses: requests.map((r) => ({ label: r.label, status: r.status })),
    caveat:
      "Only evidence if the Collaborate tab demonstrably had content at the same moment — check the UI and the parent sweep before reporting this.",
  };
}

// ─── run ──────────────────────────────────────────────────────────────────

const OUT = "dev/probe-person-notes.out.json";

/** Only sweep when invoked directly, so `verdict()` can be imported and checked
 *  without the import making live FamilySearch calls. */
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const NO_PARENTS = process.argv.includes("--no-parents");
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const subjects = args.length > 0 ? args : ["LZPF-WMT"];

  const raw: Obj = {};
  const summaries: Obj[] = [];

  try {
    for (const pid of subjects) summaries.push(await probePerson(pid, raw));

    if (!NO_PARENTS) {
      // Both spellings: a merged subject was probed under its survivor id, and
      // that survivor must not be swept again as somebody's parent.
      const seen = new Set<string>([
        ...subjects,
        ...summaries.map((s) => s.effectivePid as string),
      ]);
      const parents = summaries
        .flatMap((s) => (s.parents ?? []) as Obj[])
        .map((p) => p.pid as string)
        .filter((p) => !seen.has(p));
      for (const parent of [...new Set(parents)]) {
        summaries.push({ ...(await probePerson(parent, raw)), sweptAs: "parent" });
      }
    }

    console.log(JSON.stringify({ subjects, summaries, verdict: verdict(summaries) }, null, 2));
  } finally {
    writeFileSync(OUT, JSON.stringify({ summaries, raw }, null, 2), { encoding: "utf-8" });
    console.error(`raw bodies written to ${OUT}`);
  }
}
