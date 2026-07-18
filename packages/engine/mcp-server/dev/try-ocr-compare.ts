/**
 * OCR quality spike — Qwen3-VL vs Claude on FamilySearch scans.
 *
 * Dev-only, NOT shipped. Standalone one-shot per the spike brief
 * (~/pioneeradademy/ocr-quality-spike-plan.md). It:
 *   1. Fetches each T13 "oversize" FamilySearch scan (reusing the repo's auth +
 *      ARK resolution, but WITHOUT image_read's 700 KB inline cap).
 *   2. Produces the enhanced variant via dev/ocr_prep.py (PIL enhance_for_ocr).
 *   3. Runs every model×prep variant with an identical faithful-OCR prompt.
 *   4. Runs Opus 4.8 as the ground-truth ("answer key") transcriber.
 *   5. Records transcription text, wall-clock latency, tokens, and $ per call.
 *
 * Grading against the ground truth is a separate step (dev/try-ocr-grade.ts),
 * so the (live, expensive) transcription pass doesn't have to re-run to re-grade.
 *
 * Usage:
 *   npx tsx dev/try-ocr-compare.ts                 # all images, all variants
 *   npx tsx dev/try-ocr-compare.ts --limit 1       # smoke test: first image only
 *   npx tsx dev/try-ocr-compare.ts --only cruz-corona,birkeland-death
 *   npx tsx dev/try-ocr-compare.ts --variants A1_sonnet46,B_qwenInstruct_raw
 *
 * Requires OPENROUTER_API_KEY and ANTHROPIC_API_KEY (read from eval/.env), and
 * a valid FamilySearch session (~/.familysearch-mcp/tokens.json — auto-refreshed).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { toArk, arkToUrl } from "../src/utils/ark.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "ocr-spike-out");
const PREP_SCRIPT = join(HERE, "ocr_prep.py");
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const ENV_FILE = join(REPO_ROOT, "eval", ".env");
const MAX_LONGEST_SIDE = 2000; // for the enhanced (prep) variant only
const GROUND_TRUTH_MODEL = "claude-opus-4-8";
const REQUEST_TIMEOUT_MS = 300_000;

// ---------------------------------------------------------------------------
// Corpus — the T13 "oversize" scans image_read hard-refuses today, pulled from
// the birk/cruz/zuniga/bottem/… e2e run transcripts, chosen for a language/
// script spread. NOTE (documented gaps): no German Kurrent/Fraktur (the bet's
// headline domain) and no truly clean printed "control" page — T13 is oversize
// hard scans only; the census/marriage forms are printed-form semi-controls.
// ---------------------------------------------------------------------------
interface ImageSpec {
  slug: string;
  scenario: string;
  lang: string;
  recordType: string;
  note: string;
  subset: "hard" | "control";
  languageHint: string;
  imageId?: string;
  ark?: string;
}

const IMAGES: ImageSpec[] = [
  {
    slug: "teitje-harkema",
    scenario: "teitje-harkema-parents-1833",
    lang: "Dutch",
    recordType: "civil/church register (1833)",
    note: "old Dutch hand, ~1.0 MB",
    subset: "hard",
    languageHint:
      "This is a 19th-century Dutch civil/church register (1833), handwritten in old Dutch script.",
    imageId: "004748896_00921",
  },
  {
    slug: "jan-gallo",
    scenario: "jan-gallo-father",
    lang: "Slovak/Hungarian/Latin",
    recordType: "Lutheran parish register (1893)",
    note: "browse-film, very hard, ~1.5 MB",
    subset: "hard",
    languageHint:
      "This is a 19th-century Lutheran parish register from Turany, Slovakia (then Hungary), 1893, handwritten in Slovak, Hungarian, and Latin.",
    ark: "ark:/61903/3:1:33S7-9RQ4-9B4M",
  },
  {
    slug: "birkeland-death",
    scenario: "birkeland-death-1883",
    lang: "Norwegian",
    recordType: "church book, burial (1883)",
    note: "Gothic Norwegian hand, ~0.8 MB",
    subset: "hard",
    languageHint:
      "This is a 19th-century Norwegian church book (1883), handwritten in Gothic (Kurrent-style) Norwegian script.",
    ark: "ark:/61903/3:1:3QHK-93PP-TCSM",
  },
  {
    slug: "cruz-corona",
    scenario: "cruz-corona-ancestry",
    lang: "Spanish",
    recordType: "Mexican civil/parish record (~1910)",
    note: "handwritten Spanish, ~1.9 MB",
    subset: "hard",
    languageHint:
      "This is an early-20th-century Mexican civil-registration / parish record, handwritten in Spanish.",
    ark: "3:1:33S7-9T8R-68V",
  },
  {
    slug: "zuniga-rojas",
    scenario: "zuniga-rojas-parents",
    lang: "Spanish",
    recordType: "Bolivian parish marriage (1913)",
    note: "handwritten Spanish, ~1.7 MB",
    subset: "hard",
    languageHint:
      "This is an early-20th-century Bolivian Catholic parish marriage register (1913), handwritten in Spanish.",
    ark: "ark:/61903/3:1:33SQ-GY3D-9KYN",
  },
  {
    slug: "spriggs-census",
    scenario: "spriggs-parents-1898",
    lang: "English",
    recordType: "US federal census (1910/1920)",
    note: "printed form + handwriting, ~2.3 MB (largest)",
    subset: "control",
    languageHint:
      "This is a U.S. federal census page (1910/1920), a printed form filled in by hand in English.",
    ark: "ark:/61903/3:1:33SQ-GRGT-F9L",
  },
  {
    slug: "rossi-marriage",
    scenario: "rossi-marriage",
    lang: "English",
    recordType: "US marriage record (NY/NJ)",
    note: "printed civil form + handwriting, ~1.1 MB",
    subset: "control",
    languageHint:
      "This is a U.S. civil marriage record (New York / New Jersey), a printed form filled in by hand in English.",
    imageId: "007433501_00215",
  },
  {
    slug: "bottemiller-census",
    scenario: "bottemiller-parents",
    lang: "English",
    recordType: "US federal census (1880)",
    note: "printed form + handwriting, ~0.9 MB",
    subset: "control",
    languageHint:
      "This is an 1880 U.S. federal census page, a printed form filled in by hand in English.",
    imageId: "004539662_00001",
  },
  {
    slug: "elizabeth-geach",
    scenario: "elizabeth-geach-parents",
    lang: "English",
    recordType: "US record, Ohio (1820s)",
    note: "handwritten English, ~1.1 MB",
    subset: "hard",
    languageHint:
      "This is a 19th-century U.S. record from Ohio, handwritten in English.",
    ark: "ark:/61903/3:1:33SQ-GYYJ-S99H",
  },
  {
    slug: "reese-siblings",
    scenario: "reese-siblings",
    lang: "English",
    recordType: "US vital record, New York",
    note: "handwritten English, ~2.0 MB",
    subset: "hard",
    languageHint:
      "This is a late-19th / early-20th-century U.S. vital record from New York, in English.",
    ark: "3:1:33S7-9RK9-BPN",
  },
];

// ---------------------------------------------------------------------------
// Variants — model × prep. Claude stays raw (the image_read baseline path); the
// prep decision is Qwen-specific. Both Claude variants run thinking-disabled to
// isolate raw perception and mirror the production image-reader path; the
// Qwen-Thinking variants cover the thinking-lever axis. H_* is the language-hint
// prompt-tuning sub-test (Qwen instruct, raw).
// ---------------------------------------------------------------------------
type Provider = "anthropic" | "openrouter";
interface Variant {
  key: string;
  label: string;
  provider: Provider;
  model: string;
  prep: boolean;
  hint?: boolean;
}

const VARIANTS: Variant[] = [
  { key: "A1_sonnet46", label: "Claude Sonnet 4.6 (raw)", provider: "anthropic", model: "claude-sonnet-4-6", prep: false },
  { key: "A2_sonnet5", label: "Claude Sonnet 5 (raw)", provider: "anthropic", model: "claude-sonnet-5", prep: false },
  { key: "B_qwenInstruct_raw", label: "Qwen3-VL 235B Instruct (raw)", provider: "openrouter", model: "qwen/qwen3-vl-235b-a22b-instruct", prep: false },
  { key: "C_qwenInstruct_prep", label: "Qwen3-VL 235B Instruct (enhanced)", provider: "openrouter", model: "qwen/qwen3-vl-235b-a22b-instruct", prep: true },
  { key: "B_qwenThinking_raw", label: "Qwen3-VL 235B Thinking (raw)", provider: "openrouter", model: "qwen/qwen3-vl-235b-a22b-thinking", prep: false },
  { key: "C_qwenThinking_prep", label: "Qwen3-VL 235B Thinking (enhanced)", provider: "openrouter", model: "qwen/qwen3-vl-235b-a22b-thinking", prep: true },
  { key: "H_qwenInstruct_hint", label: "Qwen3-VL 235B Instruct (raw + language hint)", provider: "openrouter", model: "qwen/qwen3-vl-235b-a22b-instruct", prep: false, hint: true },
];

// $ per 1M tokens.
const ANTHROPIC_RATES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-sonnet-5": { in: 2.0, out: 10.0 }, // intro pricing through 2026-08-31
  "claude-opus-4-8": { in: 5.0, out: 25.0 },
};

// ---------------------------------------------------------------------------
// The shared faithful-OCR prompt — reused verbatim across every variant AND the
// ground-truth pass so the comparison isolates model + prep, not prompt. Taken
// from the image-reader agent protocol + the spike brief's starting prompt.
// ---------------------------------------------------------------------------
const OCR_PROMPT = [
  "Transcribe every genealogically relevant entry on this record image verbatim:",
  "names, dates, places, ages, relationships, sponsors/witnesses, and marginal notes.",
  "Transcribe the whole page, not just one target entry.",
  "Preserve original spelling, capitalization, and line/row layout. Do not modernize,",
  "normalize, or translate. Mark anything you cannot read [illegible] (or [torn] for",
  "physical damage) — never guess and never slant toward an expected answer.",
  "Output only the transcription.",
].join(" ");

// ---------------------------------------------------------------------------
// env + args
// ---------------------------------------------------------------------------
function loadEnv(): { anthropic: string; openrouter: string } {
  const out: Record<string, string> = {};
  for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  const anthropic = process.env.ANTHROPIC_API_KEY || out.ANTHROPIC_API_KEY;
  const openrouter = process.env.OPENROUTER_API_KEY || out.OPENROUTER_API_KEY;
  if (!anthropic) throw new Error("ANTHROPIC_API_KEY not found (env or eval/.env)");
  if (!openrouter) throw new Error("OPENROUTER_API_KEY not found (env or eval/.env)");
  return { anthropic, openrouter };
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const limit = get("--limit") ? parseInt(get("--limit")!, 10) : undefined;
  const only = get("--only")?.split(",").map((s) => s.trim());
  const variants = get("--variants")?.split(",").map((s) => s.trim());
  return { limit, only, variants };
}

// ---------------------------------------------------------------------------
// FamilySearch fetch — reuses the repo's ARK resolution + auth, without the cap.
// ---------------------------------------------------------------------------
function resolveImageUrl(img: ImageSpec): string {
  if (img.imageId) return `https://familysearch.org/das/v2/dgs:${img.imageId}/dist.jpg`;
  if (img.ark) return arkToUrl(toArk(img.ark));
  throw new Error(`image ${img.slug} has neither imageId nor ark`);
}

async function fetchScan(url: string, token: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "image/*,*/*", "User-Agent": BROWSER_USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`FS fetch failed: ${res.status} ${res.statusText}`);
  const ct = res.headers.get("content-type") ?? "image/jpeg";
  if (!ct.startsWith("image/")) throw new Error(`expected image, got content-type: ${ct}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), mimeType: ct.split(";")[0].trim() };
}

interface PrepInfo {
  raw: { w: number; h: number; bytes: number };
  prep: { w: number; h: number; bytes: number };
}
function runPrep(rawPath: string, prepPath: string): PrepInfo {
  const out = execFileSync(
    "uv",
    ["run", "--quiet", "--with", "Pillow", "python3", PREP_SCRIPT, rawPath, prepPath, String(MAX_LONGEST_SIDE)],
    { encoding: "utf-8" },
  );
  return JSON.parse(out.trim());
}

// ---------------------------------------------------------------------------
// Model calls
// ---------------------------------------------------------------------------
interface CallResult {
  text: string;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  costUSD: number | null;
  reasoningChars?: number;
  error?: string;
}

async function callAnthropic(
  apiKey: string,
  model: string,
  mediaType: string,
  b64: string,
  prompt: string,
): Promise<CallResult> {
  const t0 = Date.now();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        thinking: { type: "disabled" },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });
    const latencyMs = Date.now() - t0;
    const json = await res.json();
    if (!res.ok) return { text: "", latencyMs, tokensIn: null, tokensOut: null, costUSD: null, error: `HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}` };
    const text = (json.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const tokensIn = json.usage?.input_tokens ?? null;
    const tokensOut = json.usage?.output_tokens ?? null;
    const rate = ANTHROPIC_RATES[model];
    const costUSD = rate && tokensIn != null && tokensOut != null ? (rate.in * tokensIn + rate.out * tokensOut) / 1e6 : null;
    return { text, latencyMs, tokensIn, tokensOut, costUSD };
  } catch (e) {
    return { text: "", latencyMs: Date.now() - t0, tokensIn: null, tokensOut: null, costUSD: null, error: String(e) };
  }
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  mediaType: string,
  b64: string,
  prompt: string,
): Promise<CallResult> {
  const t0 = Date.now();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        temperature: 0,
        provider: { data_collection: "deny" }, // PRIVACY: FS scans are PII (shipping requirement)
        usage: { include: true },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mediaType};base64,${b64}` } },
            ],
          },
        ],
      }),
    });
    const latencyMs = Date.now() - t0;
    const json = await res.json();
    if (!res.ok) return { text: "", latencyMs, tokensIn: null, tokensOut: null, costUSD: null, error: `HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}` };
    if (json.error) return { text: "", latencyMs, tokensIn: null, tokensOut: null, costUSD: null, error: `provider error: ${JSON.stringify(json.error).slice(0, 500)}` };
    const msg = json.choices?.[0]?.message ?? {};
    const text = typeof msg.content === "string" ? msg.content : (msg.content ?? []).map((c: any) => c.text ?? "").join("");
    const reasoning = typeof msg.reasoning === "string" ? msg.reasoning : undefined;
    return {
      text,
      latencyMs,
      tokensIn: json.usage?.prompt_tokens ?? null,
      tokensOut: json.usage?.completion_tokens ?? null,
      costUSD: json.usage?.cost ?? null,
      reasoningChars: reasoning ? reasoning.length : undefined,
    };
  } catch (e) {
    return { text: "", latencyMs: Date.now() - t0, tokensIn: null, tokensOut: null, costUSD: null, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const { anthropic, openrouter } = loadEnv();
  const { limit, only, variants: variantFilter } = parseArgs();

  let images = IMAGES;
  if (only) images = images.filter((i) => only.includes(i.slug));
  if (limit != null) images = images.slice(0, limit);
  const variants = variantFilter ? VARIANTS.filter((v) => variantFilter.includes(v.key)) : VARIANTS;

  console.log(`Images: ${images.map((i) => i.slug).join(", ")}`);
  console.log(`Variants: ${variants.map((v) => v.key).join(", ")}`);
  console.log(`Ground truth: ${GROUND_TRUTH_MODEL} (thinking disabled)\n`);

  const token = await getValidToken();
  const results: any = {
    meta: {
      groundTruthModel: GROUND_TRUTH_MODEL,
      variants: variants.map((v) => ({ key: v.key, label: v.label, model: v.model, prep: v.prep, hint: !!v.hint })),
      prompt: OCR_PROMPT,
      maxLongestSidePrep: MAX_LONGEST_SIDE,
      privacyFlag: 'provider.data_collection="deny"',
    },
    images: {},
  };

  const needsPrep = variants.some((v) => v.prep);

  for (const img of images) {
    const slug = img.slug;
    const dir = join(OUT_DIR, slug);
    mkdirSync(dir, { recursive: true });
    console.log(`\n=== ${slug} (${img.lang}, ${img.recordType}) ===`);

    const url = resolveImageUrl(img);
    let rawBytes: Buffer;
    let rawMime: string;
    try {
      const fetched = await fetchScan(url, token);
      rawBytes = fetched.bytes;
      rawMime = fetched.mimeType;
      writeFileSync(join(dir, "raw.jpg"), rawBytes);
      console.log(`  fetched raw: ${(rawBytes.length / 1e6).toFixed(2)} MB (${rawMime})`);
    } catch (e) {
      console.log(`  FETCH FAILED: ${e}`);
      results.images[slug] = { ...imgMeta(img), source: url, error: String(e) };
      continue;
    }

    let prepInfo: PrepInfo | undefined;
    let prepBytes: Buffer | undefined;
    if (needsPrep) {
      try {
        prepInfo = runPrep(join(dir, "raw.jpg"), join(dir, "prep.jpg"));
        prepBytes = readFileSync(join(dir, "prep.jpg"));
        console.log(`  enhanced: ${prepInfo.raw.w}x${prepInfo.raw.h} -> ${prepInfo.prep.w}x${prepInfo.prep.h}, ${(prepInfo.prep.bytes / 1e6).toFixed(2)} MB`);
      } catch (e) {
        console.log(`  PREP FAILED: ${e}`);
      }
    }

    // Ground truth (Opus 4.8, raw scan).
    const gt = await callAnthropic(anthropic, GROUND_TRUTH_MODEL, rawMime, rawBytes.toString("base64"), OCR_PROMPT);
    writeFileSync(join(dir, "_GROUND_TRUTH.txt"), gt.error ? `ERROR: ${gt.error}` : gt.text);
    console.log(`  ground-truth [${GROUND_TRUTH_MODEL}]: ${gt.error ? "ERROR " + gt.error.slice(0, 120) : `${gt.text.length} chars, ${(gt.latencyMs / 1000).toFixed(1)}s, $${(gt.costUSD ?? 0).toFixed(4)}`}`);

    // Variants (fan out).
    const variantResults = await Promise.all(
      variants.map(async (v) => {
        const usePrep = v.prep && prepBytes;
        if (v.prep && !prepBytes) return { key: v.key, result: { text: "", latencyMs: 0, tokensIn: null, tokensOut: null, costUSD: null, error: "prep image unavailable" } as CallResult };
        const bytes = usePrep ? prepBytes! : rawBytes;
        const mime = usePrep ? "image/jpeg" : rawMime;
        const prompt = v.hint ? `${OCR_PROMPT}\n\nContext: ${img.languageHint}` : OCR_PROMPT;
        const b64 = bytes.toString("base64");
        const result = v.provider === "anthropic"
          ? await callAnthropic(anthropic, v.model, mime, b64, prompt)
          : await callOpenRouter(openrouter, v.model, mime, b64, prompt);
        return { key: v.key, result };
      }),
    );

    const variantsOut: any = {};
    for (const { key, result } of variantResults) {
      const v = variants.find((x) => x.key === key)!;
      writeFileSync(join(dir, `${key}.txt`), result.error ? `ERROR: ${result.error}` : result.text);
      variantsOut[key] = { label: v.label, model: v.model, prep: v.prep, hint: !!v.hint, ...result };
      const tag = result.error ? `ERROR ${result.error.slice(0, 100)}` : `${result.text.length} chars, ${(result.latencyMs / 1000).toFixed(1)}s, $${(result.costUSD ?? 0).toFixed(4)}${result.reasoningChars ? `, reasoning ${result.reasoningChars}c` : ""}`;
      console.log(`  ${key.padEnd(22)} ${tag}`);
    }

    results.images[slug] = {
      ...imgMeta(img),
      source: url,
      rawMime,
      dims: prepInfo,
      groundTruth: { model: GROUND_TRUTH_MODEL, ...gt },
      variants: variantsOut,
    };

    // Persist incrementally so a mid-run failure doesn't lose completed work.
    writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
  }

  console.log(`\nDone. Results: ${join(OUT_DIR, "results.json")}`);
  console.log(`Next: npx tsx dev/try-ocr-grade.ts`);
}

function imgMeta(img: ImageSpec) {
  return { scenario: img.scenario, lang: img.lang, recordType: img.recordType, note: img.note, subset: img.subset, languageHint: img.languageHint };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
