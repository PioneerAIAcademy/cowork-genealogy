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
 *
 * Measured 2026-09-15 (issue #2459) — a merged-away tree person, the case the
 * 2026-09-10 run did not cover:
 *
 *   ark:/61903/4:1:KD96-TV5    merged away -> survivor KW66-5VV   -> 200 not-found
 *   ark:/61903/4:1:KW66-5VV    the survivor (restricted)          -> 200 not-found
 *   ark:/61903/4:1:275H-YL3    positive control (tree dup matches) -> 200 populated
 *
 * Establishing the merge: sweeping the 842 distinct tree PIDs in the committed
 * gedcomx fixtures with the tree-persons endpoint (redirect: manual) returned
 * exactly ONE 301 — KD96-TV5 -> KW66-5VV (~0.12% of THIS pool, not a general
 * FamilySearch merge rate). A 301 with a Location to a different id is FS's
 * merge signal (person-read.ts:106; a delete is 410, which did not occur).
 *
 * Outcome A (true not-found): the merged-away id returns the SAME 200 +
 * results:0 + `not-found` link shape as a never-assigned id, in BOTH the
 * records and tree collections — the same shape as ZZZZ-ZZZZ below, not a
 * populated match set describing the survivor.
 *
 * Positive control for the 4:1: + tree slot (person_person_matches): 275H-YL3
 * returns a POPULATED result there (results>0, links=[self], a real `updated`),
 * so "merged-away -> not-found" in the tree collection is a real signal, not
 * "this slot never returns matches for anyone". The count is not permanent (it
 * drifts as patrons merge); the durable observation is the populated-vs-not-found
 * response shape. (The records slot's control is KNDX-MKG below.)
 *
 * Outcome B (resolves to survivor / returns the survivor's matches under the
 * retired queryArk) was NOT observed. One limit on what this run can tell apart:
 * the survivor KW66-5VV is itself restricted — person_read returns 403, i.e. it
 * EXISTS but is not viewable (not a 404) — and the match endpoint returns the
 * same not-found shape for KW66-5VV too. So this evidence cannot separate "the
 * match endpoint ignores the merge redirect" from "it follows the redirect to a
 * survivor that itself has no visible matches"; either way the retired id yields
 * not-found, not the survivor's matches. A populated retired-vs-survivor
 * comparison could not be made (n=1 candidate in this pool). The 2026-11-09 run
 * below settles that: the redirect IS followed (LZNY-BRF serves PFTB-NS6's
 * record), so Outcome B holds where the survivor has a record of its own.
 *
 * Measured 2026-11-09 — a LIVE, viewable tree person gets the same shape:
 *
 *   4:1:P4M8-VM7  tree-persons 200   -> 200 not-found, epoch updated
 *   4:1:L4BP-ZWW  tree-persons 200   -> 200 not-found, epoch updated
 *   4:1:ZZZZ-ZZZ  tree-persons 404   -> 200 not-found, epoch updated
 *   4:1:LZNY-BRF  tree-persons 301   -> 200 GENUINE ZERO (no not-found, real updated)
 *   4:1:PFTB-NS6 tree-persons 200   -> 200 GENUINE ZERO, same `updated` as LZNY-BRF
 *   4:1:L6KS-9PW  tree-persons 200   -> 200 populated (control)
 *
 * P4M8-VM7 and ZZZZ-ZZZ were compared field by field: identical key sets,
 * identical entries/results/links, epoch `updated` on both, differing only in
 * the id echoed into `title` and the hrefs. So NOTHING in this answer separates
 * a live person from a never-assigned id — only an independent existence check
 * does. That is why the tool cannot key on a field here.
 *
 * It also qualifies Outcome A above. A merged-away id does NOT uniformly return
 * not-found: KD96-TV5 does and LZNY-BRF does not. The difference is NOT the
 * survivor's viewability — P4M8-VM7 and L4BP-ZWW are live and viewable and read
 * not-found anyway. It is whether a match-resolution record exists for the id,
 * which `updated` reports: the epoch on every not-found row, a real timestamp on
 * every other. LZNY-BRF and its survivor PFTB-NS6 return the same links, the
 * same results, and the same `updated` to the millisecond, so the retired id is
 * serving the SURVIVOR's record — Outcome B, measured rather than inferred.
 * KD96-TV5 reads not-found because KW66-5VV has no record either, not because
 * it is restricted.
 *
 * Record-persona side: NOT ESTABLISHED. No independent retirement/merge oracle
 * exists for a 1:1: persona — person_read/person_quality are tree-only,
 * record_read distinguishes only found vs 404 (a 404 cannot prove prior
 * assignment), and this endpoint's not-found link is the artifact under test.
 * The tree-person result is therefore not generalised to record personas.
 */
import { LOCAL } from "../src/auth/principal.js";
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
  // Merged-away tree person KD96-TV5 -> survivor KW66-5VV (issue #2459, measured
  // 2026-09-15; see header). Both collections return the same not-found shape as
  // a never-assigned id (Outcome A), not a populated survivor match set. Survivor
  // KW66-5VV is restricted (403 = exists but not viewable) and also reads
  // not-found here, so this run cannot show whether the redirect was followed;
  // the LZNY-BRF/PFTB-NS6 pair below shows that it is.
  ["merged-away tree person KD96-TV5", "records", "ark:/61903/4:1:KD96-TV5"],
  ["merged-away tree person KD96-TV5", "tree", "ark:/61903/4:1:KD96-TV5"],
  ["survivor KW66-5VV (restricted)", "records", "ark:/61903/4:1:KW66-5VV"],
  ["survivor KW66-5VV (restricted)", "tree", "ark:/61903/4:1:KW66-5VV"],
  // Positive control for the 4:1: + tree slot (person_person_matches): a normal
  // tree person that returns a POPULATED result there (results>0, links=[self]),
  // so merged-away -> not-found in this slot is distinguishable from "this slot
  // never returns matches". The count is not permanent; the shape is the point.
  ["positive control, tree dup matches (275H-YL3)", "tree", "ark:/61903/4:1:275H-YL3"],

  // ── Issue #4390, measured 2026-11-09 ──────────────────────────────────────
  // P4M8-VM7 and L4BP-ZWW are LIVE, viewable tree people whom person_read
  // returns, yet person_record_matches answered not-found for both on
  // 2026-11-09. If that reproduces, a not-found link does not mean "no such
  // person" and the tool's throw is wrong for this class.
  //
  // LZNY-BRF is the row the question turns on: a 4:1: id that returns a GENUINE
  // zero with a normal envelope, on the same account and date. Without it there
  // is no same-slot contrast, and the only genuine-zero case above is a 1:1:
  // record persona -- the wrong slot to generalise from.
  //
  // L6KS-9PW is the records-slot positive control, measured at 1 match on THIS
  // account on 2026-11-09 (KNDX-MKG's reading is nine weeks older).
  //
  // ZZZZ-ZZZ is 4-3, the TREE person shape (FS_PERSON_ID_RE, src/utils/fs-id.ts).
  // The 4-4 ZZZZ-ZZZZ above is the record-persona shape and says nothing here.
  ["live tree person P4M8-VM7 (Charles Bazzle)", "records", "ark:/61903/4:1:P4M8-VM7"],
  ["live tree person P4M8-VM7 (Charles Bazzle)", "tree", "ark:/61903/4:1:P4M8-VM7"],
  ["live tree person L4BP-ZWW (son Francis)", "records", "ark:/61903/4:1:L4BP-ZWW"],
  ["live tree person L4BP-ZWW (son Francis)", "tree", "ark:/61903/4:1:L4BP-ZWW"],
  ["merged-away LZNY-BRF -> PFTB-NS6, genuine zero", "records", "ark:/61903/4:1:LZNY-BRF"],
  ["merged-away LZNY-BRF -> PFTB-NS6, genuine zero", "tree", "ark:/61903/4:1:LZNY-BRF"],
  ["survivor PFTB-NS6", "records", "ark:/61903/4:1:PFTB-NS6"],
  ["survivor PFTB-NS6", "tree", "ark:/61903/4:1:PFTB-NS6"],
  ["positive control, records slot (L6KS-9PW)", "records", "ark:/61903/4:1:L6KS-9PW"],
  ["positive control, records slot (L6KS-9PW)", "tree", "ark:/61903/4:1:L6KS-9PW"],
  ["never assigned, TREE shape (4-3)", "records", "ark:/61903/4:1:ZZZZ-ZZZ"],
  ["never assigned, TREE shape (4-3)", "tree", "ark:/61903/4:1:ZZZZ-ZZZ"],
];

/** Tree-persons existence oracle (issue #4390 step 1).
 *
 *  Status only, and `redirect: "manual"` so a merge shows as its own 301 with a
 *  Location rather than being followed. This is a MEASUREMENT in a dev script,
 *  not the production existence check step 2 may add: nothing here imports
 *  person-read, whose `API_BASE` and `buildUrl` are module-private anyway. */
const TREE_PERSONS = "https://api.familysearch.org/platform/tree/persons";

async function existenceStatus(token: string, pid: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(`${TREE_PERSONS}/${pid}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/x-fs-v1+json" },
      redirect: "manual",
    });
    const loc =
      res.status === 301 ? ` -> ${res.headers.get("location") ?? "(no Location header)"}` : "";
    return `${res.status}${loc}`;
  } catch (err) {
    return `THREW ${(err as Error).message}`;
  }
}

async function main(): Promise<void> {
  const token = await getValidToken(LOCAL);

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
        // The summary line first, then the WHOLE body. A key-name list answers
        // only "is there a new key"; issue #4390 asks whether ANYTHING separates
        // the two cases, which includes a differing VALUE on a key that is
        // already there -- `updated` (epoch vs real) is the known one, and
        // `title` was never printed at all. Every not-found body carries
        // `entries: []`, so this stays short.
        line =
          `${res.status} | entries=${entries} results=${JSON.stringify(body.results)} ` +
          `links=${JSON.stringify(links)} updated=${JSON.stringify(body.updated)}` +
          `\n  body-> ${JSON.stringify(body)}`;
      }
    } catch (err) {
      line = `THREW ${(err as Error).message}`;
    }
    console.log(`\n[${collection}] ${label}\n  id=${id}\n  -> ${line}`);
  }

  // Pair each 4:1: id with whether FamilySearch will serve the person at all.
  // The issue's own Evidence table uses exactly this pairing, and step 2's
  // decision is written in these status codes. Distinct pids only: CASES lists
  // each id twice (once per collection) and the answer does not vary by slot.
  // Skipped for 1:1:, which has no tree-person oracle.
  console.log(`\n\n=== tree-persons existence (GET, redirect: manual) ===`);
  const pids = [
    ...new Set(
      CASES.map(([, , id]) => id)
        .filter((id) => id.includes("4:1:"))
        .map((id) => id.split("4:1:")[1]),
    ),
  ];
  for (const pid of pids) {
    console.log(`  ${pid.padEnd(12)} -> ${await existenceStatus(token, pid)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
