/**
 * Evidence for issue #1689 Half 3 — relatives' attached sources.
 *
 * WHY THIS EXISTS. The lead ruled (2026-08-27) that `person_read` returns relatives'
 * attached sources as ordinary `sources[]` entries. The tree-read body already carries
 * relatives' source REFS, but as full URLs to descriptions FamilySearch does not send in
 * that body, so `keepResolvablePersonSourceRefs` drops them (0/102 and 2/79 resolved,
 * probe 2026-09-30). This probe settles HOW to resolve them, and at what cost, before any
 * production code is written — the same discipline Half 2 used with `probe-memories.ts`.
 *
 * WHAT IT MUST ANSWER (the plan's step 0, `docs/plan/1689-half3-relatives-sources.md`):
 *
 *   1. What shape is a relative's ref — full URL, `#fragment`, or mixed?
 *   2. Is `descriptionId` always present beside a URL ref, and does the URL's last
 *      segment equal it? This decides the ref rewrite. A derivation that can disagree
 *      with the id it names is worse than carrying the id upstream already sends.
 *   3. Which call resolves a description: GET the ref URL, a batch endpoint, or
 *      `/persons/{pid}/sources` per relative?
 *   4. How many calls AND how much wall time, measured against the 40s
 *      `OCR_PHASE_BUDGET_MS` the read already shares. Call count alone cannot say
 *      whether a per-relative endpoint blows the budget at 63 relatives.
 *   5. Response size for the big subject — the figure the ruling requires in the PR body.
 *   6. Do two relatives sharing a source yield a duplicate description?
 *
 * It answers 1, 2, 5 and 6 from one tree read per subject, and probes 3/4 with a bounded
 * sample rather than firing 102 requests to learn the shape of one.
 *
 * Usage:  npx tsx dev/probe-relative-sources.ts [--out probe.json] [--resolve N]
 */
import { writeFileSync } from "node:fs";
import { LOCAL } from "../src/auth/principal.js";
import { fsFetch } from "../src/utils/fs-fetch.js";

// The two subjects the 2026-09-30 probe measured, named in `person-read.ts`'s docstring:
// 17/17 and 24/24 of their OWN refs resolve, 0/102 and 2/79 of their relatives' do.
// Reused deliberately — the same people make the before/after comparable.
const SUBJECTS = ["LVJK-9TQ", "KNDX-MKG"];

const TREE_BASE = "https://api.familysearch.org/platform/tree/persons";
const ACCEPT = "application/x-fs-v1+json";

interface RawRef {
  description?: string;
  descriptionId?: string;
  [k: string]: unknown;
}
interface RawPerson {
  id?: string;
  sources?: RawRef[];
  [k: string]: unknown;
}

const lastSegment = (url: string): string => {
  const noHash = url.split("#")[0];
  const parts = noHash.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
};

async function treeRead(pid: string): Promise<{ body: unknown; bytes: number; ms: number }> {
  const started = Date.now();
  const res = await fsFetch(
    LOCAL,
    `${TREE_BASE}/${encodeURIComponent(pid)}?relatives=true&sourceDescriptions=true`,
    { headers: { Accept: ACCEPT, "Accept-Language": "en" } },
  );
  const text = await res.text();
  return { body: JSON.parse(text), bytes: text.length, ms: Date.now() - started };
}

/** Q3 candidate (a): GET the ref URL itself. The cheapest thing that could work. */
async function resolveByUrl(url: string): Promise<{ ok: boolean; status: number; id: string | null; ms: number }> {
  const started = Date.now();
  try {
    const res = await fsFetch(LOCAL, url, { headers: { Accept: ACCEPT } });
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, status: res.status, id: null, ms };
    const body = (await res.json()) as { sourceDescriptions?: Array<{ id?: string }> };
    return {
      ok: true,
      status: res.status,
      id: body.sourceDescriptions?.[0]?.id ?? null,
      ms,
    };
  } catch (err) {
    return { ok: false, status: -1, id: String((err as Error)?.message ?? err) as never, ms: Date.now() - started };
  }
}

/** Q3 candidate (c): the per-person sources endpoint. N calls, one per relative. */
async function resolveByPerson(pid: string): Promise<{ ok: boolean; status: number; count: number; ms: number }> {
  const started = Date.now();
  try {
    const res = await fsFetch(LOCAL, `${TREE_BASE}/${encodeURIComponent(pid)}/sources`, {
      headers: { Accept: ACCEPT },
    });
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, status: res.status, count: 0, ms };
    const body = (await res.json()) as { sourceDescriptions?: unknown[] };
    return { ok: true, status: res.status, count: (body.sourceDescriptions ?? []).length, ms };
  } catch {
    return { ok: false, status: -1, count: 0, ms: Date.now() - started };
  }
}

