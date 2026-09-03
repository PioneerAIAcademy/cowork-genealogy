/**
 * Probe: does OpenRouter return `finish_reason` on the chat-completions
 * response, and what value marks an output-token-cap truncation?
 *
 * Gates issue #1974. Nothing in this repo has ever read `finish_reason` from
 * OpenRouter — the premise that it is OpenAI-compatible and returns
 * `finish_reason` (plus `native_finish_reason`) per choice is an unverified
 * claim about an external API. This records the live evidence.
 *
 * It fetches one dense 1880 U.S. census page (the record type in the report)
 * and makes THREE OpenRouter calls:
 *   1. OCR at max_tokens: 64    — a tiny cap on the OCR request shape.
 *   2. OCR at max_tokens: 16000 — the shipped budget.
 *   3. a text-only request at max_tokens: 16 — deterministically forces the cap
 *      (the OCR path may stop early on this image, so it is not a reliable
 *      cap-forcer on its own).
 * For each it prints the raw top-level keys, choices[0].finish_reason,
 * choices[0].native_finish_reason, the content length, and usage.
 *
 * Auth: FamilySearch via getValidToken() (auto-refresh); OpenRouter key +
 * model via the repo config helpers (~/.familysearch-mcp/config.json), so it
 * needs no eval/.env. Dev-only, NOT shipped.
 *
 * Usage:  npx tsx dev/probe-ocr-finish-reason.ts
 *
 * FINDINGS (live, 2026-09-04, google/gemini-3.7-flash — the SHIPPED default;
 * an earlier 2026-09-02 run on the prior qwen/qwen3-vl-235b-a22b-instruct agreed
 * on the field shape):
 *   - `finish_reason` AND `native_finish_reason` ARE returned per choice
 *     (choice keys: index, logprobs, finish_reason, native_finish_reason,
 *     message). The #1974 premise holds on the shipped model.
 *   - Output-cap truncation → finish_reason === "length" AND
 *     native_finish_reason === "MAX_TOKENS" (Gemini normalizes onto the
 *     top-level field and also reports its native value). Confirmed twice: the
 *     max_tokens:64 OCR call and the text-only max_tokens:16 call.
 *   - A complete read → finish_reason === "stop", native_finish_reason "STOP".
 *   - Gemini is REASONING-capable and reasoning tokens draw on the SAME output
 *     budget: at max_tokens:64, completion_tokens_details.reasoning_tokens was
 *     58 of 60, leaving content 2 chars WITH finish_reason "length". So an
 *     output cap can bind with (near-)empty content — this is why the tool must
 *     compute `truncated` BEFORE its empty-content guard (spec §6.2, item 1).
 *   - Side note (out of scope, the "model stops early" mode): at max_tokens:16000
 *     this model returned a degenerate 6-char output ("565714") with
 *     finish_reason "stop" — a stop, not a cap; the mode #1974 does not catch.
 *   => Detection: flag `truncated` when finish_reason OR native_finish_reason
 *      matches a cap marker ("length"/"MAX_TOKENS"), case-insensitively.
 */

import { getValidToken } from "../src/auth/refresh.js";
import { getOpenRouterApiKey, getOpenRouterModel } from "../src/auth/config.js";
import { OCR_MAX_TOKENS } from "../src/tools/image-transcribe.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// A dense 1880 U.S. federal census page — same record type as issue #1974.
// (bottemiller-census, from dev/try-ocr-compare.ts's corpus.)
const IMAGE_ID = "004539662_00001";
const IMAGE_URL = `https://familysearch.org/das/v2/dgs:${IMAGE_ID}/dist.jpg`;

const OCR_PROMPT =
  "Transcribe every genealogically relevant entry on this record image " +
  "verbatim: names, dates, places, ages, relationships, sponsors/witnesses, " +
  "and any marginal notes. Preserve the original spelling, capitalization, " +
  "and line/row layout. Do not modernize or normalize. Mark anything you " +
  "cannot read [illegible] — never guess.";

async function fetchScan(url: string, token: string): Promise<{ b64: string; mime: string }> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "image/*,*/*",
      "User-Agent": BROWSER_USER_AGENT,
    },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`FS fetch failed: ${res.status} ${res.statusText}`);
  const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return { b64, mime };
}

async function callOnce(
  apiKey: string,
  model: string,
  b64: string,
  mime: string,
  maxTokens: number,
): Promise<void> {
  console.log(`\n--- max_tokens: ${maxTokens} ---`);
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      provider: { data_collection: "deny" },
      usage: { include: true },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: OCR_PROMPT },
            { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
          ],
        },
      ],
    }),
  });
  const json: any = await res.json();
  if (!res.ok) {
    console.log(`  HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
    return;
  }
  const choice = json.choices?.[0] ?? {};
  const content: string = choice.message?.content ?? "";
  console.log(`  top-level keys      : ${Object.keys(json).join(", ")}`);
  console.log(`  choice keys         : ${Object.keys(choice).join(", ")}`);
  console.log(`  finish_reason       : ${JSON.stringify(choice.finish_reason)}`);
  console.log(`  native_finish_reason: ${JSON.stringify(choice.native_finish_reason)}`);
  console.log(`  content length      : ${content.length} chars`);
  console.log(`  content tail        : ${JSON.stringify(content.slice(-80))}`);
  console.log(`  usage               : ${JSON.stringify(json.usage)}`);
}

async function main() {
  const [token, apiKey, model] = await Promise.all([
    getValidToken(),
    getOpenRouterApiKey(),
    getOpenRouterModel(),
  ]);
  console.log(`Model: ${model}`);
  console.log(`Image: ${IMAGE_ID} (1880 U.S. federal census)`);

  const { b64, mime } = await fetchScan(IMAGE_URL, token);
  console.log(`Fetched scan: ${((b64.length * 3) / 4 / 1e6).toFixed(2)} MB (${mime})`);

  await callOnce(apiKey, model, b64, mime, 64); // small cap on the OCR path
  await callOnce(apiKey, model, b64, mime, OCR_MAX_TOKENS); // the shipped budget

  // The VLM may stop early on its own for a given scan (finish_reason "stop"),
  // which never exercises the cap. Force the cap deterministically with a
  // verbose text-only request and a tiny budget, to capture the value that
  // marks a genuine output-token-cap truncation.
  await callTextCap(apiKey, model, 16);
}

async function callTextCap(apiKey: string, model: string, maxTokens: number): Promise<void> {
  console.log(`\n--- text-only cap force, max_tokens: ${maxTokens} ---`);
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      usage: { include: true },
      messages: [
        {
          role: "user",
          content:
            "Write the numbers from 1 to 500, one per line, with no other text.",
        },
      ],
    }),
  });
  const json: any = await res.json();
  if (!res.ok) {
    console.log(`  HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
    return;
  }
  const choice = json.choices?.[0] ?? {};
  console.log(`  finish_reason       : ${JSON.stringify(choice.finish_reason)}`);
  console.log(`  native_finish_reason: ${JSON.stringify(choice.native_finish_reason)}`);
  console.log(`  completion_tokens   : ${json.usage?.completion_tokens}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
