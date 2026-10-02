/**
 * Step 1 — evidence trail behind issue #2987 (a Memories PAGE url is unreadable).
 *
 * QUESTION: a source attached to a person can carry a Memories *web page* URL —
 * `https://www.familysearch.org/photos/artifacts/<id>` — rather than the direct
 * bytes URL `person_read` gets from the Memories API. `fs-image-fetch.ts` only
 * accepts the latter (MEMORY_ARTIFACT_PATTERN, `sg30p0.../dist.<ext>`), so the
 * original record — often the best evidence on the person — cannot be read.
 * Issue #2987 proposes resolving the page URL to the direct link. The endpoint
 * that would do it was a CANDIDATE, unverified, when the issue was written.
 *
 * This probe answers the issue's two step-1 questions:
 *   (a) which Memories endpoint returns the artifact's `about` for an id taken
 *       from a page URL, whether it needs a bearer, and the exact `about` shape;
 *   (b) what the reported 403 most likely was.
 *
 * The issue's stop rule: if no endpoint returns an `sg30p0 .../dist.<ext>` URL,
 * STOP and report on the issue — do not build the resolver.
 *
 * Usage:
 *   npx tsx dev/probe-memory-page.ts [artifactId ...]
 *   (requires a prior `login` so ~/.familysearch-mcp/tokens.json exists)
 *
 * Default sample: 117201348 — the artifact from alpha-feedback issue #2932,
 * a photo of the original 1844 Carroll County marriage register.
 *
 * RESULTS (2026-09-30, 5 artifacts: 117201348 from the feedback bundle plus the
 * 4 in eval/tests, re-derived with
 * `git grep -ho "photos/artifacts/[0-9]*" -- eval/tests | sort -u`).
 *
 * (a) THE ENDPOINT WORKS, and the id needs no translation.
 *     GET https://api.familysearch.org/platform/memories/memories/<id>, where
 *     <id> is the digits from the page URL verbatim. 5 of 5 returned 200 with
 *     `about` matching MEMORY_ARTIFACT_PATTERN:
 *
 *       artifact     with bearer   no bearer     dist ext
 *       117201348    200 2339b     200 2339b     jpg
 *       186975195    200 2299b     200 2299b     jpg
 *       196822046    200 2097b     200 2097b     pdf
 *       233105768    200 2101b     200 2101b     pdf
 *       240070200    200 2345b     200 2345b     jpg
 *
 *     Shape: top level is `{sourceDescriptions}` — one entry, whose `about` is
 *     the bytes URL, e.g.
 *     `https://sg30p0.familysearch.org/service/records/storage/dascloud/patron/v2/TH-7768-103723-9979-62/dist.jpg?ctx=ArtCtxPublic`.
 *     `links.image.href` carries the same URL; `links.image-thumbnail`,
 *     `image-icon` and `image-deep-zoom-lite` are OTHER sizes and must not be
 *     taken. Read `about`, which is the same field `fetchMemories` already reads
 *     (memories.ts:137). The id is the memory id: a person-memories read of
 *     G4RN-2YB returns `sourceDescriptions[0].id == 117201348`, so a page URL's
 *     digits address the memory directly.
 *
 *     NO BEARER IS NEEDED. Authenticated and anonymous responses were
 *     byte-identical on all five. **This contradicts issue #2987**, which says
 *     "the page-URL form needs login for the lookup" and asks for both tool
 *     descriptions to be changed to say so. On this evidence that edit would
 *     make them wrong. Caveat: every artifact measured is `ctx=ArtCtxPublic`;
 *     no restricted artifact was available to test, so "public artifacts need
 *     no login" is what was measured, not "no artifact ever does". Sending the
 *     bearer anyway costs nothing and covers a restricted one.
 *
 *     Two candidates that do NOT work, recorded so a later reader does not retry
 *     them: `platform/memories/artifacts/<id>` (404, JSON body) and
 *     `www.familysearch.org/service/memories/artifact/v1/artifacts/<id>` (404).
 *
 *     One transient to know about: the first call of a run threw `fetch failed`
 *     (connection, not HTTP) and the same URL returned 200 on retry. The probe
 *     does not retry; a single `fetch failed` here is not evidence of anything.
 *
 * (b) THE 403 DID NOT REPRODUCE — it is a 404 today.
 *     `npx tsx dev/try-image-read.ts ark:/61903/3:1:117201348` returns
 *     "FamilySearch image fetch failed: 404", whose message already tells the
 *     agent not to build an ark from a record id. The issue's unverified guess
 *     was a rights-restricted 403 from the resolver; that is not what this
 *     path produces now. Whatever the tester's 403 was, it is not reproducible
 *     from the artifact id, so it should not be cited as the cause.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { LOCAL } from "../src/auth/principal.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { isMemoryArtifactUrl } from "../src/utils/fs-image-fetch.js";

const ACCEPT = "application/x-fs-v1+json";

/** Every endpoint worth trying for one artifact id, most-likely first. The
 *  issue names only the first; the rest are here so a failure on it is
 *  distinguishable from "the Memories API cannot do this at all". */
