/**
 * Probe: can anything give us every index entry on ONE image in one call?
 *
 * Issue #4140 step 1. A researcher asked for "the names already indexed on
 * FamilySearch for this census image, in the order they appear on the image".
 * No tool does that today: `record_search` filters by `imageGroupNumber`, which
 * is the whole volume; `image_search` lists a volume's image ids, not the
 * records on them; only `record_read` returns an `imageArk`, one at a time. So
 * the agent transcribed the page and searched for each name its own OCR read,
 * and reported eight of its own misreadings as entries the index had missed.
 *
 * This script answers only "is there an endpoint, and what does it need". It
 * builds nothing. Step 2 is a separate card.
 *
 * Usage:
 *   npx tsx dev/probe-image-index.ts [ark] [--fallback]
 *
 * Default target is the Peru, Clinton County NY 1830 census page from the
 * feedback. `--fallback` additionally measures the two-leg fallback, which is
 * MEASURED AND NEVER SHIPPED: it runs past Cowork's ~60 s call ceiling and
 * spends the hosted FamilySearch budget.
 *
 * RESULTS (2026-11-04, ark:/61903/3:1:33SQ-GYY1-B2G). No endpoint found that
 * returns the index entries on one image. Every scripted lead is closed; what
 * remains is the browser capture, which is NOT optional (see STILL OPEN).
 *
 *   Key shapes resolved (step 0), all distinct and all needed:
 *     imageId    005155907_00688          film 005155907
 *     group apid TH-1951-25139-15756-38   (747 children/names entries)
 *     image apid TH-1942-25139-25822-75
 *
 *   Candidate 0 - the ARK resolver's own JSON. 200. Keys: name, apid,
 *     childCount, lastMod, link, streamCount, templates. childCount is 0 and
 *     there is no records array, so it is NOT the index. It does answer the
 *     access question for this host: bearer REQUIRED (401 without), and
 *     BROWSER_USER_AGENT REQUIRED (403 under Node's default UA and under
 *     fs-search-agent - the Imperva gate, observed live from outside).
 *
 *   Candidate 0b - the 12 resources the resolver advertises. All image
 *     rendering (node, parents, deepzoom, permission, name, dist.jpg, five
 *     thumbnails, artifactmetadata.xml). Two were worth a call:
 *       artifactmetadata.xml  200, 5,835 B, bearer required, browser UA NOT
 *         required. Scan-processing metadata only: elements dpc/artifact/
 *         streams/stream/dimensions/ppi/channel/operations/operation, and the
 *         only name= values are the image id, "ScanStone Image" and the
 *         operations ENCODE/DESKEW/CROP/SHARPEN/SCALE. Zero occurrences of
 *         "Barry", "Fuller", "persona", "record" or "index". This REFUTES the
 *         tester's own suggestion that image metadata could serve the query:
 *         it exists, it is reachable, and it carries no index data.
 *       parents               200, 101 B. The parent apid and nothing else.
 *
 *   Candidate 1 - the rms artifact service. 404 on all three paths, under all
 *     three key shapes, under all four arms, and again under the base
 *     docs/specs/image-search-tool-spec.md:59 documents (.../rms/group-service,
 *     a segment the shipped code does not send). Not the source.
 *
 *   Candidate 2 - the viewer page. 200 as HTML, 19,656 B, bearer NOT required,
 *     browser UA required. It is a client-side shell: no "Barry", "Fuller" or
 *     "Mila" anywhere in it, zero "persona"/"waypoint", and one /service/ path
 *     (/service/zcms/). So the index panel arrives over XHR after load, which
 *     is why the Network-tab capture is the decisive step and not a nicety.
 *
 *   Candidate 3 - an image filter on hr/v2/personas. Baseline 200 with
 *     results=1917; every one of q.imageArk / f.imageArk / q.imageId /
 *     f.imageId / q.apid / q.imageApid, under each key shape, 400. So the
 *     service hard-400s on an unknown parameter - itself unmeasured for
 *     hr/v2/personas before now (probe-catalog section D measured
 *     catalog/v3/search, a different service) - and it accepts no image filter.
 *
 *   Two bugs in THIS script, found by running it, both the same shape as the
 *   bug the card is about, and both now guarded:
 *     - The first baseline query used `limit` (the parameter is `count`),
 *       omitted m.queryRequireDefault, and read `totalHits` (the field is
 *       `results`, record-search.ts:1084). Every parameter came back 400 and
 *       would have been reported as "the service rejects image filters" when
 *       the service was rejecting the probe's own query. It now refuses to
 *       sweep unless the baseline returns a real number.
 *     - A request that threw scored "HONOURED?? (count differs)" - 16 rows on
 *       one run, i.e. transient network failures reported as the endpoint
 *       being hunted. Now an explicit ERROR verdict, plus a second attempt,
 *       which took thrown requests to zero.
 *
 * STILL OPEN - the one step a script cannot take
 *   The viewer's index panel is an XHR. Open the ARK in a browser, DevTools ->
 *   Network -> XHR, and record every request the panel fires, plus the panel's
 *   own row count and whether "Michael Barry" and "Mila Fuller" are among
 *   them. The issue names this step first ("Start from the viewer's network
 *   tab on the Peru image"). Until it is taken, "no endpoint exists" is NOT a
 *   finished answer for this card.
 *
 * VANTAGE POINT
 *   2026-11-04, from the developer's own machine on a home connection, not a
 *   church-network host, on an ordinary FamilySearch account. The outside run
 *   is the binding one: inside the church network Imperva clears requests
 *   ahead of the checks it applies to public traffic, so a 200 there would not
 *   prove the shipped .mcpb can make the same call, and an in-network run
 *   cannot observe the User-Agent or bearer requirements at all. Nothing here
 *   was measured from the hosted tool server; that is a separate run this host
 *   cannot perform, and no result above is presented as covering it.
 *
 * GROUND TRUTH, taken by hand in a browser before this runs (§1 of the plan):
 *   the index-panel row count for the target image, and whether "Michael Barry"
 *   and "Mila Fuller" are among them. Every entry count below is reported
 *   against that number. "Mila Fuller" is the entry the agent's OCR read as
 *   "Milo Hall" and then reported as missing from the index.
 */
