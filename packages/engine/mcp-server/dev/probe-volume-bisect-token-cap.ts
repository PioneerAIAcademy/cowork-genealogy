/**
 * Evidence for `PROBE_MAX_TOKENS` in `volume-bisect.ts`.
 *
 * The first value shipped was 32, reasoned as "a year-only answer is a handful of
 * tokens". That ignores a reasoning model: reasoning tokens count against
 * `max_tokens`, so the budget can be spent before any answer is emitted and
 * `runOcr` throws its output-cap error. Observed live 2026-09-30 on the second run
 * of the same image the first run had read.
 *
 * Usage: npx tsx dev/probe-volume-bisect-token-cap.ts [imageId]
 */
import { LOCAL } from "../src/auth/principal.js";
import { resolveFsImageInput, fetchFsImageBytes } from "../src/utils/fs-image-fetch.js";
import { runOcr } from "../src/utils/ocr.js";
import { getOpenRouterApiKey, getOpenRouterModel } from "../src/auth/config.js";

const imageId = process.argv[2] ?? "004516861_00027";
const PROMPT =
  "Read only the year this register page covers. Look for a year heading, a " +
  "date in the first entry, or a printed year. Answer with the four-digit year " +
  "alone. If there is no year on the page, answer NONE.";

const apiKey = await getOpenRouterApiKey(LOCAL);
const model = await getOpenRouterModel(LOCAL);
const resolved = resolveFsImageInput({ imageId }, "probe");
const fetched = await fetchFsImageBytes(
  resolved.url, resolved.fallbackUrl, LOCAL, resolved.memoryShape, { timeoutMs: 20000 },
);
console.log(`image ${imageId}: ${(fetched.bytes.length / 1024 / 1024).toFixed(1)} MB  model ${model}\n`);

for (const maxTokens of [32, 128, 256, 512, 1024]) {
  const started = Date.now();
  try {
    const r = await runOcr({
      bytes: fetched.bytes, contentType: fetched.contentType,
      sizeBytes: fetched.bytes.length, prompt: PROMPT, apiKey, model,
      timeoutMs: 30000, maxTokens,
    });
    const text = (r.text ?? "").trim().replace(/\s+/g, " ");
    console.log(`  ${String(maxTokens).padStart(4)}  ${((Date.now()-started)/1000).toFixed(1)}s  OK   "${text.slice(0, 70)}"`);
  } catch (e) {
    console.log(`  ${String(maxTokens).padStart(4)}  ${((Date.now()-started)/1000).toFixed(1)}s  FAIL ${(e as Error).message.slice(0, 80)}`);
  }
}
