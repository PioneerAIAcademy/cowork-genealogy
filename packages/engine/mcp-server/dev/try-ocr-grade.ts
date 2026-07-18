/**
 * OCR quality spike — grading pass. Reads dev/ocr-spike-out/results.json (from
 * try-ocr-compare.ts) and grades each variant transcription against the Opus 4.8
 * ground-truth key, at the FIELD level (genealogically relevant entities), using
 * an Opus judge. The judge sees TEXT ONLY (never the image), so the Claude-family
 * "home-field" bias is confined to the key, not the scoring.
 *
 * Writes grades.json (+ a per-variant aggregate `summary`) and scorecard.md, and
 * prints a decision-gate readout. Re-runnable without re-transcribing.
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

const DIMS = ["names", "dates", "places", "relationships"] as const;
type Dim = (typeof DIMS)[number];
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

const JUDGE_PROMPT = (key: string, candidate: string) =>
  [
    "You are grading an OCR transcription of a handwritten genealogical record against a REFERENCE transcription (the answer key).",
    "The KEY is a strong transcription produced by a top vision model; treat it as ground truth for what the page says.",
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

async function judge(apiKey: string, key: string, candidate: string): Promise<Grade> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model: JUDGE_MODEL,
        max_tokens: 4000,
        thinking: { type: "disabled" },
        messages: [{ role: "user", content: JUDGE_PROMPT(key, candidate) }],
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

async function main() {
  const apiKey = loadAnthropicKey();
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx !== -1 ? process.argv[onlyIdx + 1].split(",") : undefined;

  const results = JSON.parse(readFileSync(join(OUT_DIR, "results.json"), "utf-8"));
  const variantKeys: string[] = results.meta.variants.map((v: any) => v.key);

  // Merge into any existing grades.json so a --only run adds/updates one image's
  // grades and preserves the rest; the summary is recomputed over all below.
  let priorGradeImages: any = {};
  try {
    priorGradeImages = JSON.parse(readFileSync(join(OUT_DIR, "grades.json"), "utf-8")).images ?? {};
  } catch {
    /* no prior grades */
  }
  const grades: any = { meta: { judgeModel: JUDGE_MODEL, groundTruthModel: results.meta.groundTruthModel }, images: priorGradeImages };

  for (const [slug, img] of Object.entries<any>(results.images)) {
    if (only && !only.includes(slug)) continue;
    if (img.error || !img.groundTruth || img.groundTruth.error || !img.groundTruth.text) {
      console.log(`SKIP ${slug}: no usable ground truth`);
      continue;
    }
    // Degenerate key = no gradeable genealogical content (e.g. a DGS cover/target
    // sheet where every model just reads a film number). Exclude — it carries no
    // discriminating signal and would trivially "match" for every variant.
    if (img.groundTruth.text.trim().length < 50) {
      console.log(`SKIP ${slug}: answer key has no gradeable content ("${img.groundTruth.text.trim().slice(0, 30)}")`);
      continue;
    }
    console.log(`\n=== ${slug} (${img.subset}) ===`);
    const key = img.groundTruth.text;
    const perVariant: Record<string, { key: string }> = {};
    for (const vk of variantKeys) perVariant[vk] = { key: vk };

    const graded = await Promise.all(
      variantKeys.map(async (vk) => {
        const v = img.variants?.[vk];
        if (!v || v.error || !v.text) return { vk, grade: errGrade(v?.error ? `variant error: ${v.error}` : "no candidate text") };
        return { vk, grade: await judge(apiKey, key, v.text) };
      }),
    );

    const out: any = {};
    for (const { vk, grade } of graded) {
      out[vk] = grade;
      const fa = fieldAccuracy(grade);
      console.log(`  ${vk.padEnd(22)} ${grade.error ? "ERROR " + grade.error.slice(0, 80) : `acc ${fa != null ? (fa * 100).toFixed(0) + "%" : "n/a"}, halluc ${grade.hallucinations}`}`);
    }
    grades.images[slug] = { subset: img.subset, lang: img.lang, recordType: img.recordType, grades: out };
    writeFileSync(join(OUT_DIR, "grades.json"), JSON.stringify(grades, null, 2));
  }

  // ---- Aggregate per variant on the HARD subset (the decision-relevant set) ----
  grades.summary = buildSummary(results, grades, variantKeys);
  writeFileSync(join(OUT_DIR, "grades.json"), JSON.stringify(grades, null, 2));
  writeFileSync(join(OUT_DIR, "scorecard.md"), renderScorecard(results, grades, variantKeys));

  console.log(`\n${grades.summary.readout}`);
  console.log(`\nGrades: ${join(OUT_DIR, "grades.json")}\nScorecard: ${join(OUT_DIR, "scorecard.md")}`);
}

