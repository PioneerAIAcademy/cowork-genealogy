/**
 * OCR quality spike — grading pass. Reads dev/ocr-spike-out/results.json (from
 * try-ocr-compare.ts) and grades each variant transcription at the FIELD level
 * (genealogically relevant entities) using an Opus judge.
 *
 * TWO KEY SOURCES. Most images are graded against an Opus-4.8 transcription
 * ("opus-4-8"). The typed Holt pages additionally carry a human-verified key
 * from dev/ocr-keys/ ("human") and are graded against BOTH. The delta between
 * the two bounds how far an Opus key flatters an Opus candidate — the one thing
 * an Opus-keyed benchmark cannot tell you about itself.
 *
 * Aggregates are therefore per (subset, keySource) CELL. A mean is never taken
 * across key sources: a human-keyed score and an Opus-keyed score are different
 * measurements that happen to share a scale.
 *
 * The judge sees TEXT ONLY (never the image), so Claude-family home-field bias
 * is confined to the Opus-keyed cells rather than the scoring.
 *
 * Writes grades.json (+ per-cell `summary`) and scorecard.md. Re-runnable
 * without re-transcribing.
 *
 * Usage:
 *   npx tsx dev/try-ocr-grade.ts
 *   npx tsx dev/try-ocr-grade.ts --only cruz-corona
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "ocr-spike-out");
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const ENV_FILE = join(REPO_ROOT, "eval", ".env");
const JUDGE_MODEL = "claude-opus-4-8";
const REQUEST_TIMEOUT_MS = 300_000;

// A key shorter than this carries no gradeable genealogical content (a cover
// sheet, a front-matter page). Applied per key source — see PAIRING below.
const MIN_KEY_CHARS = 50;

// Cowork's device bridge aborts every MCP call at 60s (issue #1638). A model
// that reads better but lands above this line cannot be the Cowork default, so
// the count is reported beside quality rather than left to be remembered.
const COWORK_BRIDGE_ABORT_MS = 60_000;

const DIMS = ["names", "dates", "places", "relationships"] as const;
type Dim = (typeof DIMS)[number];
type KeySource = "human" | "opus-4-8";

interface Tally { correct: number; partial: number; wrong: number; missed: number }
interface Grade {
  names: Tally; dates: Tally; places: Tally; relationships: Tally;
  hallucinations: number;
  hardTokens: { correct: number; wrong: number };
  note: string;
  error?: string;
}

function loadAnthropicKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const t = line.trim();
    if (t.startsWith("ANTHROPIC_API_KEY=")) return t.slice("ANTHROPIC_API_KEY=".length).trim();
  }
  throw new Error("ANTHROPIC_API_KEY not found");
}

/**
 * The judge prompt is parameterised on the material and on where the key came
 * from. Both matter: describing a printed book page as handwritten misstates
 * the task, and — more seriously — telling the judge that a hand-verified
 * transcription "was produced by a top vision model" invites it to excuse
 * candidate-vs-key disagreements as key error. That would hollow out the one
 * cell whose whole purpose is an absolute score.
 */
