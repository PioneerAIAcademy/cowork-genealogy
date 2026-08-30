import { getOpenRouterApiKey, getOpenRouterModel } from "../auth/config.js";
import {
  resolveFsImageInput,
  fetchFsImageBytes,
} from "../utils/fs-image-fetch.js";
import { saveSourceImage } from "../utils/image-store.js";
import { fetchWithTimeout, isFetchTimeout } from "../utils/http.js";
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
// Across the committed e2e corpus a healthy transcription runs p90 79s / p95
// 98s with a 167s maximum, and the image download it follows adds ~7s — so
// 180s clears every real read with margin while still cutting the 190–316s
// calls of the one run that hung. Sized in the spec, not guessed. This budget
// holds only where the call is not bridged (the harnesses and the hosted
// control plane, both verified over stdio): in Cowork the device bridge aborts
// every MCP call at 60s, so any OCR past a minute is lost there regardless of
// this value. Whether the desktop `.mcpb` is bridged too has not been measured;
// see docs/architecture.md "Other environment differences that bite".
const OCR_TIMEOUT_MS = 180_000;

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
): Promise<ImageTranscribeResult> {
  const { url, label, fallbackUrl } = resolveFsImageInput(
    input,
    "image_transcribe",
  );

  // Resolve credentials/config BEFORE fetching the image: a missing key
  // should fail fast (and never leave a fetched scan unused). getOpenRouterApiKey
  // throws the LLM-actionable "call configure_openrouter" error when absent.
  const apiKey = await getOpenRouterApiKey();
  const model = await getOpenRouterModel();

  const { bytes, contentType, sizeBytes } = await fetchFsImageBytes(
    url,
    fallbackUrl,
  );
  const dataUrl = `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  const prompt = buildOcrPrompt(input.lookingFor);

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

  // Auth failures are LLM-actionable — the key needs re-entering. Transient
  // failures (429/5xx) are not; they surface as retryable, not a re-prompt.
  if (response.status === 401) {
    throw new Error(
      "The OpenRouter API key was rejected (401). Ask the user for a current " +
        "key and call configure_openrouter.",
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
  const transcription = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (transcription.length === 0) {
    throw new Error(
      "OpenRouter returned an empty transcription. Do not fabricate a read — " +
        "pivot to the indexed record for this image (record_read / record_search).",
    );
  }

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
    } catch {
      imageRef = undefined;
    }
  }

  const browseBudget = recordBrowseAndCheckBudget(
    input.imageId,
    input.projectPath,
  );

  const key = input.lookingFor?.trim();
  return {
    transcription,
    ...(key ? { found: parseFound(transcription) } : {}),
    ...(imageRef ? { imageRef } : {}),
    ...(browseBudget ? { browseBudget } : {}),
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
    "FamilySearch auth (call login) and an OpenRouter API key (call " +
    "configure_openrouter if it reports no key).",
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
          "Optional: who or what to locate on the page. A search key only — " +
          "it sets a FOUND/NOT FOUND pointer and never shortens or slants the " +
          "full transcription.",
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