function candidates(id: string): { label: string; url: string }[] {
  return [
    { label: "platform/memories/memories/<id>", url: `https://api.familysearch.org/platform/memories/memories/${id}` },
    { label: "platform/memories/artifacts/<id>", url: `https://api.familysearch.org/platform/memories/artifacts/${id}` },
    { label: "service/memories/artifact/v1/artifacts/<id>", url: `https://www.familysearch.org/service/memories/artifact/v1/artifacts/${id}` },
  ];
}

/** Pull every string that looks like an artifact URL out of an arbitrary JSON
 *  body, so the probe reports the `about` shape rather than assuming it. */
function urlsIn(node: unknown, path = "$", out: [string, string][] = []): [string, string][] {
  if (typeof node === "string") {
    if (/^https?:\/\//.test(node)) out.push([path, node]);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => urlsIn(v, `${path}[${i}]`, out));
    return out;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      urlsIn(v, `${path}.${k}`, out);
    }
  }
  return out;
}

async function attempt(url: string, token: string | null): Promise<void> {
  const headers: Record<string, string> = {
    Accept: ACCEPT,
    "Accept-Language": "en",
    "User-Agent": BROWSER_USER_AGENT,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const withAuth = token ? "with bearer" : "NO bearer ";
  try {
    const res = await fetch(url, { headers, redirect: "follow" });
    const body = await res.text();
    console.log(`    ${withAuth}  ${res.status} ${res.statusText}  (${body.length} bytes)`);
    if (res.status !== 200 || body.length === 0) {
      if (body.length && body.length < 300) console.log(`      body: ${body.replace(/\s+/g, " ").slice(0, 280)}`);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      console.log(`      body is not JSON; first 200: ${body.slice(0, 200)}`);
      return;
    }
    const found = urlsIn(parsed);
    const artifacts = found.filter(([, u]) => isMemoryArtifactUrl(u));
    console.log(`      top-level keys: ${Object.keys(parsed as object).join(", ")}`);
    console.log(`      urls in body: ${found.length}; matching MEMORY_ARTIFACT_PATTERN: ${artifacts.length}`);
    for (const [path, u] of found.slice(0, 12)) {
      const hit = isMemoryArtifactUrl(u) ? "  <== MATCHES" : "";
      console.log(`        ${path} = ${u}${hit}`);
    }
  } catch (err) {
    console.log(`    ${withAuth}  THREW ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : ["117201348"];

  let token: string | null = null;
  try {
    token = await getValidToken(LOCAL);
    console.log("Bearer: available\n");
  } catch (err) {
    console.log(`Bearer: UNAVAILABLE (${(err as Error).message}) — running unauthenticated only\n`);
  }

  for (const id of ids) {
    console.log(`=== artifact ${id} ===`);
    console.log(`  page URL it came from: https://www.familysearch.org/photos/artifacts/${id}`);
    for (const { label, url } of candidates(id)) {
      console.log(`  ${label}`);
      console.log(`    ${url}`);
      if (token) await attempt(url, token);
      await attempt(url, null);
    }
    console.log();
  }

  console.log("(b) What the reported 403 most likely was:");
  console.log("    reproduce with: npx tsx dev/try-image-read.ts ark:/61903/3:1:<id>");
  console.log("    The issue's unverified guess: the agent built a 3:1: ARK from the");
  console.log("    artifact id and got a rights-restricted 403 from the image resolver.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