const JUDGE_PROMPT = (key: string, candidate: string, subset: string, keySource: KeySource) => {
  const material = subset === "typed"
    ? "a printed, typeset genealogy book page"
    : "a handwritten genealogical record";
  const keyProvenance = keySource === "human"
    ? "The KEY is a HAND-VERIFIED HUMAN TRANSCRIPTION. It is correct. Any disagreement between candidate and key is a candidate error, not a key error."
    : "The KEY is a strong transcription produced by a top vision model; treat it as ground truth for what the page says.";
  return [
    `You are grading an OCR transcription of ${material} against a REFERENCE transcription (the answer key).`,
    keyProvenance,
    "Grade the CANDIDATE against the KEY at the level of genealogically relevant ENTITIES, not raw character error rate.",
    "",
    "For each of these dimensions, count how the candidate did on the entities PRESENT IN THE KEY:",
    "  names (surname + given; spelling matters), dates (day/month/year completeness), places, relationships (parents/spouse/sponsors/witnesses).",
    "For each dimension report: correct (matches the key), partial (right entity, minor error/incomplete), wrong (present but materially different), missed (in the key, absent from the candidate).",
    "Also report:",
    "  hallucinations: integer count of entities/fields the candidate INVENTED that have no basis in the key (weight this heavily — a fabricated reading is worse than a miss).",
    "  hardTokens: {correct, wrong} for the difficult tokens specifically — patronymics, unusual surnames, and place names.",
    "  note: one short sentence on the candidate's failure mode vs the key.",
    "Minor transcription-style differences (spacing, line breaks, obvious equivalent spellings) are NOT errors.",
    "",
    "Output ONLY a JSON object, no prose, with exactly this shape:",
    '{"names":{"correct":0,"partial":0,"wrong":0,"missed":0},"dates":{...},"places":{...},"relationships":{...},"hallucinations":0,"hardTokens":{"correct":0,"wrong":0},"note":"..."}',
    "",
    "=== KEY (reference) ===",
    key,
    "",
    "=== CANDIDATE (to grade) ===",
    candidate,
  ].join("\n");
};

async function judge(
  apiKey: string, key: string, candidate: string, subset: string, keySource: KeySource,
): Promise<Grade> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model: JUDGE_MODEL,
        max_tokens: 4000,
        thinking: { type: "disabled" },
        messages: [{ role: "user", content: JUDGE_PROMPT(key, candidate, subset, keySource) }],
      }),
    });
    const json = await res.json();
    if (!res.ok) return errGrade(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    const text = (json.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first === -1 || last === -1) return errGrade(`no JSON in judge output: ${text.slice(0, 200)}`);
    return JSON.parse(text.slice(first, last + 1)) as Grade;
  } catch (e) {
    return errGrade(String(e));
  }
}

function errGrade(msg: string): Grade {
  return { names: z(), dates: z(), places: z(), relationships: z(), hallucinations: 0, hardTokens: { correct: 0, wrong: 0 }, note: "", error: msg };
}
function z(): Tally { return { correct: 0, partial: 0, wrong: 0, missed: 0 }; }

// field accuracy = (correct + 0.5*partial) / total, across the 4 entity dims
function fieldAccuracy(g: Grade): number | null {
  let num = 0, den = 0;
  for (const d of DIMS) {
    const t = g[d];
    num += t.correct + 0.5 * t.partial;
    den += t.correct + t.partial + t.wrong + t.missed;
  }
  return den === 0 ? null : num / den;
}

/**
 * The keys available for one image, after the degenerate-key rule.
 *
 * PAIRING: a page excluded under EITHER key source is excluded under BOTH.
 * The guard is per key, and holt-004's human key is 7 characters while Opus may
 * well write more than 50 for the same near-blank page — which would leave the
 * two typed cells averaged over different page sets and fold a whole page's
 * score into the flattery delta.
 */
function usableKeys(img: any): Array<{ keySource: KeySource; text: string }> {
  const candidates: Array<{ keySource: KeySource; text: string }> = [];
  if (img.groundTruth && !img.groundTruth.error && img.groundTruth.text) {
    candidates.push({ keySource: "opus-4-8", text: img.groundTruth.text });
  }
  if (typeof img.humanKey === "string" && img.humanKey.length > 0) {
    candidates.push({ keySource: "human", text: img.humanKey });
  }
  if (candidates.length === 0) return [];
  if (candidates.some((c) => c.text.trim().length < MIN_KEY_CHARS)) return [];
  return candidates;
}

