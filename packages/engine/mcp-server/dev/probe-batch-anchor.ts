/**
 * Probe — evidence trail behind the `batchNumber` anchor rule in
 * docs/specs/record-search-tool-spec-v2.md ("Anchor rule (design note)") and
 * behind the `batchNumber` / `recordCountry` schema descriptions in
 * src/tools/record-search.ts.
 *
 * It exists because a validation rule was reversed on a measurement. When
 * `batchNumber` was first added, it was deliberately kept off the anchor list:
 * a batch search still had to carry `surname` or `recordCountry`. This probe is
 * what refuted that.
 *
 *   LEG 1 — Does a batch anchor alone? `q.batchNumber` with no other field.
 *   LEG 2 — Does the natural companion field cost anything? The same batch
 *           plus the country the batch actually belongs to.
 *   LEG 3 — What does a MISMATCHED country do? The failure mode the docs now
 *           warn about: it must be distinguished from "wrong batch", because
 *           both return 0 and only one of them is the caller's fault.
 *   LEG 4 — Does a surname still narrow within a batch? The one companion
 *           field the docs still permit.
 *   LEG 5 — Does a nonexistent batch return 0 rather than being ignored?
 *
 * EVERY VERDICT IS COMPUTED FROM THE RUN, never a literal — same rule as
 * probe-search-qualifiers.ts. A leg that errors prints NOT MEASURED rather
 * than a direction, so a failed request can never read as a finding.
 *
 * Run:  npx tsx dev/probe-batch-anchor.ts
 * Needs a live FamilySearch token (`login` tool first).
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchWithTimeout } from "../src/utils/http.js";

const BASE = "https://www.familysearch.org/service/search/hr/v2/personas";

/** A batch known to be non-empty and US-held. Swap if it ever goes away. */
const BATCH = "B01883-5";
const BATCH_COUNTRY = "United States";
const MISMATCHED_COUNTRY = "England";
/** A second batch in a different shape — all-numeric, no letter prefix. */
const NUMERIC_BATCH = "8317102";
const NONSENSE_BATCH = "Z99999-9";

type Leg = { total: number | null; note?: string };

async function count(qs: string): Promise<Leg> {
  try {
    const token = await getValidToken();
    const res = await fetchWithTimeout(
      `${BASE}?${qs}&m.queryRequireDefault=on&m.defaultFacets=off&count=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": BROWSER_USER_AGENT,
        },
      },
      25_000,
    );
    if (!res.ok) return { total: null, note: `HTTP ${res.status}` };
    const body = (await res.json()) as { results?: number };
    if (typeof body.results !== "number") return { total: null, note: "no `results` field" };
    return { total: body.results };
  } catch (err) {
    return { total: null, note: err instanceof Error ? err.message : String(err) };
  }
}

const show = (l: Leg): string => (l.total === null ? `NOT MEASURED (${l.note})` : String(l.total));

const alone = await count(`q.batchNumber=${BATCH}`);
const numericAlone = await count(`q.batchNumber=${NUMERIC_BATCH}`);
const withCountry = await count(
  `q.batchNumber=${BATCH}&q.recordCountry=${encodeURIComponent(BATCH_COUNTRY)}`,
);
const withWrongCountry = await count(
  `q.batchNumber=${BATCH}&q.recordCountry=${encodeURIComponent(MISMATCHED_COUNTRY)}`,
);
const withSurname = await count(`q.batchNumber=${BATCH}&q.surname=Smith`);
const nonsense = await count(`q.batchNumber=${NONSENSE_BATCH}`);

console.log(`
LEG 1  batch alone                      ${BATCH}                    -> ${show(alone)}
       batch alone, all-numeric shape    ${NUMERIC_BATCH}            -> ${show(numericAlone)}
LEG 2  batch + matching country          + ${BATCH_COUNTRY}          -> ${show(withCountry)}
LEG 3  batch + MISMATCHED country        + ${MISMATCHED_COUNTRY}     -> ${show(withWrongCountry)}
LEG 4  batch + surname                   + Smith                     -> ${show(withSurname)}
LEG 5  nonexistent batch                 ${NONSENSE_BATCH}           -> ${show(nonsense)}
`);

function verdict(label: string, ok: boolean | null, yes: string, no: string): void {
  if (ok === null) console.log(`  ${label}: NOT MEASURED`);
  else console.log(`  ${label}: ${ok ? yes : no}`);
}

const measured = (...legs: Leg[]): boolean => legs.every((l) => l.total !== null);

verdict(
  "anchors alone",
  measured(alone, numericAlone) ? alone.total! > 0 && numericAlone.total! > 0 : null,
  "YES — a batch-only query is accepted upstream and returns records, so the " +
    "anchor rule's cost rationale never applied to it",
  "NO — a batch-only query returned nothing; the anchor rule should stand",
);

verdict(
  "matching country is inert",
  measured(alone, withCountry) ? alone.total === withCountry.total : null,
  "YES — identical totals, so the field buys nothing on a batch search",
  "NO — the totals differ; re-read before claiming the field is pointless",
);

verdict(
  "mismatched country is destructive",
  measured(withWrongCountry, alone) ? withWrongCountry.total === 0 && alone.total! > 0 : null,
  "YES — it zeroes a search that otherwise returns records. This is the whole " +
    "reason the docs forbid adding a country to a batch search: it is silent, " +
    "and it is indistinguishable from LEG 5 (a wrong batch)",
  "NO — it did not zero the search; the prohibition needs re-deriving",
);

verdict(
  "surname still narrows",
  measured(withSurname, alone) ? withSurname.total! > 0 && withSurname.total! < alone.total! : null,
  "YES — the one companion field that narrows without the silent-zero risk",
  "NO — surname did not narrow within the batch",
);

verdict(
  "nonexistent batch returns 0 rather than being ignored",
  measured(nonsense) ? nonsense.total === 0 : null,
  "YES — so a nil under a batch means the batch is wrong, not that the parish " +
    "is empty",
  "NO — the batch appears to have been ignored rather than applied",
);
