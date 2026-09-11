/**
 * Probe: does the match-resolutions endpoint validate the id's FORM, or look it
 * up — and can a caller tell "no matches" apart from "no such persona"?
 *
 * Run: npx tsx dev/probe-match-not-found.ts   (requires a logged-in token)
 *
 * Measured 2026-09-10. Recorded here rather than deleted, because the previous
 * generation of probes behind this tool's spec were removed before merge and
 * their conclusions then survived for months as folklore nobody could re-check.
 *
 * What it established:
 *
 *   ark:/61903/1:1:ZZZZ-ZZZZ   well-formed, never assigned  -> 200
 *   ark:/61903/1:1:AAAA-AAAA   malformed                    -> 400
 *   p_293161675629             the results sidecar's id     -> 400
 *
 * So the STATUS CODE turns on form alone — a well-formed id gets a 200 whether
 * or not it names anything. Existence is still checked, and has to be: the ARK
 * is the lookup key for this service, not a label on something being compared,
 * so the record persona must exist in the record database. The result of that
 * check is reported in the BODY: a `not-found` link, which is the ONLY explicit
 * difference from a persona that genuinely has no matches. `updated` is a
 * second tell (epoch vs a real timestamp). `matchById` keys on the link.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchWithTimeout } from "../src/utils/http.js";

const API =
  "https://sg30p0.familysearch.org/search/match/resolutions/match/matches";

const CASES: Array<[label: string, collection: string, id: string, status?: string[]]> = [
  ["real persona, populated", "tree", "ark:/61903/1:1:QPTX-TMQ2"],
  ["real persona, GENUINE zero", "tree", "ark:/61903/1:1:QPTX-TMQ2", ["rejected"]],
  ["well-formed, never assigned", "tree", "ark:/61903/1:1:ZZZZ-ZZZZ"],
  ["malformed (bad form)", "tree", "ark:/61903/1:1:AAAA-AAAA"],
  ["results-sidecar persona id", "tree", "p_293161675629"],
  ["real tree person, populated", "records", "ark:/61903/4:1:KNDX-MKG"],
];

async function main(): Promise<void> {
  const token = await getValidToken();

  for (const [label, collection, id, status] of CASES) {
    const url = new URL(API);
    url.searchParams.set("collection", collection);
    url.searchParams.set("id", id);
    url.searchParams.set("minConfidence", "2");
    url.searchParams.set("includeSummary", "false");
    url.searchParams.set("count", "20");
    for (const s of status ?? ["accepted", "pending", "rejected"]) {
      url.searchParams.append("status", s);
    }

    let line: string;
    try {
      const res = await fetchWithTimeout(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": BROWSER_USER_AGENT,
        },
      });
      const text = await res.text();
      let body: Record<string, unknown> | null = null;
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* non-JSON body: reported via the raw text below */
      }
      if (!body) {
        line = `${res.status} | non-JSON: ${text.slice(0, 120)}`;
      } else {
        const links = body.links ? Object.keys(body.links) : [];
        const entries = Array.isArray(body.entries) ? body.entries.length : "n/a";
        line =
          `${res.status} | entries=${entries} results=${JSON.stringify(body.results)} ` +
          `links=${JSON.stringify(links)} updated=${JSON.stringify(body.updated)}`;
      }
    } catch (err) {
      line = `THREW ${(err as Error).message}`;
    }
    console.log(`\n[${collection}] ${label}\n  id=${id}\n  -> ${line}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
