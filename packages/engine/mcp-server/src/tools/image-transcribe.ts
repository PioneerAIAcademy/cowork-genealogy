import type { Principal } from "../auth/principal.js";
import { getOpenRouterApiKey, getOpenRouterModel } from "../auth/config.js";
import {
  resolveFsImageInput,
  fetchFsImageBytes,
} from "../utils/fs-image-fetch.js";
import { saveSourceImage, recordImageReadCap } from "../utils/image-store.js";
import { fetchWithTimeout, isFetchTimeout } from "../utils/http.js";
import { expandLookingFor } from "../utils/name-variants.js";
import type {
  ImageTranscribeInput,
  ImageTranscribeResult,
  OpenRouterChatResponse,
} from "../types/image-transcribe.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Browse budget (issue #1081, spec §5.8). From the (N+1)th distinct image in one
// image group in one project onward, a successful transcription carries an
// advisory `browseBudget` — the page read still returns in full; nothing is
// refused (a read persists nothing, so a wrong refusal would hard-block a
// researcher mid-browse with no reset but a server restart — the ADR-0011
// read-tool carve-out).
const BROWSE_BUDGET_IMAGES = 20;

// Distinct imageIds seen per (project, image-group), keyed
// `${projectPath}\0${imageGroup}`. Keyed by PROJECT too, deliberately: the MCP
// server process outlives one conversation, so a group-only key would tell a
// second project it had already browsed 20 pages on its first read. Process-
// lifetime, never persisted; re-reading an image already in the set does not
// advance the count. Follows place-search.ts's module-cache precedent.
const browseBudgetSeen = new Map<string, Set<string>>();

/** Test-only reset — the Map is module-level and persists across `it()` blocks,
 *  which `vi` mock resets do not clear. Mirrors `__clearPlaceSearchCacheForTests`. */
export function __clearBrowseBudgetForTests(): void {
  browseBudgetSeen.clear();
}

/**
 * Record this image against the (project, group) browse counter and return the
 * advisory once the group passes `BROWSE_BUDGET_IMAGES` distinct images.
 *
 * Returns `undefined` for an ark-only call: an ARK carries no image-group number,
 * so a hunt driven by `ark` is never counted (spec §5.8 known limitation).
 */
function recordBrowseAndCheckBudget(
  imageId: string | undefined,
  projectPath: string | undefined,
): ImageTranscribeResult["browseBudget"] {
  if (!imageId) return undefined;
  const imageGroup = imageId.split("_")[0];
  const key = `${projectPath ?? "<no-project>"}\0${imageGroup}`;
  let seen = browseBudgetSeen.get(key);
  if (!seen) {
    seen = new Set<string>();
    browseBudgetSeen.set(key, seen);
  }
  seen.add(imageId);
  if (seen.size <= BROWSE_BUDGET_IMAGES) return undefined;
  return {
    imageGroup,
    distinctImagesRead: seen.size,
    notice:
      `You have now transcribed ${seen.size} distinct images from image group ` +
      `${imageGroup} in this project. Page-by-page browsing rarely pays past this ` +
      `point. Log the browse with a negative outcome (research_log_append) and ` +
      `pivot to the indexed route — record_search, record_read, or fulltext_search ` +
      `— or ask the user whether to keep paging.`,
  };
}

// VLM OCR on a full page scan is the slowest call this server makes, and the
// budget has to clear a slow-but-genuine read without waiting out a hung one.
// Measured 2026-09-08 over 59 live reads on the current default model, the whole
// call runs p50 18.7s / p90 40.6s / max 50.1s. So 180s is not a latency budget
// but a hang-catcher, 3.6x the slowest healthy read. Sized in the spec, not
// guessed — re-measure there after a model change, and never from run-log
// timelines, which are per SDK message rather than per tool call. This budget
// holds only where the call is not bridged (the harnesses and the hosted
// control plane, both verified over stdio): in Cowork the device bridge aborts
// every MCP call at 60s, so any OCR past a minute is lost there regardless of
// this value. Whether the desktop `.mcpb` is bridged too has not been measured;
// see docs/architecture.md "Other environment differences that bite".
const OCR_TIMEOUT_MS = 180_000;

