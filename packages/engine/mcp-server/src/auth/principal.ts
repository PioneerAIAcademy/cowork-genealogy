// Principal — who a tool call acts as.
//
// Every read of a FamilySearch credential or of per-user config takes one
// explicitly. `getValidToken()` used to take no arguments and read one file
// under `os.homedir()`, so put two patrons in one process and B's refresh
// overwrites A's token, after which A silently acts as B — a successful
// response carrying the wrong person's records, not an error. A header does
// not fix that on its own: writing the header's value into the global rebuilds
// the same race behind a new front door. An explicit parameter does, because a
// call site that never establishes the principal fails to compile instead of
// working at n=1 and failing at n=2. (Not an `AsyncLocalStorage` context for
// the same reason: a site that never enters the context is indistinguishable
// from one that does.)
//
// Named `principal`, not `subject`: "subject" is the research subject
// everywhere else in this repo (`subjectId`, `subject_person_ids`).

import type { AppConfig } from "../types/auth.js";

export type Principal =
  /**
   * The desktop `.mcpb` and both eval harnesses: one user per process, tokens
   * and config in `~/.familysearch-mcp`, refresh done here. Also the hosted
   * alpha, whose control plane provisions those two files into the sandbox.
   */
  | { readonly kind: "local" }
  /**
   * A hosted request: the credential and the per-user config travel with the
   * request. The tool server never refreshes — the web tier owns the grant and
   * hands each turn a fresh access token — and never persists anything per user.
   */
  | { readonly kind: "bearer"; readonly accessToken: string; readonly config: AppConfig };

/** The one-user-per-process principal. The stdio entrypoint passes it to every
 *  tool; tests and dev scripts pass it where a tool needs one. */
export const LOCAL: Principal = { kind: "local" };

/** A per-request principal for a hosted entrypoint. `config` carries the
 *  per-user tunables the desktop reads from `config.json` (wiki API URL,
 *  OpenRouter key and model); `hosted` is implied. */
export function bearerPrincipal(accessToken: string, config: AppConfig = {}): Principal {
  return { kind: "bearer", accessToken, config: { ...config, hosted: true } };
}