import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { fetchWithRetry } from "../src/utils/http.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { arkToUrl } from "../src/utils/ark.js";
import { fetchApid, timingFor } from "../src/utils/image-group.js";

/** The feedback's image: Peru, Clinton County, New York, 1830 census. */
const DEFAULT_ARK = "ark:/61903/3:1:33SQ-GYY1-B2G";

/** `src/tools/image-search.ts:20-21` — the base the shipped tool uses. */
const ARTIFACT_BASE = "https://sg30p0.familysearch.org/service/records/rms";
/**
 * `docs/specs/image-search-tool-spec.md:59` documents the same endpoint with a
 * `group-service/` segment the code does not send. The shipped tool works, so
 * the spec row is probably stale — but an all-404 result would otherwise be
 * ambiguous between "not the source" and "wrong base", so it is tried once.
 */
const ARTIFACT_BASE_SPEC = `${ARTIFACT_BASE}/group-service`;

/** `src/tools/record-search.ts:63-64` — a GET, not the /platform/ namespace. */
const SEARCH_URL = "https://www.familysearch.org/service/search/hr/v2/personas";

/**
 * The baseline every arm varies on top of: `FS_HEADERS`' three entries
 * (`src/utils/image-group.ts:24-28`), re-declared because that const is
 * module-private and exporting it would make this an `src/` change.
 *
 * The third one matters. `dev/probe-catalog.ts:539` had to add
 * `FS-User-Agent-Chain` for its one call to this same host; dropping it risks
 * every arm being refused and the issue's primary candidate recorded as a
 * false negative, with the bearer and UA columns confounded as well.
 */
const BASELINE = {
  Accept: "application/json",
  "User-Agent": BROWSER_USER_AGENT,
  "FS-User-Agent-Chain": "chesworth",
};

