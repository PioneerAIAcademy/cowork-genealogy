/**
 * Probe: does fetching a FamilySearch ARK resolver URL directly (as
 * image-read.ts's `arkToImageUrl` does) land on image bytes, or on an HTML
 * viewer page? Evidence for docs/specs/image-read-spec.md's ark-resolution
 * caveat.
 *
 * Usage:
 *   npx tsx dev/probe-image-read-ark-resolver.ts <ark>
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

async function main() {
  const ark = process.argv[2];
  if (!ark) {
    console.error("Usage: npx tsx dev/probe-image-read-ark-resolver.ts <ark>");
    process.exit(1);
  }
  const token = await getValidToken();
  const url = ark.startsWith("http")
    ? ark
    : `https://www.familysearch.org/${ark.replace(/^ark:\//, "ark:/")}`;

  for (const accept of ["image/*,*/*", "application/json,*/*;q=0.8"]) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept,
        "User-Agent": BROWSER_USER_AGENT,
      },
      redirect: "follow",
    });
    console.log(`--- Accept: ${accept} ---`);
    console.log("status:", res.status, res.statusText);
    console.log("final url:", res.url);
    console.log("content-type:", res.headers.get("content-type"));
    const text = await res.text();
    console.log("body (first 800 chars):", text.slice(0, 800));
    console.log();
  }
}

main();
