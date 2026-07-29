/**
 * Probe — does enriching the ranker's subject document actually lift the
 * FamilySearch match-score distribution?
 *
 * This is the measurement gate for the C2 change in
 * docs/plan/research-performance-2026-07-27.md. The unit tests prove the
 * enrichment *fires* (facts reach scorePair, other people's evidence does not
 * leak in, withholding triggers). They cannot prove it *works* — that the
 * scores move — because the scoring is FamilySearch's matchTwoExamples engine.
 * Only a live A/B answers that, and its failure mode is silent: an enriched
 * subject that still scores ~0 returns a perfectly plausible-looking result.
 *
 * WHY THIS MATTERS (the finding C2 responds to). In a real 5-hour session
 * (feedback bundle 2026-07-27, "James L. Stephens's Parents"),
 * `rank_search_matches` ran 14 times against 128 eligible searches. Every call
 * scored near-zero: `subjectResolvable: false` on 9 of 14, 129 scores with a
 * median of 0.00135. Every tree person had `ark: null` — the sparse-local-stub
 * case rank-search-matches-tool-spec.md §"Thin / unresolvable subject"
 * predicts. The agent rationally stopped using the tool and hand-triaged up to
 * 50 raw stubs per search instead, which is most of that session's 780k tokens
 * of search payload.
 *
 * WHAT IT DOES
 *   For one subject and one already-staged/finalized result set, it scores
 *   every candidate TWICE against live FamilySearch:
 *     A. the BARE tree person   — the pre-C2 behavior (`{persons:[subject]}`)
 *     B. the ENRICHED subject   — tree person + every assertion linked to it
 *                                 through research.json's `person_evidence`
 *   then prints both distributions side by side, plus the per-candidate delta.
 *
 * HOW TO READ IT
 *   - `above floor` is the count clearing DEGENERATE_FLOOR (0.01). If B lifts
 *     this from 0 to a meaningful number, C2 works for this subject.
 *   - If B's median is still ~0 while the subject gained facts, enrichment is
 *     not enough for an ark-less subject and C2b's withhold path is the honest
 *     outcome — say so in the plan rather than shipping a fallback that lies.
 *   - `enriched facts: 0` means the project had no `person_evidence` links for
 *     this person, so B == A by construction. That is a finding about the
 *     workflow (extraction ran too late), not about the scoring.
 *
 * USAGE
 *   npx tsx dev/probe-rank-enrichment.ts \
 *     --project /path/to/project --subject I1 [--results results/log_007.json]
 *
 *   --results defaults to the largest results/log_*.json in the project.
 *
 *   Requires FamilySearch tokens (`npx tsx dev/try-login.ts`, or `make
 *   e2e-login`). Costs one matchTwoExamples call per candidate PER ARM, so a
 *   50-candidate sidecar is 100 calls — point it at a small sidecar first.
 *
 *   NOTE on feedback bundles: a submitted bundle ships `tree.gedcomx.json`
 *   with living people redacted and the unredacted tree beside it as
 *   `tree.gedcomx.json.bak`. Copy the .bak over the redacted file before
 *   probing, or the subject's own name/facts may be blanked and arm B will
 *   understate.
 */

import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { getValidToken } from "../src/auth/refresh.js";
import { scorePair } from "../src/utils/match-engine.js";
import { mapWithConcurrency, withRetry } from "../src/utils/place-resolver.js";
import { buildSubjectDoc } from "../src/tools/rank-search-matches.js";
import { readStagedResults } from "../src/utils/results-staging.js";
import type { SimplifiedGedcomX } from "../src/types/gedcomx.js";
import type { RecordSearchResult } from "../src/types/record-search.js";

const DEGENERATE_FLOOR = 0.01;
const CONCURRENCY = 10;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Largest results/log_*.json in the project — the richest candidate pool. */
async function pickResultsRef(projectPath: string): Promise<string> {
  const dir = join(projectPath, "results");
  const names = (await readdir(dir)).filter(
    (n) => n.startsWith("log_") && n.endsWith(".json"),
  );
  if (names.length === 0) {
    throw new Error(`no results/log_*.json under ${dir} — pass --results`);
  }
  const sized = await Promise.all(
    names.map(async (n) => ({ n, size: (await stat(join(dir, n))).size })),
  );
  sized.sort((a, b) => b.size - a.size);
  return `results/${sized[0].n}`;
}

/** The pre-C2 subject doc: the bare tree person, nothing folded in. */
async function bareSubjectDoc(
  projectPath: string,
  subjectId: string,
): Promise<SimplifiedGedcomX> {
  const tree: SimplifiedGedcomX = JSON.parse(
    await readFile(join(projectPath, "tree.gedcomx.json"), "utf-8"),
  );
  const subject = (tree.persons ?? []).find((p) => p.id === subjectId);
  if (!subject) throw new Error(`subjectId '${subjectId}' not in tree.gedcomx.json`);
  return { persons: [subject] };
}