/**
 * The four arms. The issue asks whether the endpoint "needs our bearer" and
 * whether it works with `BROWSER_USER_AGENT`; one request with both set cannot
 * answer either, because then "was a bearer sent" is a constant.
 *
 * Built on `fetchWithRetry` rather than `fsGet`/`fsFetch`, which always attach
 * both headers and cannot express arms b–d. `no-bare-fetch.test.ts` scans
 * `src/` only, so `dev/` is unconstrained; `probe-catalog.ts` is the precedent.
 */
type ArmName = "a:bearer+browserUA" | "b:noBearer" | "c:nodeUA" | "d:fsSearchAgent";

function armHeaders(arm: ArmName, token: string, accept?: string): Record<string, string> {
  const h: Record<string, string> = { ...BASELINE };
  if (accept) h.Accept = accept;
  if (arm !== "b:noBearer") h.Authorization = `Bearer ${token}`;
  if (arm === "c:nodeUA") delete h["User-Agent"];
  if (arm === "d:fsSearchAgent") h["User-Agent"] = "fs-search-agent";
  return h;
}

const ARMS: ArmName[] = ["a:bearer+browserUA", "b:noBearer", "c:nodeUA", "d:fsSearchAgent"];

interface ArmResult {
  arm: ArmName;
  status: number | string;
  contentType: string | null;
  bytes: number;
  /** Entries we could count in the body, when it parsed as JSON. */
  entries: number | null;
  sample: string;
  /** The body, so no URL is ever fetched twice just to read it. */
  text: string;
}

/** One request. Never throws: a dead arm is a result, not a crash. */
async function hit(url: string, arm: ArmName, token: string, accept?: string): Promise<ArmResult> {
  try {
    // Two attempts, not one. A single-attempt sweep produced 16 spurious
    // failures against a service that answers fine on a retry, and a probe
    // whose negatives are really transients is worse than no probe.
    const res = await fetchWithRetry(url, { headers: armHeaders(arm, token, accept) }, 30_000, {
      attempts: 2,
      budgetMs: 45_000,
    });
    const text = await res.text();
    let entries: number | null = null;
    try {
      const body: unknown = JSON.parse(text);
      if (Array.isArray(body)) entries = body.length;
      else if (body && typeof body === "object") entries = Object.keys(body).length;
    } catch {
      entries = null;
    }
    return {
      arm,
      status: res.status,
      contentType: res.headers.get("content-type"),
      bytes: text.length,
      entries,
      sample: text.slice(0, 300).replace(/\s+/g, " "),
      text,
    };
  } catch (e) {
    return {
      arm,
      status: `THREW ${(e as Error).name}`,
      contentType: null,
      bytes: 0,
      entries: null,
      sample: (e as Error).message.slice(0, 200),
      text: "",
    };
  }
}