async function main() {
  const apiKey = loadAnthropicKey();
  const onlyIdx = process.argv.indexOf("--only");
  if (onlyIdx !== -1 && onlyIdx + 1 >= process.argv.length) {
    throw new Error("--only requires a comma-separated list of image slugs");
  }
  const only = onlyIdx !== -1
    ? process.argv[onlyIdx + 1].split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const results = JSON.parse(readFileSync(join(OUT_DIR, "results.json"), "utf-8"));
  const variantKeys: string[] = results.meta.variants.map((v: any) => v.key);

  // Reject unknown slugs before judging. Without this a typo grades nothing and
  // then still rewrites scorecard.md from stale prior grades — a deliverable
  // that silently describes an older run.
  const unknown = (only ?? []).filter((s) => !(s in results.images));
  if (unknown.length > 0) {
    throw new Error(
      `--only: unknown image slug(s): ${unknown.join(", ")}\n` +
        `Transcribed slugs: ${Object.keys(results.images).join(", ")}`,
    );
  }

  // Merge into any existing grades.json so a --only run adds/updates one image's
  // grades and preserves the rest; the summary is recomputed over all below.
  let priorGradeImages: any = {};
  try {
    priorGradeImages = JSON.parse(readFileSync(join(OUT_DIR, "grades.json"), "utf-8")).images ?? {};
  } catch {
    /* no prior grades */
  }
  const grades: any = {
    meta: { judgeModel: JUDGE_MODEL, groundTruthModel: results.meta.groundTruthModel },
    images: priorGradeImages,
  };

  for (const [slug, img] of Object.entries<any>(results.images)) {
    if (only && !only.includes(slug)) continue;
    if (img.error) { console.log(`SKIP ${slug}: ${String(img.error).slice(0, 80)}`); continue; }

    const keys = usableKeys(img);
    if (keys.length === 0) { console.log(`SKIP ${slug}: no usable answer key`); continue; }

    console.log(`\n=== ${slug} (${img.subset}) — keys: ${keys.map((k) => k.keySource).join(", ")} ===`);
    const byKeySource: Record<string, Record<string, Grade>> = {};

    for (const { keySource, text: key } of keys) {
      const graded = await Promise.all(
        variantKeys.map(async (vk) => {
          const v = img.variants?.[vk];
          if (!v || v.error || !v.text) {
            return { vk, grade: errGrade(v?.error ? `variant error: ${v.error}` : "no candidate text") };
          }
          return { vk, grade: await judge(apiKey, key, v.text, img.subset, keySource) };
        }),
      );
      const out: Record<string, Grade> = {};
      for (const { vk, grade } of graded) {
        out[vk] = grade;
        const fa = fieldAccuracy(grade);
        const tag = grade.error
          ? "ERROR " + grade.error.slice(0, 70)
          : `acc ${fa != null ? (fa * 100).toFixed(0) + "%" : "n/a"}, halluc ${grade.hallucinations}`;
        console.log(`  [${keySource.padEnd(8)}] ${vk.padEnd(22)} ${tag}`);
      }
      byKeySource[keySource] = out;
    }

    grades.images[slug] = {
      subset: img.subset, lang: img.lang, recordType: img.recordType,
      sizeBytes: img.sizeBytes, byKeySource,
    };
    writeFileSync(join(OUT_DIR, "grades.json"), JSON.stringify(grades, null, 2));
  }

  grades.summary = buildSummary(results, grades, variantKeys);
  writeFileSync(join(OUT_DIR, "grades.json"), JSON.stringify(grades, null, 2));
  writeFileSync(join(OUT_DIR, "scorecard.md"), renderScorecard(results, grades, variantKeys));

  console.log(`\n${grades.summary.readout}`);
  console.log(`\nGrades: ${join(OUT_DIR, "grades.json")}\nScorecard: ${join(OUT_DIR, "scorecard.md")}`);
}

/** Every (subset, keySource) cell that actually has graded rows. */
function cellsPresent(grades: any): Array<{ subset: string; keySource: KeySource }> {
  const seen = new Map<string, { subset: string; keySource: KeySource }>();
  for (const gimg of Object.values<any>(grades.images)) {
    for (const keySource of Object.keys(gimg.byKeySource ?? {}) as KeySource[]) {
      seen.set(`${gimg.subset} ${keySource}`, { subset: gimg.subset, keySource });
    }
  }
  return [...seen.values()].sort(
    (a, b) => a.subset.localeCompare(b.subset) || a.keySource.localeCompare(b.keySource),
  );
}