async function main(): Promise<void> {
  const outFlag = process.argv.indexOf("--out");
  const out = outFlag >= 0 ? process.argv[outFlag + 1] : "dev/probe-relative-sources.json";
  const rFlag = process.argv.indexOf("--resolve");
  const resolveSample = rFlag >= 0 ? Number(process.argv[rFlag + 1]) : 3;

  const captured: unknown[] = [];

  for (const pid of SUBJECTS) {
    process.stderr.write(`\n=== ${pid} ===\n`);
    const { body, bytes, ms } = await treeRead(pid);
    const persons = ((body as { persons?: RawPerson[] }).persons ?? []) as RawPerson[];
    const descriptions = ((body as { sourceDescriptions?: Array<{ id?: string }> })
      .sourceDescriptions ?? []);
    const presentIds = new Set(descriptions.map((d) => d.id).filter(Boolean) as string[]);

    // Q1/Q2, over every ref on every person that is not the subject.
    let urlForm = 0, fragForm = 0, otherForm = 0;
    let withDescriptionId = 0, lastSegMatches = 0, lastSegDiffers = 0;
    let resolvesToday = 0;
    const urlRefs: string[] = [];
    const refOwners = new Map<string, string[]>();

    for (const p of persons) {
      if (!p.id || p.id === pid) continue;
      for (const r of p.sources ?? []) {
        const ref = r.description ?? "";
        if (!ref) { otherForm += 1; continue; }
        if (presentIds.has(ref.replace(/^#/, ""))) resolvesToday += 1;
        if (ref.startsWith("#")) fragForm += 1;
        else if (/^https?:\/\//.test(ref)) {
          urlForm += 1;
          urlRefs.push(ref);
          if (r.descriptionId) {
            withDescriptionId += 1;
            if (lastSegment(ref) === r.descriptionId) lastSegMatches += 1;
            else lastSegDiffers += 1;
          }
          const key = r.descriptionId ?? lastSegment(ref);
          refOwners.set(key, [...(refOwners.get(key) ?? []), p.id]);
        } else otherForm += 1;
      }
    }

    const shared = [...refOwners.entries()].filter(([, owners]) => owners.length > 1);

    process.stderr.write(
      `  tree read ${bytes} bytes in ${ms}ms; ${persons.length} persons, ` +
        `${descriptions.length} descriptions\n` +
        `  relative refs: ${urlForm} url, ${fragForm} fragment, ${otherForm} other; ` +
        `${resolvesToday} resolve today\n` +
        `  descriptionId present on ${withDescriptionId}/${urlForm} url refs; ` +
        `lastSegment matches ${lastSegMatches}, differs ${lastSegDiffers}\n` +
        `  sources shared by >1 relative: ${shared.length}\n`,
    );

    // Q3/Q4 — bounded. Enough to learn the shape and the per-call latency without
    // firing 102 requests, which would answer no question the sample does not.
    const sampleUrls = urlRefs.slice(0, resolveSample);
    const byUrl = [];
    for (const u of sampleUrls) byUrl.push({ url: u, ...(await resolveByUrl(u)) });

    const relativeIds = persons.map((p) => p.id).filter((x): x is string => !!x && x !== pid);
    const byPerson = [];
    for (const rid of relativeIds.slice(0, resolveSample)) {
      byPerson.push({ personId: rid, ...(await resolveByPerson(rid)) });
    }

    const medianMs = (xs: number[]) =>
      xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null;

    // Q5 — how much the RESPONSE grows, which is the figure the ruling wants. The raw
    // FS body is the wrong number: it is dominated by metadata the converter drops
    // (KNDX-MKG's body is larger than LVJK-9TQ's while carrying half the persons). What
    // costs context is the converted `sources[]` entry, so measure one of those and
    // multiply by the refs that would be added.
    const sampleDescBytes: number[] = [];
    for (const d of descriptions.slice(0, 5)) {
      // A TreeSource carries id/title/citation/uri — the converter's shape, not FS's.
      const dd = d as { id?: string; titles?: Array<{ value?: string }>; citations?: Array<{ value?: string }>; about?: string };
      sampleDescBytes.push(
        JSON.stringify({
          id: dd.id ?? "",
          title: dd.titles?.[0]?.value ?? "",
          citation: dd.citations?.[0]?.value ?? "",
          uri: dd.about ?? "",
        }).length,
      );
    }
    const medianDescBytes = sampleDescBytes.length
      ? [...sampleDescBytes].sort((a, b) => a - b)[Math.floor(sampleDescBytes.length / 2)]
      : 0;
    const addedBytes = medianDescBytes * urlForm;
    process.stderr.write(
      `  size: median converted description ${medianDescBytes}B; ` +
        `${urlForm} relative refs would add ~${Math.round(addedBytes / 1024)}KB\n`,
    );

    process.stderr.write(
      `  resolve by URL:    ${byUrl.filter((x) => x.ok).length}/${byUrl.length} ok, ` +
        `median ${medianMs(byUrl.map((x) => x.ms))}ms\n` +
        `  resolve by person: ${byPerson.filter((x) => x.ok).length}/${byPerson.length} ok, ` +
        `median ${medianMs(byPerson.map((x) => x.ms))}ms\n`,
    );

    captured.push({
      subject: pid,
      treeRead: { bytes, ms, persons: persons.length, descriptions: descriptions.length },
      refShape: { urlForm, fragForm, otherForm, resolvesToday },
      descriptionId: { present: withDescriptionId, lastSegMatches, lastSegDiffers },
      sharedAcrossRelatives: shared.length,
      relativesTotal: relativeIds.length,
      resolveByUrl: byUrl,
      resolveByPerson: byPerson,
      sizeGrowth: {
        medianConvertedDescriptionBytes: medianDescBytes,
        relativeRefs: urlForm,
        addedBytes,
        addedKB: Math.round(addedBytes / 1024),
      },
      // Q4 projection, stated as arithmetic rather than measured at 63 — the sample's
      // median times the real relative count, against the 40s shared budget.
      projectedPerPersonMs: medianMs(byPerson.map((x) => x.ms)) !== null
        ? medianMs(byPerson.map((x) => x.ms))! * relativeIds.length
        : null,
      projectedPerUrlMs: medianMs(byUrl.map((x) => x.ms)) !== null
        ? medianMs(byUrl.map((x) => x.ms))! * urlForm
        : null,
    });
  }

  writeFileSync(
    out,
    JSON.stringify({ captured_at: new Date().toISOString().slice(0, 10), probes: captured }, null, 2),
    "utf8",
  );
  process.stderr.write(`\nwrote ${out} (${captured.length} subjects)\n`);
}

void main();
