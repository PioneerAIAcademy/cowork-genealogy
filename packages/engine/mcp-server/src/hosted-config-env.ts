// The per-user config the HOSTED entrypoint receives as environment — the sibling of
// store/pg-s3-env.ts, which does the same for the store. The prototype's tool server runs in
// a container, and a container receives a secret as environment, not as a file baked into
// an image. The server's own key resolution is unchanged and still config-only
// (`getOpenRouterApiKey`, auth/config.ts): these values are put INTO the config an
// entrypoint builds, before it constructs the server. docs/specs/image-transcribe-tool-spec.md
// §6.5 carries the table of who fills the config in each runtime.
//
// apps/server/tests/test_proto_config.py reads PER_USER_ENV out of this file and holds the
// compose `tools` service's environment to it, so a key added here reaches the service.

import type { AppConfig } from "./types/auth.js";
import { isHttpUrl } from "./utils/search-helpers.js";

/** The variable names, in the order they appear on `AppConfig`. Read as source text by the
 *  prototype's config test, so keep them literal. */
export const PER_USER_ENV = [
  "WIKI_API_URL",
  "POP_STATS_URL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "WEB_PUBLIC_URL",
  "UPLOADS_ENABLED",
  "TRANSCRIPTION_ENABLED",
  "MATCHER_URL",
  "MATCHER_API_KEY",
] as const;

/**
 * `base` with the per-user config the environment names layered over it.
 *
 * Only keys that are SET override: an absent or empty variable must leave whatever `base`
 * had — the mounted `config.json` for `http.js` — so that each getter's own default still
 * applies, exactly as with a sparse `config.json`.
 *
 * A switch takes `true` or `false` (trimmed, any case) and `WEB_PUBLIC_URL` a plain http(s)
 * URL with no `#`, `?`, credentials, backslash, space or control character; anything else
 * throws, so `http.js` refuses to start. Unset means "as today", so a lenient parse would turn
 * `TRANSCRIPTION_ENABLED=off` into transcription left running.
 */
export function configFromEnv(env: NodeJS.ProcessEnv, base: AppConfig = {}): AppConfig {
  const out: AppConfig = { ...base };
  if (env.WIKI_API_URL) out.wikiApiUrl = env.WIKI_API_URL;
  if (env.POP_STATS_URL) out.popStatsUrl = env.POP_STATS_URL;
  if (env.OPENROUTER_API_KEY) out.openRouterApiKey = env.OPENROUTER_API_KEY;
  if (env.OPENROUTER_MODEL) out.openRouterModel = env.OPENROUTER_MODEL;
  const webPublicUrl = env.WEB_PUBLIC_URL?.trim();
  if (webPublicUrl) {
    if (!isPlainHttpUrl(webPublicUrl)) {
      throw new Error(
        "WEB_PUBLIC_URL must be an http(s) URL with no '#', '?', credentials, backslash, space or " +
          `control character, got ${JSON.stringify(env.WEB_PUBLIC_URL)}`,
      );
    }
    out.webPublicUrl = webPublicUrl;
  }
  const uploads = envSwitch(env, "UPLOADS_ENABLED");
  if (uploads !== undefined) out.uploadsEnabled = uploads;
  const transcription = envSwitch(env, "TRANSCRIPTION_ENABLED");
  if (transcription !== undefined) out.transcriptionEnabled = transcription;
  // The matcher service needs both; one alone names no service to call.
  if (env.MATCHER_URL && env.MATCHER_API_KEY) {
    out.matcher = "service";
    out.matcherUrl = env.MATCHER_URL;
    out.matcherApiKey = env.MATCHER_API_KEY;
  }
  return out;
}

/** The links append `/#/p/<id>` to the raw value, so a `#`, a `?` or credentials in it break or
 *  leak every link; `new URL` alone accepts `https:user:pw@host` and treats `\` as `/`. */
function isPlainHttpUrl(raw: string): boolean {
  return (
    /^https?:\/\/[^/]/i.test(raw) &&
    !/[\\\s#?\x00-\x1f\x7f]/.test(raw) &&
    !/^https?:\/\/[^/]*@/i.test(raw) &&
    isHttpUrl(raw)
  );
}

function envSwitch(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false, got ${JSON.stringify(raw)}`);
}