function buildSummary(results: any, grades: any, variantKeys: string[]) {
  const cells = cellsPresent(grades);
  const agg: Record<string, Record<string, any>> = {};

  for (const { subset, keySource } of cells) {
    const cellKey = `${subset}/${keySource}`;
    agg[cellKey] = {};
    for (const vk of variantKeys) {
      const acc: number[] = [];
      const costs: number[] = [], lats: number[] = [];
      let halluc = 0, htC = 0, htW = 0, graded = 0, over60s = 0;
      for (const [slug, gimg] of Object.entries<any>(grades.images)) {
        if (gimg.subset !== subset) continue;
        const g: Grade | undefined = gimg.byKeySource?.[keySource]?.[vk];
        if (!g || g.error) continue;
        const fa = fieldAccuracy(g);
        if (fa != null) { acc.push(fa); graded++; }
        halluc += g.hallucinations;
        htC += g.hardTokens?.correct ?? 0;
        htW += g.hardTokens?.wrong ?? 0;
        const rv = results.images[slug]?.variants?.[vk];
        if (rv && !rv.error) {
          if (rv.costUSD != null) costs.push(rv.costUSD);
          if (rv.latencyMs != null) {
            lats.push(rv.latencyMs);
            if (rv.latencyMs > COWORK_BRIDGE_ABORT_MS) over60s++;
          }
        }
      }
      agg[cellKey][vk] = {
        n: graded,
        fieldAccuracy: acc.length ? mean(acc) : null,
        hallucinationsTotal: halluc,
        hardTokenAccuracy: htC + htW > 0 ? htC / (htC + htW) : null,
        avgCostUSD: costs.length ? mean(costs) : null,
        avgLatencyMs: lats.length ? mean(lats) : null,
        over60s,
      };
    }
  }

  // Flattery bound: the same typed pages, same candidate text, only the key
  // differs. PRE-REGISTERED READING — if every variant is above CEILING in
  // typed/human there is no headroom, so a small delta means the instrument is
  // saturated, NOT that the Opus key is unbiased. Read hallucinations and
  // hard-token accuracy there instead; neither compresses the way a
  // 4-dimension mean does.
  const CEILING = 0.95;
  const lines: string[] = [];
  const human = agg["typed/human"], opus = agg["typed/opus-4-8"];
  if (human && opus) {
    const nH = Math.max(...variantKeys.map((vk) => human[vk]?.n ?? 0));
    const nO = Math.max(...variantKeys.map((vk) => opus[vk]?.n ?? 0));
    lines.push(`KEY-PROVENANCE DELTA (typed pages, human key vs Opus-4.8 key; n=${nH}/${nO}):`);
    if (nH !== nO) lines.push(`  WARNING: cells cover different page counts (${nH} vs ${nO}) — pairing rule failed.`);
    const accs: number[] = [];
    for (const vk of variantKeys) {
      const h = human[vk]?.fieldAccuracy, o = opus[vk]?.fieldAccuracy;
      if (h == null || o == null) continue;
      accs.push(h);
      const d = o - h;
      lines.push(`  ${vk.padEnd(22)} human ${pct(h)}  opus-key ${pct(o)}  delta ${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}pp`);
    }
    lines.push(
      accs.length > 0 && accs.every((a) => a > CEILING)
        ? `  => CEILING REACHED (all variants > ${pct(CEILING)} on the human key). The delta is UNINFORMATIVE:\n` +
          `     report the Opus-5 figure in the handwritten cells as UNBOUNDED, not bounded. Use\n` +
          `     hallucinations and hard-token accuracy as the discriminators here.`
        : `  => delta is interpretable (human-key accuracy is below the ${pct(CEILING)} ceiling).`,
    );
  } else {
    lines.push("KEY-PROVENANCE DELTA: not computable — both typed cells must be graded.");
  }
  return { cells: agg, readout: lines.join("\n") };
}

