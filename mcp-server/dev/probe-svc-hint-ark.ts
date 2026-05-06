/**
 * Verify what the entry.hints ARK actually points to.
 *
 * Probe-final showed each hint as { id: "ark:/61903/4:1:XXXX", stars: N }.
 * The 4:1 prefix differs from persona 1:1 and record 1:2 — strongly
 * suggests a Family Tree person ARK. Confirm by:
 *   (a) GETting the bare ark URL and seeing where it redirects (UI route)
 *   (b) GETting the platform tree-person API for the same ARK suffix
 */
import { getValidToken } from "../src/auth/refresh.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

// Sample hint ARK from probe-svc-final
const HINT_ARK_FULL = "https://familysearch.org/ark:/61903/4:1:GQWZ-GPX";
const HINT_ID = "GQWZ-GPX";

async function main() {
  const token = await getValidToken();
  console.log(`Got token (${token.length} chars)\n`);

  // (a) Bare ark URL — see where the UI sends us (collection/record/tree?)
  console.log("=== (a) GET the bare ark URL — where does it redirect? ===");
  console.log(`URL: ${HINT_ARK_FULL}`);
  const arkRes = await fetch(HINT_ARK_FULL, {
    method: "GET",
    redirect: "manual",
    headers: { "User-Agent": BROWSER_UA },
  });
  console.log(`  status=${arkRes.status}`);
  console.log(`  redirects-to=${arkRes.headers.get("location") ?? "(none)"}`);
  console.log("");

  // (b) Try platform tree person endpoint
  console.log("=== (b) Try as a tree person via /platform/tree/persons/{pid} ===");
  const treeUrl = `https://api.familysearch.org/platform/tree/persons/${HINT_ID}`;
  console.log(`URL: ${treeUrl}`);
  const treeRes = await fetch(treeUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    },
  });
  console.log(`  status=${treeRes.status}`);
  console.log(`  content-type=${treeRes.headers.get("content-type")}`);
  if (treeRes.ok) {
    const data = (await treeRes.json()) as { persons?: Array<{ id?: string; names?: Array<{ nameForms?: Array<{ fullText?: string }> }>; facts?: Array<{ type?: string }> }> };
    const p = data.persons?.[0];
    console.log(`  found person: id=${p?.id}`);
    console.log(`  name: ${p?.names?.[0]?.nameForms?.[0]?.fullText ?? "(none)"}`);
    console.log(`  fact types: ${(p?.facts ?? []).map((f) => f.type?.split("/").pop()).join(", ")}`);
  } else {
    const body = await treeRes.text();
    console.log(`  body (preview): ${body.slice(0, 240).replace(/\s+/g, " ")}`);
  }
  console.log("");

  // (c) Try platform records persona endpoint as a control (it shouldn't work)
  console.log("=== (c) Sanity: same ARK as a record persona — should NOT match ===");
  const recordUrl = `https://api.familysearch.org/platform/records/personas/${HINT_ID}`;
  console.log(`URL: ${recordUrl}`);
  const recRes = await fetch(recordUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    },
  });
  console.log(`  status=${recRes.status}`);
  if (!recRes.ok) {
    const body = await recRes.text();
    console.log(`  body (preview): ${body.slice(0, 240).replace(/\s+/g, " ")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
