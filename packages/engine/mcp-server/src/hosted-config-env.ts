// The per-user config the HOSTED entrypoints receive as environment — the sibling of
// store/pg-s3-env.ts, which does the same for the store. Both prototype entrypoints run in
// a container, and a container receives a secret as environment, not as a file baked into
// an image; `hosted-stdio.js` additionally gets it per TURN, from the worker, which no file
// could do. The server's own key resolution is unchanged and still config-only
// (`getOpenRouterApiKey`, auth/config.ts): these values are put INTO the config an
// entrypoint builds, before it constructs the server. docs/specs/image-transcribe-tool-spec.md
// §6.5 carries the table of who fills the config in each runtime.
//
// One definition for both entrypoints, because two copies of a credential-carrying list
// drift silently: a fifth key added to one arm and not the other makes a tool work on one
// and fail on the other, which is exactly what the 2026-09-20 default flip nearly shipped.
// apps/server/tests/test_proto_config.py reads PER_USER_ENV out of this file and holds it
// equal to the worker's own list and to the compose service's environment.

import type { AppConfig } from "./types/auth.js";

/** The variable names, in the order they appear on `AppConfig`. Read as source text by the
 *  prototype's config test, so keep them literal. */
export const PER_USER_ENV = ["WIKI_API_URL", "POP_STATS_URL", "OPENROUTER_API_KEY", "OPENROUTER_MODEL"] as const;

/**
 * `base` with the per-user config the environment names layered over it.
 *
 * Only keys that are SET override: an absent or empty variable must leave whatever `base`
 * had — the mounted `config.json` for `http.js`, nothing for `hosted-stdio.js` — so that
 * each getter's own default still applies, exactly as with a sparse `config.json`.
 */
export function configFromEnv(env: NodeJS.ProcessEnv, base: AppConfig = {}): AppConfig {
  const out: AppConfig = { ...base };
  if (env.WIKI_API_URL) out.wikiApiUrl = env.WIKI_API_URL;
  if (env.POP_STATS_URL) out.popStatsUrl = env.POP_STATS_URL;
  if (env.OPENROUTER_API_KEY) out.openRouterApiKey = env.OPENROUTER_API_KEY;
  if (env.OPENROUTER_MODEL) out.openRouterModel = env.OPENROUTER_MODEL;
  return out;
}
