import { SolutionError } from "./errors.js";
import { request, type Fetch } from "./http.js";

/**
 * The only thing a solution knows about the model. Swap in an adapter for
 * whatever gateway the host uses; `openRouterLlm` below is one.
 */
export interface Llm {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export interface LlmRequest {
  prompt: string;
  images?: { bytes: Uint8Array; contentType: string }[];
  maxTokens: number;
}

export interface LlmResponse {
  text: string;
  /** True when the model stopped at `maxTokens`, so `text` is incomplete. */
  truncated: boolean;
  model: string;
}

export interface OpenRouterOptions {
  apiKey: string;
  /** Default `google/gemini-3.7-flash`: measured best accuracy-for-latency on page scans. */
  model?: string;
  fetch?: Fetch;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "google/gemini-3.7-flash";

// The model's documented request limit is 20 MB; base64 adds a third.
const MAX_IMAGE_BYTES = 14 * 1024 * 1024;

// A slow but healthy page read measures p50 19s, max 50s. This is a hang-catcher.
const TIMEOUT_MS = 180_000;

interface ChatResponse {
  model?: string;
  choices?: {
    message?: { content?: string | null };
    finish_reason?: string | null;
    native_finish_reason?: string | null;
  }[];
}

const isLengthStop = (reason: unknown) =>
  typeof reason === "string" && ["LENGTH", "MAX_TOKENS"].includes(reason.trim().toUpperCase());

export function openRouterLlm({ apiKey, model = DEFAULT_MODEL, fetch: fetchImpl = fetch }: OpenRouterOptions): Llm {
  return {
    async complete({ prompt, images = [], maxTokens }) {
      for (const image of images) {
        if (image.bytes.length > MAX_IMAGE_BYTES) {
          throw new SolutionError(
            "too_large",
            `The image is ${(image.bytes.length / 2 ** 20).toFixed(1)} MiB; the model accepts at most 14 MiB.`,
          );
        }
      }
      const content = [
        { type: "text", text: prompt },
        ...images.map((image) => ({
          type: "image_url",
          image_url: { url: `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}` },
        })),
      ];
      const res = await request(
        fetchImpl,
        OPENROUTER_URL,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: maxTokens,
            // Scans carry personal data: no provider may retain them for training.
            provider: { data_collection: "deny" },
            messages: [{ role: "user", content }],
          }),
        },
        { timeoutMs: TIMEOUT_MS, retries: 1 },
      );
      if (res.status === 401) throw new SolutionError("unauthorized", "The OpenRouter API key was rejected (401).");
      if (res.status === 402) throw new SolutionError("upstream", "The OpenRouter account is out of credits (402).");
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 300);
        throw new SolutionError("upstream", `OpenRouter returned ${res.status}${body ? `: ${body}` : ""}`);
      }
      const data = (await res.json()) as ChatResponse;
      const choice = data.choices?.[0];
      return {
        text: choice?.message?.content?.trim() ?? "",
        truncated: isLengthStop(choice?.finish_reason) || isLengthStop(choice?.native_finish_reason),
        model: data.model ?? model,
      };
    },
  };
}