// Explicit output-token budget. Setting it makes the cap OURS and the
// truncation case reproducible. Note the DIRECTION: for the current default
// google/gemini-3.7-flash OpenRouter's /api/v1/models reports
// top_provider.max_completion_tokens = 65536 and we previously sent no
// `max_tokens`, so 16000 LOWERS the effective cap rather than raising it. It is
// still well above a page's content. Measured 2026-09-07 over the committed e2e
// run logs: of 455 image_transcribe calls, 219 are excluded by the harness's
// 14-day capture strip and 126 have a transcription size recoverable from the
// `full length N chars` marker (or an unelided summary). Over those 126 the
// largest is 6,443 chars (~1.6k output tokens), median 1,573; under the current
// default specifically, 36 calls with a max of 4,940 chars (~1.2k tokens).
// Re-derive by scanning eval/runlogs/e2e/** for that marker — NOT with
// `make e2e-transcribe-failures`, which reports reachability, not sizes.
// Treat it as a dated bound, not a proof: reasoning tokens draw on this SAME
// budget (Gemini is reasoning-capable and reasoning is not disabled), so a
// reasoning-heavy read could reach 16000 before the page ends.
// A cap that does bind surfaces as `truncated` (detection reads finish_reason
// AND native_finish_reason, case-insensitively), so it is visible, never silent.
export const OCR_MAX_TOKENS = 16000;

// One retry, transport failures only. Measured over the committed e2e corpus,
// 24 of 175 classifiable calls (14%) died at the transport with no socket code
// and 6 timed out; on one run two consecutive losses led the agent to declare
// the OCR route "network-unreachable in this environment" and abandon images
// for the rest of the run, concluding from an indexed namesake instead. Probes
// on both sides found the path healthy minutes later (70/70, then 46/46), so
// the failures are intermittent — which is what a single retry is for. Whether
// the transience is host-side or provider-side is still unclassified, and does
// not change this: a bounded retry is the right response either way.
const OCR_TRANSPORT_RETRIES = 1;
const OCR_TRANSPORT_RETRY_DELAY_MS = 1_000;

// OpenRouter attribution headers (recommended, not required). Stable app id.
const APP_REFERER = "https://github.com/PioneerAIAcademy/cowork-genealogy";
const APP_TITLE = "cowork-genealogy";