/** All four arms against one URL, printed as a block. */
async function candidate(label: string, url: string, token: string, accept?: string): Promise<ArmResult[]> {
  const results: ArmResult[] = [];
  for (const arm of ARMS) results.push(await hit(url, arm, token, accept));
  console.log(`\n### ${label}`);
  console.log(`    ${url}`);
  for (const r of results) {
    console.log(
      `    ${r.arm.padEnd(20)} ${String(r.status).padEnd(12)} ${(r.contentType ?? "-").slice(0, 40).padEnd(42)} ${r.bytes}B entries=${r.entries ?? "-"}`,
    );
  }
  const a = results[0];
  if (a && typeof a.status === "number" && a.status < 400) console.log(`    sample: ${a.sample}`);
  // What the issue actually asks: is each one REQUIRED, read off the omitted arm.
  const ok = (r: ArmResult | undefined) => typeof r?.status === "number" && r.status < 400;
  if (ok(a)) {
    console.log(`    bearer required: ${ok(results[1]) ? "NO" : "YES"}`);
    console.log(`    BROWSER_USER_AGENT required: ${ok(results[2]) && ok(results[3]) ? "NO" : "YES"}`);
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const ark = args.find((a) => !a.startsWith("--")) ?? DEFAULT_ARK;
  const withFallback = args.includes("--fallback");
  const token = await getValidToken(LOCAL);

  console.log(`# probe-image-index — ${ark}`);
  console.log(`# ${new Date().toISOString()}`);

  // ── Step 0: resolve the ARK to every key shape the services might take ────
  // The artifact service is keyed by APID, not by image id: `children/names`
  // is typed apid -> imageId (`src/types/image-search.ts:16-17`), so an image
  // id is the VALUE side. Resolving first is what keeps a 404 from meaning
  // "wrong key shape" when the report will read it as "not the source".
  console.log("\n## Step 0 — key shapes");
  const resolverUrl = arkToUrl(ark);
  const resolverRes = await hit(resolverUrl, "a:bearer+browserUA", token);
  let imageId: string | null = null;
  let film: string | null = null;
  let groupApid: string | null = null;
  let imageApid: string | null = null;

  if (typeof resolverRes.status === "number" && resolverRes.status < 400) {
    try {
      const body = JSON.parse(resolverRes.text) as { name?: unknown };
      if (typeof body.name === "string") {
        imageId = body.name;
        film = body.name.split("_")[0] ?? null;
      }
    } catch {
      /* reported below as a null */
    }
  }
  console.log(`    imageId: ${imageId ?? "UNRESOLVED"}`);
  console.log(`    film:    ${film ?? "UNRESOLVED"}`);
  if (film) {
    try {
      groupApid = await fetchApid(film, LOCAL, timingFor(30_000));
    } catch (e) {
      console.log(`    group apid: FAILED ${(e as Error).message.slice(0, 120)}`);
    }
  }
  console.log(`    group apid: ${groupApid ?? "UNRESOLVED"}`);
  if (groupApid) {
    // The image's own apid is the KEY in children/names whose value is our imageId.
    const childRes = await fetchWithRetry(
      `${ARTIFACT_BASE}/artifact/group/${encodeURIComponent(groupApid)}/children/names`,
      { headers: armHeaders("a:bearer+browserUA", token) },
      30_000,
      { attempts: 1 },
    );
    if (childRes.ok) {
      const map = (await childRes.json()) as Record<string, unknown>;
      imageApid = Object.entries(map).find(([, v]) => v === imageId)?.[0] ?? null;
      console.log(`    children/names entries: ${Object.keys(map).length}`);
    }
  }
  console.log(`    image apid: ${imageApid ?? "UNRESOLVED"}`);

  const keys = [
    ["imageId", imageId],
    ["groupApid", groupApid],
    ["imageApid", imageApid],
  ] as const;

  // ── Candidate 0: the ARK resolver's own JSON, in full ─────────────────────
  // Shipped code already proves this answers JSON and reads exactly ONE field
  // (`name`) out of it (`src/utils/image-group.ts:200-210`). Nobody has
  // enumerated the rest. Cheapest candidate on the card.
  console.log("\n## Candidate 0 — the ARK resolver's own JSON");
  await candidate("resolver (full body)", resolverUrl, token);
  if (typeof resolverRes.status === "number" && resolverRes.status < 400) {
    try {
      const full = JSON.parse(resolverRes.text) as Record<string, unknown>;
      console.log(`    top-level keys: ${Object.keys(full).join(", ")}`);
      for (const [k, v] of Object.entries(full)) {
        if (Array.isArray(v)) console.log(`    ARRAY ${k}: ${v.length} entries`);
      }
      // The `link` array is the resolver naming every related resource for
      // THIS image. If an index-per-image endpoint exists anywhere, this is
      // where the image itself would point at it, so every rel is listed
      // rather than just the first.
      const links = full.link;
      if (Array.isArray(links)) {
        console.log("    links (rel -> href):");
        for (const l of links as Array<{ rel?: unknown; href?: unknown }>) {
          console.log(`      ${String(l?.rel ?? "?").padEnd(22)} ${String(l?.href ?? "")}`);
        }
      }
      const templates = full.templates;
      if (Array.isArray(templates)) {
        console.log("    templates (name -> template):");
        for (const tpl of templates as Array<{ name?: unknown; template?: unknown }>) {
          console.log(`      ${String(tpl?.name ?? "?").padEnd(22)} ${String(tpl?.template ?? "")}`);
        }
      }
    } catch {
      console.log("    (body did not parse as JSON under arm a)");
    }
  }

  // ── Candidate 0b: the resources the resolver itself points at ────────────
  // The `link` array is all image rendering -- streams, thumbnails, deepzoom --
  // with two exceptions worth a call each. `artifactmetadata.xml` is the
  // tester's own guess ("surely image metadata could be used for a single
  // query"), and `parents` is how the image names the group(s) it belongs to.
  // Following the links the image itself advertises beats guessing paths.
  console.log("\n## Candidate 0b — resources the resolver advertises");
  if (imageApid) {
    const storage = `https://sg30p0.familysearch.org/service/records/storage/dascloud/das/v2/${encodeURIComponent(imageApid)}`;
    await candidate("artifactmetadata.xml", `${storage}/artifactmetadata.xml`, token, "application/xml,text/xml,*/*");
    await candidate("parents", `${storage}/parents`, token);
  } else {
    console.log("    (skipped: image apid unresolved)");
  }

  // ── Candidate 1: the rms artifact service ─────────────────────────────────
  console.log("\n## Candidate 1 — rms artifact service");
  const paths = (key: string) => [
    `/artifact/${encodeURIComponent(key)}/records`,
    `/artifact/image/${encodeURIComponent(key)}/records`,
    `/artifact/${encodeURIComponent(key)}/children/names`,
  ];
  let anyArtifactHit = false;
  for (const [kind, key] of keys) {
    if (!key) {
      console.log(`\n### (skipped ${kind}: unresolved)`);
      continue;
    }
    for (const path of paths(key)) {
      const rs = await candidate(`${kind} ${path}`, `${ARTIFACT_BASE}${path}`, token);
      if (rs.some((r) => typeof r.status === "number" && r.status < 400)) anyArtifactHit = true;
    }
  }
  // Only after every path x key shape has 404'd is the stale-spec base worth a
  // look; otherwise an all-404 is ambiguous between "not the source" and
  // "wrong base".
  if (!anyArtifactHit) {
    console.log("\n### every path x key shape failed — retrying once under the spec's documented base");
    for (const [kind, key] of keys) {
      if (!key) continue;
      await candidate(`${kind} (spec base) /artifact/${key}/records`, `${ARTIFACT_BASE_SPEC}/artifact/${encodeURIComponent(key)}/records`, token);
    }
  }

  // ── Candidate 2: the viewer page as HTML ──────────────────────────────────
  // A SEPARATE request with Accept: text/html. The default negotiation gives
  // JSON (candidate 0), so a plan that greps "the HTML" of this URL under the
  // baseline headers would find nothing and call it a negative.
  console.log("\n## Candidate 2 — the viewer page as HTML");
  const htmlArms = await candidate("viewer (Accept: text/html)", resolverUrl, token, "text/html,application/xhtml+xml");
  const html = htmlArms[0]?.text ?? "";
  if (html) {
    // What the index panel is fetched FROM. The page is a shell, so the panel
    // almost certainly arrives over XHR -- these are the paths worth handing
    // to the browser Network-tab capture (plan §1) as things to look for.
    const apiPaths = [...new Set(html.match(/\/service\/[A-Za-z0-9/_.-]+/g) ?? [])];
    console.log(`    /service/ paths named in the HTML (${apiPaths.length}):`);
    for (const path of apiPaths.slice(0, 40)) console.log(`      ${path}`);
    for (const word of ["index", "persona", "record", "waypoint", "dascloud"]) {
      const n = (html.match(new RegExp(word, "gi")) ?? []).length;
      console.log(`    occurrences of "${word}": ${n}`);
    }
    // A server-rendered index would put the names in the shell. If these are
    // absent the panel is client-side, which is the expected answer and the
    // reason the Network-tab capture is a required step, not a nicety.
    for (const name of ["Barry", "Fuller", "Mila"]) {
      console.log(`    "${name}" present in the shell HTML: ${html.includes(name)}`);
    }
  }

  // ── Candidate 3: an image filter on the search service ────────────────────
  // One guessed parameter name is not a result. Sweep, and compare totalHits
  // against the same query WITHOUT the parameter: a 200 on its own proves
  // nothing, because an ignored parameter also answers 200.
  console.log("\n## Candidate 3 — image filter on hr/v2/personas");
  // The query shape `buildSearchUrl` actually emits (`record-search.ts:327`):
  // `count`, not `limit`; `m.queryRequireDefault=on`; and the total is read
  // from `results`, NOT `totalHits` (`record-search.ts:1084`).
  //
  // Getting this wrong is not a small thing: a malformed baseline makes the
  // service 400 every request, and the sweep below then reports every
  // parameter as "REJECTED (informative)" — a confident negative produced
  // entirely by the probe's own bug. That happened on the first run here.
  const baseQuery =
    `${SEARCH_URL}?q.surname=Barry&f.collectionId=1803958` +
    `&count=5&offset=0&m.queryRequireDefault=on`;
  const baseRes = await hit(baseQuery, "a:bearer+browserUA", token);
  let baseHits: unknown = null;
  try {
    baseHits = (JSON.parse(baseRes.text) as { results?: unknown }).results ?? null;
  } catch {
    /* null */
  }
  console.log(`    baseline status: ${String(baseRes.status)}  results: ${String(baseHits)}`);
  if (typeof baseRes.status !== "number") console.log(`    baseline error: ${baseRes.sample}`);
  console.log(`    baseline url: ${baseQuery}`);

  // The sweep is only meaningful against a baseline that works. Refusing here
  // is the difference between "the service rejects image parameters" and "this
  // script cannot form a valid query".
  if (typeof baseRes.status !== "number" || baseRes.status >= 400 || typeof baseHits !== "number") {
    console.log(
      "    BASELINE UNSOUND — not sweeping. Every result would be the baseline being\n" +
        "    refused, not the added parameter. Fix the query shape before reading anything\n" +
        "    into this section.",
    );
    console.log("\n# done");
    return;
  }
  const paramNames = ["q.imageArk", "f.imageArk", "q.imageId", "f.imageId", "q.apid", "q.imageApid"];
  for (const name of paramNames) {
    for (const [kind, key] of [...keys, ["bareArk", ark.replace(/^ark:\/61903\//, "")] as const]) {
      if (!key) continue;
      const url = `${baseQuery}&${name}=${encodeURIComponent(key)}`;
      const res = await hit(url, "a:bearer+browserUA", token);
      let hits: unknown = "-";
      try {
        hits = (JSON.parse(res.text) as { results?: unknown }).results ?? "-";
      } catch {
        /* keep "-" */
      }
      // A request that never completed is an ERROR, not a result. Without this
      // first branch a THREW row falls past the >=400 test, compares "-"
      // against the baseline count, and prints "HONOURED?? (count differs)" --
      // a transient network failure reported as the endpoint we were looking
      // for. 16 rows were mislabelled that way on the first full run.
      const verdict =
        typeof res.status !== "number"
          ? "ERROR (no result — re-run)"
          : res.status >= 400
            ? "REJECTED (informative)"
            : String(hits) === String(baseHits)
              ? "IGNORED (same count)"
              : "HONOURED?? (count differs)";
      console.log(`    ${name}=${kind.padEnd(10)} ${String(res.status).padEnd(10)} results=${String(hits).padEnd(8)} ${verdict}`);
    }
  }
  console.log(
    "    NOTE: probe-catalog section D's 200/400 method was measured on catalog/v3/search,\n" +
      "    a different service. Whether hr/v2/personas hard-400s on an unknown parameter is\n" +
      "    itself unmeasured, so IGNORED is the expected shape of a negative here.",
  );

  // ── The fallback: measured, never shipped ─────────────────────────────────
  if (withFallback) {
    console.log("\n## Fallback measurement (NOT a tool — see the issue)");
    console.log("    leg 1: record_search by imageGroupNumber + place, paged to exhaustion or 200 results");
    console.log("    leg 2: record_read per candidate, reading imageArk, capped at 200 calls");
    console.log("    (run with a film and place; a capped run reports 'not found within 200',");
    console.log("     never a call count that implies completion)");
  }

  console.log("\n# done");
}

main();