function renderScorecard(results: any, grades: any, variantKeys: string[]): string {
  const labels: Record<string, string> = {};
  for (const v of results.meta.variants) labels[v.key] = v.label;
  const L: string[] = [];
  L.push("# OCR model comparison — scorecard\n");
  L.push(`Judge: **${grades.meta.judgeModel}**. Opus-keyed cells use **${results.meta.groundTruthModel}** as the answer key; typed pages also carry a hand-verified human key (\`dev/ocr-keys/\`).\n`);
  L.push("> Field accuracy = (correct + 0.5·partial) / all key entities, across names/dates/places/relationships. Hallucinations weighted heavily.");
  L.push(`> \`>60s\` counts calls past Cowork's device-bridge abort (issue #1638) — a model above that line cannot be the Cowork default whatever it scores.`);
  L.push("> **Scores are never averaged across key sources.** Each table below is one (subset, key source) cell.\n");

  for (const { subset, keySource } of cellsPresent(grades)) {
    const cell = grades.summary.cells[`${subset}/${keySource}`];
    const provenance = keySource === "human" ? "hand-verified human key — absolute scores trustworthy"
      : "Opus-4.8 key — an Opus candidate is flattered here";
    L.push(`\n## ${subset} / ${keySource}\n`);
    L.push(`*${provenance}*\n`);
    L.push("| Variant | n | Field acc | Halluc (total) | Hard-token acc | Avg $ | Avg latency | >60s |");
    L.push("|---|--:|--:|--:|--:|--:|--:|--:|");
    for (const vk of variantKeys) {
      const a = cell[vk];
      if (!a) continue;
      L.push(`| ${labels[vk] ?? vk} | ${a.n} | ${a.fieldAccuracy != null ? pct(a.fieldAccuracy) : "—"} | ${a.hallucinationsTotal} | ${a.hardTokenAccuracy != null ? pct(a.hardTokenAccuracy) : "—"} | ${a.avgCostUSD != null ? "$" + fmt(a.avgCostUSD) : "—"} | ${a.avgLatencyMs != null ? (a.avgLatencyMs / 1000).toFixed(1) + "s" : "—"} | ${a.over60s} |`);
    }
  }

  L.push(`\n## Key-provenance delta\n\n\`\`\`\n${grades.summary.readout}\n\`\`\`\n`);

  L.push("\n## Per-image detail\n");
  for (const [slug, gimg] of Object.entries<any>(grades.images)) {
    for (const keySource of Object.keys(gimg.byKeySource ?? {})) {
      L.push(`\n### ${slug} — ${gimg.lang}, ${gimg.recordType} (${gimg.subset}, key: ${keySource})\n`);
      L.push("| Variant | Field acc | names c/p/w/m | dates | places | rels | Halluc | Note |");
      L.push("|---|--:|--|--|--|--|--:|---|");
      for (const vk of variantKeys) {
        const g: Grade = gimg.byKeySource[keySource][vk];
        if (!g) continue;
        if (g.error) { L.push(`| ${labels[vk] ?? vk} | ERROR | | | | | | ${g.error.slice(0, 60)} |`); continue; }
        const fa = fieldAccuracy(g);
        const cellOf = (t: Tally) => `${t.correct}/${t.partial}/${t.wrong}/${t.missed}`;
        L.push(`| ${labels[vk] ?? vk} | ${fa != null ? pct(fa) : "—"} | ${cellOf(g.names)} | ${cellOf(g.dates)} | ${cellOf(g.places)} | ${cellOf(g.relationships)} | ${g.hallucinations} | ${(g.note ?? "").replace(/\|/g, "/").slice(0, 80)} |`);
      }
    }
  }
  return L.join("\n") + "\n";
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x: number) => (x * 100).toFixed(0) + "%";
const fmt = (x: number | null) => (x == null ? "—" : x.toFixed(4));

main().catch((e) => { console.error(e); process.exit(1); });