function buildSummary(results: any, grades: any, variantKeys: string[]) {
  const subsets = ["hard", "control"] as const;
  const agg: any = {};
  for (const subset of subsets) {
    agg[subset] = {};
    for (const vk of variantKeys) {
      const acc: number[] = [];
      let halluc = 0, htC = 0, htW = 0;
      const costs: number[] = [], lats: number[] = [];
      let graded = 0;
      for (const [slug, gimg] of Object.entries<any>(grades.images)) {
        if (gimg.subset !== subset) continue;
        const g: Grade = gimg.grades[vk];
        if (!g || g.error) continue;
        const fa = fieldAccuracy(g);
        if (fa != null) { acc.push(fa); graded++; }
        halluc += g.hallucinations;
        htC += g.hardTokens?.correct ?? 0;
        htW += g.hardTokens?.wrong ?? 0;
        const rv = results.images[slug]?.variants?.[vk];
        if (rv && !rv.error) {
          if (rv.costUSD != null) costs.push(rv.costUSD);
          if (rv.latencyMs != null) lats.push(rv.latencyMs);
        }
      }
      agg[subset][vk] = {
        n: graded,
        fieldAccuracy: acc.length ? mean(acc) : null,
        hallucinationsTotal: halluc,
        hardTokenAccuracy: htC + htW > 0 ? htC / (htC + htW) : null,
        avgCostUSD: costs.length ? mean(costs) : null,
        avgLatencyMs: lats.length ? mean(lats) : null,
      };
    }
  }

  // Decision gate: best Qwen vs Claude Sonnet 4.6 (A1) on the HARD subset.
  const hard = agg.hard;
  const a1 = hard["A1_sonnet46"];
  const qwenKeys = variantKeys.filter((k) => k.toLowerCase().includes("qwen"));
  let bestQwen: string | null = null;
  for (const k of qwenKeys) {
    if (hard[k]?.fieldAccuracy == null) continue;
    if (bestQwen == null || hard[k].fieldAccuracy > hard[bestQwen].fieldAccuracy) bestQwen = k;
  }
  const lines: string[] = ["DECISION GATE (hard subset, vs Claude Sonnet 4.6 = A1):"];
  if (a1?.fieldAccuracy != null && bestQwen) {
    const bq = hard[bestQwen];
    const g1 = bq.fieldAccuracy >= a1.fieldAccuracy;
    const g2 = bq.hallucinationsTotal <= a1.hallucinationsTotal;
    const g3 = bq.avgCostUSD != null && a1.avgCostUSD != null && bq.avgCostUSD < a1.avgCostUSD;
    lines.push(`  best Qwen = ${bestQwen} (acc ${pct(bq.fieldAccuracy)}) vs A1 acc ${pct(a1.fieldAccuracy)} -> ${g1 ? "PASS" : "FAIL"} (gate 1: matches/beats)`);
    lines.push(`  halluc: best Qwen ${bq.hallucinationsTotal} vs A1 ${a1.hallucinationsTotal} -> ${g2 ? "PASS" : "FAIL"} (gate 2: no worse)`);
    lines.push(`  cost: best Qwen $${fmt(bq.avgCostUSD)} vs A1 $${fmt(a1.avgCostUSD)} -> ${g3 ? "PASS" : "FAIL"} (gate 3: materially cheaper)`);
    lines.push(`  => ${g1 && g2 && g3 ? "GATE PASSES (subject to the Opus-key caveat)" : "GATE DOES NOT FULLY PASS"}`);
  } else {
    lines.push("  insufficient graded data to evaluate the gate.");
  }
  return { hard, control: agg.control, bestQwen, readout: lines.join("\n") };
}

function renderScorecard(results: any, grades: any, variantKeys: string[]): string {
  const labels: Record<string, string> = {};
  for (const v of results.meta.variants) labels[v.key] = v.label;
  const L: string[] = [];
  L.push("# OCR spike scorecard\n");
  L.push(`Ground truth: **${results.meta.groundTruthModel}** (thinking disabled). Judge: **${grades.meta.judgeModel}**.\n`);
  L.push("> Field accuracy = (correct + 0.5·partial) / all key entities, across names/dates/places/relationships. Hallucinations weighted heavily.\n");

  for (const subset of ["hard", "control"] as const) {
    L.push(`\n## Aggregate — ${subset} subset\n`);
    L.push("| Variant | n | Field acc | Halluc (total) | Hard-token acc | Avg $ | Avg latency |");
    L.push("|---|--:|--:|--:|--:|--:|--:|");
    for (const vk of variantKeys) {
      const a = grades.summary[subset][vk];
      L.push(`| ${labels[vk] ?? vk} | ${a.n} | ${a.fieldAccuracy != null ? pct(a.fieldAccuracy) : "—"} | ${a.hallucinationsTotal} | ${a.hardTokenAccuracy != null ? pct(a.hardTokenAccuracy) : "—"} | ${a.avgCostUSD != null ? "$" + fmt(a.avgCostUSD) : "—"} | ${a.avgLatencyMs != null ? (a.avgLatencyMs / 1000).toFixed(1) + "s" : "—"} |`);
    }
  }

  L.push(`\n## Decision gate\n\n\`\`\`\n${grades.summary.readout}\n\`\`\`\n`);

  L.push("\n## Per-image detail\n");
  for (const [slug, gimg] of Object.entries<any>(grades.images)) {
    L.push(`\n### ${slug} — ${gimg.lang}, ${gimg.recordType} (${gimg.subset})\n`);
    L.push("| Variant | Field acc | names c/p/w/m | dates | places | rels | Halluc | Note |");
    L.push("|---|--:|--|--|--|--|--:|---|");
    for (const vk of variantKeys) {
      const g: Grade = gimg.grades[vk];
      if (!g) continue;
      if (g.error) { L.push(`| ${labels[vk] ?? vk} | ERROR | | | | | | ${g.error.slice(0, 60)} |`); continue; }
      const fa = fieldAccuracy(g);
      const cell = (t: Tally) => `${t.correct}/${t.partial}/${t.wrong}/${t.missed}`;
      L.push(`| ${labels[vk] ?? vk} | ${fa != null ? pct(fa) : "—"} | ${cell(g.names)} | ${cell(g.dates)} | ${cell(g.places)} | ${cell(g.relationships)} | ${g.hallucinations} | ${(g.note ?? "").replace(/\|/g, "/").slice(0, 80)} |`);
    }
  }
  return L.join("\n") + "\n";
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x: number) => (x * 100).toFixed(0) + "%";
const fmt = (x: number | null) => (x == null ? "—" : x.toFixed(4));

main().catch((e) => { console.error(e); process.exit(1); });
