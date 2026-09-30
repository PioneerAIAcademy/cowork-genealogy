/**
 * The OCR leg: one hosted-VLM page read, transport and truncation handling.
 *
 * Lifted out of `tools/image-transcribe.ts` (issue #2183) so a second in-process
 * consumer can probe a page without pasting the transport. It deliberately does
 * NOT take a `Principal`: the caller resolves `apiKey` and `model` first, which
 * keeps auth plumbing out of `src/utils/` and preserves the "resolve credentials
 * BEFORE reading bytes" fail-fast ordering that both call sites depend on.
 *
 * The prompt is a parameter rather than baked in, because the two consumers want
 * different reads: `image_transcribe` wants a faithful full-page transcription,
 * a bisect probe wants only the page's year. The spec's "never caller-supplied"
 * rule is about the MCP boundary — an LLM cannot reach this — not about an
 * in-process caller.
 */
import { fetchWithTimeout, isFetchTimeout } from "./http.js";
import type { OpenRouterChatResponse } from "../types/image-transcribe.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// VLM OCR on a full page scan is the slowest call this server makes, and the
// budget has to clear a slow-but-genuine read without waiting out a hung one.
// Measured 2026-09-08 over 59 live reads on the current default model, the whole
// call runs p50 18.7s / p90 40.6s / max 50.1s. So 180s is not a latency budget
// but a hang-catcher, 3.6x the slowest healthy read. This budget holds only
// where the call is not bridged (the harnesses and the hosted control plane,
// both verified over stdio): in Cowork the device bridge aborts every MCP call
// at 60s, so any OCR past a minute is lost there regardless of this value.
// A caller may LOWER it per call; it can never raise it.
export const OCR_TIMEOUT_MS = 180_000;

// Explicit output-token budget. Setting it makes the cap OURS and the
// truncation case reproducible. A cap that does bind surfaces as `truncated`
// (detection reads finish_reason AND native_finish_reason, case-insensitively),
// so it is visible, never silent. A caller wanting a short answer — a year
// probe — passes a much smaller `maxTokens`.
export const OCR_MAX_TOKENS = 16000;

// The largest input this will send to the OCR model, in RAW bytes. The bytes
// travel host→OpenRouter as a base64 data URL inside a JSON body; 14 MiB raw
// × 4/3 base64 = 19.6 MB, under the default model's documented 20 MB request
// limit with the prompt. Refused with an actionable error rather than
// downscaled: image pre-processing was measured to LOWER accuracy and double
// hallucinations, and the engine ships no native binary.
export const MAX_OCR_INPUT_BYTES = 14 * 1024 * 1024;

// One retry, transport failures only. Measured over the committed e2e corpus,
// 24 of 175 classifiable calls (14%) died at the transport with no socket code
// and 6 timed out; the failures are intermittent, which is what a single retry
// is for. A TIMEOUT is never retried — it has already spent the budget, so a
// second attempt doubles the worst case.
const OCR_TRANSPORT_RETRIES = 1;
const OCR_TRANSPORT_RETRY_DELAY_MS = 1_000;

// OpenRouter attribution headers (recommended, not required). Stable app id.
const APP_REFERER = "https://github.com/PioneerAIAcademy/cowork-genealogy";
const APP_TITLE = "cowork-genealogy";

/** The full-page transcription prompt used by `image_transcribe`. */
export function buildOcrPrompt(lookingFor?: string): string {
  const base =
    "Transcribe every genealogically relevant entry on this record image " +
    "verbatim: names, dates, places, ages, relationships, sponsors/witnesses, " +
    "and any marginal notes. Preserve the original spelling, capitalization, " +
    "and line/row layout. Do not modernize or normalize. Mark anything you " +
    "cannot read [illegible] — never guess.";
  const key = lookingFor?.trim();
  if (key) {
    return (
      base +
      `\n\nAfter the transcription, on a final line, report whether the page ` +
      `mentions "${key}" by writing exactly FOUND or NOT FOUND. This is a ` +
      `locate hint only — it must not change or shorten the transcription above.`
    );
  }
  return base;
}

// Node's global `fetch` rejects with `TypeError: fetch failed` and hangs the
// real socket-level reason (ECONNRESET, ENOTFOUND, UND_ERR_*, a TLS error) off
// `.cause` — the bare `.message` is always the useless string "fetch failed".
// Walk that chain so the thrown "Could not reach OpenRouter" carries the code
// that tells host-side from provider-side. `AggregateError.errors` is flattened
// too. Depth- and cycle-bounded so a self-referential cause cannot loop.
export function describeFetchError(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const push = (label: string) => {
    if (label && !parts.includes(label)) parts.push(label);
  };
  const labelOf = (e: unknown): string => {
    if (!(e instanceof Error)) return String(e);
    const code = (e as { code?: unknown }).code;
    return typeof code === "string" && code.length > 0
      ? `${code}: ${e.message}`
      : e.message;
  };
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 6 && current != null && !seen.has(current);
    depth++
  ) {
    seen.add(current);
    push(labelOf(current));
    const agg = (current as { errors?: unknown }).errors;
    if (Array.isArray(agg)) for (const e of agg) push(labelOf(e));
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" <- ") || "unknown error";
}

/** The FOUND / NOT FOUND marker `buildOcrPrompt`'s locate hint asks for. */
export function parseFound(text: string): "FOUND" | "NOT FOUND" | undefined {
  // The prompt asks for the marker on a FINAL line. Read the last non-empty
  // line and require the marker at its start, so body text like "infant found
  // abandoned" cannot spoof it.
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  if (/^\W*NOT\s+FOUND\b/i.test(last)) return "NOT FOUND";
  if (/^\W*FOUND\b/i.test(last)) return "FOUND";
  return undefined;
}

