/**
 * Spike 0 — evidence trail behind docs/plan/familysearch-login-plan.md.
 *
 * QUESTION: does GET /platform/users/current return a usable **email** for our
 * client id + token? The unified-FS-login design keys the app allowlist on
 * email; if email is absent/empty the allowlist must re-key to the FS user id.
 * The MCP code reads only `users[0].personId` today (person-ancestors.ts), so
 * email availability is a known unknown — this probe resolves it.
 *
 * Usage:
 *   npx tsx dev/probe-users-current.ts
 *   (requires a prior desktop `login` so ~/.familysearch-mcp/tokens.json exists)
 *
 * What it does: GET https://api.familysearch.org/platform/users/current with
 * Authorization: Bearer <token>, Accept: application/x-fs-v1+json, and the
 * browser User-Agent (api.familysearch.org sits behind Imperva, 403s non-browser
 * UAs). Prints the full users[0] object and a presence/populated table for the
 * identity-relevant fields.
 *
 * RESULTS (2026-06-07, client id fs-internal-dev-key-000262):
 *   HTTP 200. `email` is PRESENT and POPULATED → allowlist keys on email
 *   (decision gate, plan §Spike 0 — steps 2–3 unchanged).
 *
 *   users[0] keys: id, contactName, helperAccessPin, givenName, familyName,
 *     email, country, gender, birthDate, mobilePhoneNumber, preferredLanguage,
 *     displayName, personId, treeUserId, links.
 *   Identity fields (all present & populated):
 *     id          = "cis.user.MMMM-3KXX"   (FS account/user id — `users[0].id`)
 *     email       = "<account email>"      (NB: the FS-account email, which may
 *                                            differ from the app/Google email)
 *     personId    = "KWZP-4QX"             (tree person; what the MCP reads today)
 *     displayName / contactName both populated.
 *   Caveats: (1) NO email-verification flag is returned (Google gave
 *     `email_verified`); we match on an unverifiable email — acceptable for a
 *     tiny POC allowlist. (2) The endpoint also returns account PII
 *     (helperAccessPin, birthDate, mobilePhoneNumber); read ONLY email + id.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const URL = "https://api.familysearch.org/platform/users/current";
const ACCEPT = "application/x-fs-v1+json";
const FIELDS = ["id", "email", "personId", "displayName", "contactName"];

async function main(): Promise<void> {
  const token = await getValidToken();
  const res = await fetch(URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: ACCEPT,
      "User-Agent": BROWSER_USER_AGENT,
    },
  });

  console.log(`HTTP ${res.status} ${res.statusText}`);
  if (!res.ok) {
    console.log(await res.text());
    process.exit(1);
  }

  const body = (await res.json()) as { users?: Array<Record<string, unknown>> };
  const user = body.users?.[0];
  if (!user) {
    console.log("No users[0] in response. Raw body:");
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  console.log("\n=== users[0] — full object ===");
  console.log(JSON.stringify(user, null, 2));

  console.log("\n=== identity field presence ===");
  for (const f of FIELDS) {
    const v = user[f];
    const present = f in user;
    const populated = typeof v === "string" ? v.trim() !== "" : v != null;
    console.log(
      `  ${f.padEnd(14)} present=${present}  populated=${populated}  value=${
        present ? JSON.stringify(v) : "—"
      }`,
    );
  }

  console.log("\n=== all top-level keys on users[0] ===");
  console.log(Object.keys(user).join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
