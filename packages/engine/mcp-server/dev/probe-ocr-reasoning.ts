/**
 * Probe: can we disable Gemini's reasoning tokens through OpenRouter, and does
 * doing so keep the OCR transcription gradeable?
 *
 * Context (#2291 review, promise-emmanuel's addition #2): an output cap that
 * binds on a page needing only ~1.6k content tokens binds because REASONING
 * tokens draw on the same max_tokens budget (probe-ocr-finish-reason.ts saw
 * 58/60 completion tokens spent on reasoning at max_tokens:64). OCR at
 * temperature 0 is not a reasoning task. OpenRouter's unified control is
 * `reasoning: { enabled: false }`; the fallback that maps to Google's
 * thinkingBudget is `reasoning: { max_tokens: 0 }`. Neither is measured here —
 * this records the live evidence.
 *
 * Two passes:
 *   A. Text-only (no FS auth): a prompt that normally elicits reasoning, run
 *      with no control, {enabled:false}, and {max_tokens:0}. Establishes whether
 *      either spelling drops reasoning_tokens to 0.
 *   B. The real OCR path (needs FS auth): the dense 1880 census page at a REAL
 *      budget, same three variants, reporting reasoning_tokens, finish_reason,
 *      content length + a snippet — so we can see reasoning drop AND that the
 *      transcription is still produced.
 *
 * Usage:  npx tsx dev/probe-ocr-reasoning.ts          (both passes)
 *         npx tsx dev/probe-ocr-reasoning.ts --text    (text pass only, no auth)
 *
 * FINDING (live, 2026-09-09, google/gemini-3.7-flash via OpenRouter):
 *   Reasoning CANNOT be disabled on this model. Both `reasoning:{enabled:false}`
 *   and `reasoning:{max_tokens:0}` return HTTP 400:
 *     "Reasoning is mandatory for this endpoint and cannot be disabled."
 *   Baseline (no control) on a puzzle prompt: 274 of 276 completion_tokens were
 *   reasoning. => #2291-review addition #2 is REFUTED: the reasoning-disable
 *   lever does not exist on the shipped model.
 */

import { getValidToken } from "../src/auth/refresh.js";
import { getOpenRouterApiKey, getOpenRouterModel } from "../src/auth/config.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const IMAGE_ID = "004539662_00001"; // dense 1880 U.S. census page
const IMAGE_URL = `https://familysearch.org/das/v2/dgs:${IMAGE_ID}/dist.jpg`;

const OCR_PROMPT =
  "Transcribe every genealogically relevant entry on this record image " +
  "verbatim: names, dates, places, ages, relationships, sponsors/witnesses, " +
  "and any marginal notes. Preserve the original spelling, capitalization, " +
  "and line/row layout. Do not modernize or normalize. Mark anything you " +
  "cannot read [illegible] — never guess.";

// A prompt that normally makes a reasoning-capable model think before answering.
const REASONING_PROMPT =
  "A farmer has 17 sheep. All but 9 run away. Then he buys 3 times as many as " +
  "he has left, loses a quarter of the new total, and sells 5. How many sheep " +
  "does he have? Answer with the number only.";

type ReasoningControl = Record<string, unknown> | undefined;

const VARIANTS: { label: string; reasoning: ReasoningControl }[] = [
  { label: "baseline (no control)", reasoning: undefined },
  { label: "reasoning:{enabled:false}", reasoning: { enabled: false } },
  { label: "reasoning:{max_tokens:0}", reasoning: { max_tokens: 0 } },
];

async function call(
  apiKey: string,
  model: string,
  content: unknown,
  reasoning: ReasoningControl,
  maxTokens: number
): Promise<any> {
  const body: Record<string, unknown> = {
    model,
    temperature: 0,
    max_tokens: maxTokens,
    usage: { include: true },
    messages: [{ role: "user", content }],
  };
  if (reasoning !== undefined) body.reasoning = reasoning;
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify(body),
  });
  return res.json();
}

function report(label: string, json: any) {
  if (json.error) {
    console.log(`  ${label.padEnd(28)} ERROR: ${JSON.stringify(json.error).slice(0, 160)}`);
    return;
  }
  const choice = json.choices?.[0] ?? {};
  const content: string = choice.message?.content ?? "";
  const u = json.usage ?? {};
  const rt = u.completion_tokens_details?.reasoning_tokens;
  console.log(
    `  ${label.padEnd(28)} finish=${JSON.stringify(choice.finish_reason)} ` +
      `completion_tokens=${u.completion_tokens} reasoning_tokens=${rt} ` +
      `content_len=${content.length}`
  );
  console.log(`      content head: ${JSON.stringify(content.slice(0, 90))}`);
}

async function fetchScanB64(token: string): Promise<{ b64: string; mime: string }> {
  const res = await fetch(IMAGE_URL, {
    headers: { Authorization: `Bearer ${token}`, Accept: "image/*,*/*", "User-Agent": BROWSER_USER_AGENT },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`FS fetch failed: ${res.status} ${res.statusText}`);
  const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  return { b64: Buffer.from(await res.arrayBuffer()).toString("base64"), mime };
}

async function main() {
  const textOnly = process.argv.includes("--text");
  const [apiKey, model] = await Promise.all([getOpenRouterApiKey(), getOpenRouterModel()]);
  console.log(`Model: ${model}\n`);

  console.log("=== PASS A — text prompt (does the reasoning control take effect?) ===");
  for (const v of VARIANTS) {
    report(v.label, await call(apiKey, model, REASONING_PROMPT, v.reasoning, 2000));
  }

  if (textOnly) return;

  console.log("\n=== PASS B — real OCR path on the 1880 census page ===");
  let token: string;
  try {
    token = await getValidToken();
  } catch (e) {
    console.log(`  (skipped — no FS auth: ${e instanceof Error ? e.message : e})`);
    return;
  }
  const { b64, mime } = await fetchScanB64(token);
  const ocrContent = [
    { type: "text", text: OCR_PROMPT },
    { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
  ];
  for (const v of VARIANTS) {
    // A real budget so a genuine page can finish; we're watching reasoning_tokens.
    report(v.label, await call(apiKey, model, ocrContent, v.reasoning, 16000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