export interface OcrRequest {
  bytes: Uint8Array;
  contentType: string;
  sizeBytes: number;
  /** Built by the caller — see the module note on why this is a parameter. */
  prompt: string;
  apiKey: string;
  model: string;
  /** Clamped to `OCR_TIMEOUT_MS`; a caller may lower but never raise it. */
  timeoutMs?: number;
  /** Defaults to `OCR_MAX_TOKENS`. */
  maxTokens?: number;
}

export interface OcrOutcome {
  text: string;
  truncated: boolean;
  truncationNotice?: string;
}

/**
 * POST one image to the OCR model and return its text.
 *
 * Throws with an LLM-actionable message on an oversize input, a rejected key, an
 * exhausted account, a non-ok status, an unreachable transport, or an empty
 * read. Never returns an empty `text`.
 */
export async function runOcr(req: OcrRequest): Promise<OcrOutcome> {
  const { bytes, contentType, sizeBytes, prompt, apiKey, model } = req;

  if (sizeBytes > MAX_OCR_INPUT_BYTES) {
    throw new Error(
      `This ${contentType} is ${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB, over the ` +
        `${MAX_OCR_INPUT_BYTES / (1024 * 1024)} MiB the OCR request can carry (the model's ` +
        "documented 20 MB request limit, after base64 encoding). It was not sent. Ask the " +
        "user to re-save the image at a lower quality or resolution, or to split a " +
        "multi-page PDF into single pages, and upload that instead.",
    );
  }

  const dataUrl = `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;

  let response!: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetchWithTimeout(
        OPENROUTER_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": APP_REFERER,
            "X-Title": APP_TITLE,
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: req.maxTokens ?? OCR_MAX_TOKENS,
            // Privacy: FamilySearch scans are PII — do not let the provider
            // retain prompts for training.
            provider: { data_collection: "deny" },
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  { type: "image_url", image_url: { url: dataUrl } },
                ],
              },
            ],
          }),
        },
        Math.max(1, Math.min(req.timeoutMs ?? OCR_TIMEOUT_MS, OCR_TIMEOUT_MS)),
      );
      break;
    } catch (error) {
      // Retry a TRANSPORT failure once; never a timeout. The transport branch
      // catches every non-timeout fetch rejection, which includes a reset after
      // the request was sent and inference may already have been billed — the
      // corpus cannot separate those, so this is a reasoned default.
      if (attempt >= OCR_TRANSPORT_RETRIES || isFetchTimeout(error)) {
        throw new Error(
          `Could not reach OpenRouter${attempt > 0 ? " (2 attempts)" : ""}. ` +
            `(${describeFetchError(error)})` +
            (attempt > 0
              ? " A retry already failed, so this is more than one transient blip" +
                " — but it is still one image, not a verdict on the network."
              : ""),
        );
      }
      await new Promise((r) => setTimeout(r, OCR_TRANSPORT_RETRY_DELAY_MS));
    }
  }

  // Auth failures are LLM-actionable — the key needs replacing in config.json.
  // Transient failures (429/5xx) are not; they surface as retryable.
  if (response.status === 401) {
    throw new Error(
      "The OpenRouter API key was rejected (401). Tell the user to update the " +
        "\"openRouterApiKey\" field in ~/.familysearch-mcp/config.json with a " +
        "current key from https://openrouter.ai/keys.",
    );
  }
  if (response.status === 402) {
    throw new Error(
      "OpenRouter reports the account is out of credits (402). Ask the user " +
        "to add credits at https://openrouter.ai.",
    );
  }
  if (!response.ok) {
    let body = "";
    try {
      body = (await response.text()).slice(0, 300);
    } catch {
      // ignore — the status line is enough
    }
    throw new Error(
      `OpenRouter OCR failed: ${response.status} ${response.statusText}` +
        (body ? ` — ${body}` : ""),
    );
  }

  const data = (await response.json()) as OpenRouterChatResponse;
  const choice = data.choices?.[0];
  const text = choice?.message?.content?.trim() ?? "";

  // Truncation is computed BEFORE the empty-content guard: a cap can bind while
  // the model is still emitting reasoning tokens, leaving content empty, so
  // reading finish_reason only after a non-empty check would discard the very
  // signal this exists to surface. `reason` arrives via an unchecked cast, so
  // guard the type before `.trim()`.
  const marksCap = (reason: unknown): boolean => {
    if (typeof reason !== "string") return false;
    const v = reason.trim().toUpperCase();
    return v === "LENGTH" || v === "MAX_TOKENS";
  };
  const truncated =
    marksCap(choice?.finish_reason) || marksCap(choice?.native_finish_reason);

  if (text.length === 0) {
    // Throw either way — a zero-content read has nothing to return — but name
    // WHICH failure it was, so the invariant "truncated:true never ships beside
    // an empty transcription" holds while the caller still learns a cap bound.
    throw new Error(
      truncated
        ? "OpenRouter hit its output-token limit before returning any " +
            "transcription (the budget was likely spent on reasoning). The page " +
            "was not read — do not fabricate; a retry at this cap is unlikely to " +
            "help, so pivot to the indexed record (record_read / record_search)."
        : "OpenRouter returned an empty transcription. Do not fabricate a read — " +
            "pivot to the indexed record for this image (record_read / record_search).",
    );
  }

  const truncationNotice = truncated
    ? "This transcription is INCOMPLETE — the OCR hit its output-token limit and " +
      "stopped partway down the page. The transcription above is what was read; the " +
      "rest of the page is UNREAD, not blank. Do not treat any target as absent from " +
      "this partial read."
    : undefined;

  return { text, truncated, truncationNotice };
}
