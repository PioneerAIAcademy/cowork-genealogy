/**
 * fs-token — print the desktop login's FamilySearch access token, refreshing it first
 * unless it still has real life left. This is how the prototype stack gets its
 * FS_ACCESS_TOKEN (apps/server/proto/env.sh): one patron, the operator, on every turn,
 * and never a stale token copied by hand.
 *
 *   npx tsx dev/fs-token.ts [--min-life <minutes>]
 *
 * `getValidToken(LOCAL)` alone is NOT enough here, which is what this script exists to
 * fix. Its contract is the tool path's: return the stored access token unchanged unless
 * it has already expired. A token minted 52 minutes ago is not expired, so
 * `make proto-token` handed the D17 run a token with eight minutes of life and the run
 * died mid-delegation (plan: D17, 2026-09-21). So this script reads the same token state
 * the module does and passes a `now` that makes the module's OWN expiry check fire
 * early: with `--min-life <m>`, a token that will not outlive the next `m` minutes is
 * refreshed now, through the module's own `refreshAccessToken` + `saveTokens`. Nothing
 * in `src/auth/` is weakened or forked — the module keeps deciding what "expired" means,
 * including its five-minute `EXPIRY_BUFFER_MS`, which stacks on top of `--min-life`.
 *
 * The default window is the prototype's own step ceiling: a turn may run `READ_TIMEOUT_S`
 * (1800 s, apps/server/proto/docker-compose.yml) before the shim kills the worker, so a
 * token handed over between turns has to outlive thirty minutes or the run can still die
 * mid-delegation — the D17 failure narrowed, not closed. With the buffer stacked, the
 * effective refresh threshold is thirty-five minutes; `make proto-token` widens it
 * through `PROTO_TOKEN_MIN_LIFE`.
 *
 * Everything this script does not own it defers to `getValidToken(LOCAL)`: no session on
 * disk, and a session with no refresh token, are its errors (and its hosted wording), not
 * ours. A refresh token the server rejects fails loudly — exit 2, the reason on stderr —
 * rather than handing over the dying token it was asked to replace.
 *
 * The token and nothing else on stdout; exit 2 with the reason on stderr.
 */
import { pathToFileURL } from "node:url";
import { LOCAL } from "../src/auth/principal.js";
import { getValidToken, refreshAccessToken } from "../src/auth/refresh.js";
import { loadTokens, saveTokens, isExpired } from "../src/auth/tokenManager.js";
import type { TokenStore } from "../src/types/auth.js";

/**
 * Minutes of life a token must have left to be handed over as it stands: the prototype's
 * 1800 s step ceiling in minutes, so a token can outlive a full-length turn. The auth
 * module's five-minute `EXPIRY_BUFFER_MS` stacks on top, putting the real threshold at 35.
 */
export const DEFAULT_MIN_LIFE_MINUTES = 30;

export const USAGE = "usage: npx tsx dev/fs-token.ts [--min-life <minutes>]";

const FLAG = "--min-life";
const MS_PER_MINUTE = 60_000;

function toMinutes(value: string | null): number {
  if (value === null || value.trim() === "") {
    throw new Error(`${FLAG} needs a value in minutes. ${USAGE}`);
  }
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(
      `${FLAG} takes a non-negative number of minutes, not ${JSON.stringify(value)}. ${USAGE}`
    );
  }
  return minutes;
}

/**
 * The `--min-life` window in minutes, defaulting to DEFAULT_MIN_LIFE_MINUTES.
 *
 * Throws on anything it does not understand — a missing value, a value that is not a
 * finite non-negative number, an unknown flag. A script that silently ignored those
 * would print a token nobody asked it to check, which is the failure it exists to
 * prevent.
 */
export function parseMinLifeMinutes(argv: string[]): number {
  let minutes = DEFAULT_MIN_LIFE_MINUTES;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === FLAG) {
      minutes = toMinutes(i + 1 < argv.length ? argv[i + 1] : null);
      i += 1;
      continue;
    }
    if (arg.startsWith(`${FLAG}=`)) {
      minutes = toMinutes(arg.slice(FLAG.length + 1));
      continue;
    }
    throw new Error(`unknown argument ${JSON.stringify(arg)}. ${USAGE}`);
  }
  return minutes;
}

/** The auth module's side of this script, injectable so the branches are testable. */
export interface TokenIO {
  loadTokens: () => Promise<TokenStore | null>;
  saveTokens: (tokens: TokenStore) => Promise<void>;
  refreshAccessToken: (refreshToken: string) => Promise<TokenStore>;
  getValidToken: () => Promise<string>;
  now: () => number;
}

export const DEFAULT_IO: TokenIO = {
  loadTokens,
  saveTokens,
  refreshAccessToken,
  getValidToken: () => getValidToken(LOCAL),
  now: () => Date.now(),
};

/**
 * An access token with at least `minLifeMinutes` of life left, refreshing the stored one
 * when there is less. `isExpired` is the module's own check, called with a `now` pushed
 * forward by the window.
 */
export async function tokenWithMinLife(
  minLifeMinutes: number,
  io: TokenIO = DEFAULT_IO
): Promise<string> {
  const tokens = await io.loadTokens();
  if (!tokens || !tokens.refreshToken) {
    // No session, or nothing to refresh with: getValidToken owns both errors.
    return io.getValidToken();
  }
  if (!isExpired(tokens, io.now() + minLifeMinutes * MS_PER_MINUTE)) {
    return tokens.accessToken;
  }
  let refreshed: TokenStore;
  try {
    refreshed = await io.refreshAccessToken(tokens.refreshToken);
  } catch (err) {
    throw new Error(
      `FamilySearch refresh failed (${err instanceof Error ? err.message : String(err)}). ` +
        "The refresh token is dead too — log in again with `make e2e-login`."
    );
  }
  await io.saveTokens(refreshed);
  return refreshed.accessToken;
}

/** The script: the token on `out`, or the reason on `err` and exit code 2. */
export async function main(
  argv: string[],
  io: TokenIO = DEFAULT_IO,
  out: (text: string) => void = (text) => process.stdout.write(text),
  err: (text: string) => void = (text) => process.stderr.write(text)
): Promise<number> {
  try {
    out(await tokenWithMinLife(parseMinLifeMinutes(argv), io));
    return 0;
  } catch (e) {
    err(`fs-token: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  process.exit(await main(process.argv.slice(2)));
}