// The OCR prompt is baked into the tool (never caller-supplied) so behavior
// matches today's Claude-vision `image-reader` read: faithful full-page
// transcription, original spelling/language, illegible marked not guessed.
function buildOcrPrompt(lookingFor?: string): string {
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
// that tells host-side from provider-side (#1594). `AggregateError.errors` is
// flattened too — a DNS attempt arrives as a bundle. Depth- and cycle-bounded
// so a self-referential cause cannot loop. `fetchWithTimeout`'s own timeout
// error already carries a full message and no `.cause`, so it passes through
// unchanged.
function describeFetchError(error: unknown): string {
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

function parseFound(text: string): "FOUND" | "NOT FOUND" | undefined {
  // The prompt asks for the marker on a FINAL line ("write exactly FOUND or
  // NOT FOUND"). Read the last non-empty line and require the marker at its
  // start, so body text like "infant found abandoned" cannot spoof it.
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  if (/^\W*NOT\s+FOUND\b/i.test(last)) return "NOT FOUND";
  if (/^\W*FOUND\b/i.test(last)) return "FOUND";
  return undefined;
}

/**
 * OCR a FamilySearch page scan via a hosted VLM (OpenRouter, default
 * Gemini Flash) and return the transcription as text. The image bytes go
 * host-side → OpenRouter and never cross the MCP transport, so there is no
 * size cap (unlike image_read). See docs/specs/image-transcribe-tool-spec.md.
 */
export async function imageTranscribeTool(
  input: ImageTranscribeInput,
  principal: Principal,
): Promise<ImageTranscribeResult> {
  const { url, label, fallbackUrl } = resolveFsImageInput(
    input,
    "image_transcribe",
  );

  // Resolve credentials/config BEFORE fetching the image: a missing key
  // should fail fast (and never leave a fetched scan unused). getOpenRouterApiKey
  // throws an LLM-actionable error naming config.json when absent.
  const apiKey = await getOpenRouterApiKey(principal);
  const model = await getOpenRouterModel(principal);

  const { bytes, contentType, sizeBytes } = await fetchFsImageBytes(
    url,
    fallbackUrl,
    principal,
  );
  const dataUrl = `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  // Expand recognized given names in lookingFor with historical diminutives
  // (issue #607). The VLM reads this as natural language, so all forms
  // (including scribal abbreviations with periods) are included.
  const lookingForExpansion = input.lookingFor
    ? expandLookingFor(input.lookingFor)
    : null;
  const expandedLookingFor = lookingForExpansion?.expanded ?? input.lookingFor;
  const prompt = buildOcrPrompt(expandedLookingFor);

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
            max_tokens: OCR_MAX_TOKENS,
            // Privacy: FamilySearch scans are PII — do not let the provider
            // retain prompts for training. See spec §11.
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
        OCR_TIMEOUT_MS,
      );
      break;
    } catch (error) {
      // Retry a TRANSPORT failure once; never a timeout. A timeout has already
      // spent OCR_TIMEOUT_MS, so a second attempt doubles the worst case — the
      // objection that kept a retry out until now. The transport branch is the
      // cheaper one to re-attempt, but only USUALLY: it catches every non-timeout
      // fetch rejection, which includes a reset after the request was sent and
      // inference may already have been billed. The corpus cannot separate those
      // — 0 of 30 recorded failures carry a socket cause code — so this is a
      // reasoned default, not a measured one. Re-check it once coded failures
      // accumulate.
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

  // Auth failures are LLM-actionable — the key needs replacing in config.json. Transient
  // failures (429/5xx) are not; they surface as retryable, not a re-prompt.
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
  const transcription = choice?.message?.content?.trim() ?? "";

  // Output-token-cap truncation, computed BEFORE the empty-content guard: a cap
  // can bind while the model is still emitting reasoning tokens, leaving content
  // empty, so reading finish_reason only after a non-empty check would discard
  // the very signal this exists to surface (the empty read would misfile as an
  // unreadable scan). A cap is marked by finish_reason OR native_finish_reason —
  // OpenAI-normalized "length" or a provider's native "MAX_TOKENS" — matched
  // case-insensitively so a lowercase/odd-cased spelling (some models via
  // OpenRouter emit "max_tokens") is still caught, regardless of which field it
  // lands in. Out of scope: a model that stops early on its own ("stop", page
  // unfinished) and a transport cut (already thrown by fetchWithTimeout) — #1974.
  // `reason` is typed string|null but arrives via the unchecked `as
  // OpenRouterChatResponse` cast, so guard the type before `.trim()` — a number,
  // boolean, array or object would otherwise throw and turn a complete read into
  // a spurious tool error (the `=== "length"` this replaced could not throw).
  const marksCap = (reason: unknown): boolean => {
    if (typeof reason !== "string") return false;
    const v = reason.trim().toUpperCase();
    return v === "LENGTH" || v === "MAX_TOKENS";
  };
  const truncated =
    marksCap(choice?.finish_reason) || marksCap(choice?.native_finish_reason);

  if (transcription.length === 0) {
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

  // A capped read with content is non-empty, so it would otherwise pass as an
  // ordinary success. The transcription stays verbatim — the signal rides the
  // sibling fields below (spec §6.2).
  const truncationNotice = truncated
    ? "This transcription is INCOMPLETE — the OCR hit its output-token limit and " +
      "stopped partway down the page. The transcription above is what was read; the " +
      "rest of the page is UNREAD, not blank. Do not treat any target as absent from " +
      "this partial read."
    : undefined;

  // Persist the scan for a retained source (§8.5, design B) — best-effort: the
  // transcription is the primary payload, so a save failure (e.g. a bad
  // projectPath) omits imageRef rather than losing the text. A TTL sweep in
  // research_append GCs images no source ends up citing.
  let imageRef: string | undefined;
  if (input.projectPath) {
    try {
      imageRef = await saveSourceImage({
        projectPath: input.projectPath,
        imageKey: label,
        bytes,
      });
      // Record the cap against the persisted image so research_append can derive
      // transcription_truncated when a source cites it (#2457). Only reachable
      // with a persisted image — an imageRef is exactly what a source's
      // image_filename joins on.
      recordImageReadCap(input.projectPath, imageRef, truncated);
    } catch {
      imageRef = undefined;
    }
  }

  const browseBudget = recordBrowseAndCheckBudget(
    input.imageId,
    input.projectPath,
  );

  // Suppress found on a truncated read: the FOUND/NOT FOUND marker rides a final
  // line the model never reached, and a target may sit below the cut — a
  // half-read page must never yield a clean NOT FOUND negative (#1974).
  const key = input.lookingFor?.trim();
  return {
    transcription,
    ...(truncated ? { truncated: true as const, truncationNotice } : {}),
    ...(key && !truncated ? { found: parseFound(transcription) } : {}),
    ...(imageRef ? { imageRef } : {}),
    ...(browseBudget ? { browseBudget } : {}),
    ...(lookingForExpansion && input.lookingFor
      ? {
          nameExpansion: {
            original: input.lookingFor,
            expanded: lookingForExpansion.expanded,
            expansions: lookingForExpansion.expansions,
          },
        }
      : {}),
    metadata: {
      ...(input.imageId !== undefined ? { imageId: input.imageId } : {}),
      ...(input.ark !== undefined ? { ark: input.ark } : {}),
      model,
      sizeBytes,
    },
  };
}

export const imageTranscribeToolSchema = {
  name: "image_transcribe",
  description:
    "OCR a FamilySearch page scan and return the transcription as TEXT. Use " +
    "this for large scans that image_read refuses (over its inline size cap): " +
    "the image is OCR'd host-side and never enters the conversation, so there " +
    "is no size limit. Provide exactly one of imageId or ark. Requires " +
    "FamilySearch auth (call login) and an OpenRouter API key (set in " +
    "~/.familysearch-mcp/config.json if it reports no key).",
  inputSchema: {
    type: "object" as const,
    properties: {
      imageId: {
        type: "string",
        description:
          "FamilySearch Image Group Number NUMBER_NUMBER (e.g. 004884748_02613), " +
          "as returned by image_search.",
      },
      ark: {
        type: "string",
        description:
          "A FamilySearch document-image ARK when no imageId is available — " +
          "ark:/61903/3:1:... or 3:2:... (e.g. fulltext_search's `id`), a bare " +
          "3:1:.../3:2:... id, a resolver URL for one, or a resolved distribution URL. " +
          "IMPORTANT: some document-image ARKs are waypoints into a multi-image " +
          "film/register — the bare ARK can silently resolve to the WRONG image " +
          "within that group. If the record was reached via a FamilySearch page " +
          "URL carrying i=/cc=/groupId= query parameters (e.g. from the browser or " +
          "a citation), pass the FULL URL including them, not just the bare ARK — " +
          "those parameters are preserved and select the correct image.",
      },
      lookingFor: {
        type: "string",
        description:
          "Optional: who or what to locate on the page. A search key only — on a " +
          "complete read it sets a FOUND/NOT FOUND pointer, but it never shortens " +
          "or slants the full transcription. The pointer is withheld on a " +
          "truncated read (`truncated: true`): a half-read page cannot support a " +
          "clean NOT FOUND, so `found` is absent there — judge from the returned " +
          "lines and treat the rest of the page as unread.",
      },
      projectPath: {
        type: "string",
        description:
          "Optional absolute path to the project folder. When set, the fetched " +
          "page scan is saved under images/ and its project-relative path is " +
          "returned as imageRef, so a retained source can cite it (image_filename) " +
          "for viewer display.",
      },
    },
  },
};