async function scoreAll(
  results: RecordSearchResult[],
  subjectDoc: SimplifiedGedcomX,
  subjectId: string,
  token: string,
): Promise<(number | null)[]> {
  return mapWithConcurrency(results, CONCURRENCY, async (r) => {
    if (!r.gedcomx || !r.primaryId) return null; // same skip the tool applies
    try {
      const res = await withRetry(() =>
        scorePair(
          r.gedcomx as SimplifiedGedcomX,
          r.primaryId as string,
          subjectDoc,
          subjectId,
          token,
        ),
      );
      return res.score ?? null;
    } catch {
      return null;
    }
  });
}

function stats(scores: (number | null)[]) {
  const v = scores.filter((s): s is number => s !== null).sort((a, b) => a - b);
  if (v.length === 0) return { n: 0, median: 0, max: 0, above: 0 };
  return {
    n: v.length,
    median: v[Math.floor(v.length / 2)],
    max: v[v.length - 1],
    above: v.filter((s) => s > DEGENERATE_FLOOR).length,
  };
}

async function main() {
  const projectPath = arg("--project");
  const subjectId = arg("--subject");
  if (!projectPath || !subjectId) {
    console.error(
      "usage: probe-rank-enrichment.ts --project <dir> --subject <treePersonId> [--results results/log_NNN.json]",
    );
    process.exit(2);
  }
  const resultsRef = arg("--results") ?? (await pickResultsRef(projectPath));

  const results = (await readStagedResults(
    projectPath,
    resultsRef,
  )) as RecordSearchResult[];
  const scoreable = results.filter((r) => r.gedcomx && r.primaryId).length;

  const bare = await bareSubjectDoc(projectPath, subjectId);
  const enriched = await buildSubjectDoc(projectPath, subjectId);

  const bareFacts = (bare.persons?.[0] as { facts?: unknown[] })?.facts?.length ?? 0;

  console.log(`project        ${projectPath}`);
  console.log(`subject        ${subjectId}`);
  console.log(`results        ${resultsRef}  (${results.length} rows, ${scoreable} scoreable)`);
  console.log(`subject ark    ${(bare.persons?.[0] as { ark?: string })?.ark ?? "null (local stub)"}`);
  console.log(`facts  bare    ${bareFacts}`);
  console.log(
    `facts  enriched ${bareFacts + enriched.enrichedFacts}` +
      `  (+${enriched.enrichedFacts} facts, +${enriched.enrichedNames} names` +
      `${enriched.enrichedGender ? ", +gender" : ""} from person_evidence; ` +
      `${enriched.discriminatingFacts} facts carry a date or place)`,
  );
  const contributed =
    enriched.enrichedFacts + enriched.enrichedNames + (enriched.enrichedGender ? 1 : 0);
  if (contributed === 0) {
    console.log(
      "\n!! enrichment contributed nothing — no person_evidence links for this\n" +
        "   person, or everything linked was already on the tree person. Arm B is\n" +
        "   identical to arm A, so any score difference below is measurement noise.",
    );
  } else if (enriched.enrichedFacts === 0) {
    console.log(
      `\n   NOTE: enrichment added no FACTS, only ${enriched.enrichedNames} name variant(s).\n` +
        "   That is not nothing — name variants alone measurably move the score.",
    );
  }
  console.log("\nscoring both arms against live FamilySearch…\n");

  const token = await getValidToken();
  const a = await scoreAll(results, bare, subjectId, token);
  const b = await scoreAll(results, enriched.doc, subjectId, token);

  const sa = stats(a);
  const sb = stats(b);
  console.log(`arm                scored   median      max   >${DEGENERATE_FLOOR}`);
  console.log(`A bare tree person ${String(sa.n).padStart(6)} ${sa.median.toFixed(5).padStart(8)} ${sa.max.toFixed(3).padStart(8)} ${String(sa.above).padStart(6)}`);
  console.log(`B enriched subject ${String(sb.n).padStart(6)} ${sb.median.toFixed(5).padStart(8)} ${sb.max.toFixed(3).padStart(8)} ${String(sb.above).padStart(6)}`);

  console.log("\nper-candidate (top 20 by arm-B score):");
  const rows = results
    .map((r, i) => ({ name: r.personName ?? r.recordId, a: a[i], b: b[i] }))
    .filter((r) => r.a !== null || r.b !== null)
    .sort((x, y) => (y.b ?? -1) - (x.b ?? -1))
    .slice(0, 20);
  for (const r of rows) {
    const av = r.a === null ? "  skip" : r.a.toFixed(4);
    const bv = r.b === null ? "  skip" : r.b.toFixed(4);
    const d = r.a !== null && r.b !== null ? (r.b - r.a >= 0 ? "+" : "") + (r.b - r.a).toFixed(4) : "";
    console.log(`  ${av.padStart(7)} → ${bv.padStart(7)}  ${d.padStart(8)}   ${String(r.name).slice(0, 44)}`);
  }

  console.log(
    `\nVERDICT: ${
      sb.above > sa.above
        ? `enrichment lifted ${sb.above - sa.above} candidate(s) above the floor — C2 works for this subject.`
        : sb.above === 0 && sa.above === 0
          ? "both arms degenerate — enrichment is NOT sufficient here; C2b's withhold path is the honest outcome."
          : "no improvement in above-floor count; inspect the per-candidate deltas before drawing a conclusion."
    }`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
