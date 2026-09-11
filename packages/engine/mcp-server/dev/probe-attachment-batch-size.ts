/**
 * Probe: how many URIs will the FamilySearch attachments API accept in one POST?
 *
 * Issue #1212 raises rank_search_matches from a fixed top-10 to every scored
 * candidate, which raises applyAttachments from ~10 URIs to ~50 in a single
 * unchunked POST (source-attachments.ts sends `uris` whole). The spec records
 * no cap. This probe measures one.
 *
 * It escalates batch size over the SAME pool of ARKs, so a failure is
 * attributable to size rather than to a bad ARK: if the small control batch
 * succeeds and a larger one does not, the cap is real. If the control also
 * fails, the pool is bad and the run is inconclusive — the script says so
 * rather than reporting a cap that is really an authentication or ARK problem.
 *
 * Usage:
 *   npx tsx dev/probe-attachment-batch-size.ts <file-of-arks>
 *   npx tsx dev/probe-attachment-batch-size.ts <file-of-arks> 10,25,50,100
 *
 * The file is one ARK per line (`ark:/61903/1:1:...`). Build one from the
 * committed eval run logs — those ARKs came back from live API calls, so unlike
 * the hand-written test fixtures they name records that actually exist:
 *
 *   grep -rhoE 'ark:/61903/1:1:[A-Z0-9-]{6,}' eval/runlogs \
 *     | sort -u | head -200 > /tmp/ark-pool.txt
 *
 * A pool of dead ARKs does not invalidate the result: the escalation is over
 * one pool, so the control batch and the large batch share whatever is wrong
 * with it, and a control failure is reported as inconclusive.
 */
import { readFileSync } from "node:fs";
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchWithTimeout } from "../src/utils/http.js";
import { arkToUrl } from "../src/utils/ark.js";

const URL =
  "https://www.familysearch.org/service/tree/links/sources/attachments";

const [poolPath, sizeArg] = process.argv.slice(2);
if (!poolPath) {
  console.error(
    "Usage: npx tsx dev/probe-attachment-batch-size.ts <file-of-arks> [sizes]",
  );
  process.exit(1);
}

const pool = [
  ...new Set(
    readFileSync(poolPath, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("ark:/")),
  ),
];
const sizes = (sizeArg ?? "1,10,25,50,75,100")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

async function probe(n: number, token: string) {
  const uris = [...new Set(pool.slice(0, n).map(arkToUrl))];
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": BROWSER_USER_AGENT,
      },
      body: JSON.stringify({ uris }),
    });
    const elapsed = Date.now() - started;
    const text = await res.text();
    let keys = -1;
    let attached = -1;
    try {
      const body = JSON.parse(text);
      // The API answers under `attachedSourcesMap`, keyed by resolver URL, and
      // omits URIs that have no attachments — so an empty map is a valid
      // answer, not a failure. `keys` is therefore coverage (how many of the
      // sent URIs came back answered), which is the number that shows all N
      // were processed rather than merely accepted.
      const map = body?.attachedSourcesMap ?? {};
      if (map && typeof map === "object") {
        keys = Object.keys(map).length;
        attached = Object.values(map).filter(
          (v) => Array.isArray(v) && v.length > 0,
        ).length;
        const sent = new Set(uris);
        const stray = Object.keys(map).filter((k) => !sent.has(k));
        if (stray.length > 0) {
          console.log(`  !! ${stray.length} returned key(s) were never sent`);
        }
      }
    } catch {
      /* non-JSON body reported via status + snippet below */
    }
    console.log(
      `sent=${String(uris.length).padStart(4)}  status=${res.status}  ` +
        `answered=${String(keys).padStart(4)}  nonEmpty=${String(attached).padStart(4)}  ` +
        `${String(elapsed).padStart(6)}ms` +
        (res.ok ? "" : `  body=${text.slice(0, 200).replace(/\s+/g, " ")}`),
    );
    return res.ok;
  } catch (err) {
    const elapsed = Date.now() - started;
    console.log(
      `sent=${String(uris.length).padStart(4)}  THREW after ${elapsed}ms: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

const token = await getValidToken();
console.log(`pool=${pool.length} unique ARKs from ${poolPath}`);
console.log(`sizes=${sizes.join(",")}\n`);

const results: Array<[number, boolean]> = [];
for (const n of sizes) {
  if (n > pool.length) {
    console.log(`sent=${String(n).padStart(4)}  SKIPPED (pool has only ${pool.length})`);
    continue;
  }
  results.push([n, await probe(n, token)]);
}

console.log("");
const control = results[0];
if (!control) {
  console.log("VERDICT: inconclusive — no batch was sent.");
} else if (!control[1]) {
  console.log(
    `VERDICT: inconclusive — the smallest batch (${control[0]}) already failed, ` +
      "so the pool or the session is bad, not the size.",
  );
} else {
  const firstFail = results.find(([, ok]) => !ok);
  console.log(
    firstFail
      ? `VERDICT: a cap exists — ${firstFail[0]} failed while ${control[0]} succeeded.`
      : `VERDICT: no cap up to ${results[results.length - 1][0]} URIs in one POST.`,
  );
}
