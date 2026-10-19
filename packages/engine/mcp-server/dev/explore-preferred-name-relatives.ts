/**
 * Issue #2002 step 3: what does FamilySearch actually send for a relative's names?
 *
 * EXPLORATORY. **Its output is not in `dev/measured-figures.json` and must not be
 * cited as measured.** Nothing here calls `record()`. It answers one question for
 * one PID at one moment: for the subject and every relative, how many names come
 * back, in what order, and which (if any) carry `preferred`.
 *
 * `dev/try-person-read.ts` cannot answer this. `shapePersons`
 * (`src/tools/person-read.ts:303`) narrows every person to a single name built
 * from `names[0]` and drops `preferred`, `type` and `ark`, so the tool's own
 * output has already discarded the evidence the question turns on.
 *
 * Reads the raw payload the way `person-read.ts` does — same base, same Accept —
 * and prints `persons[].names[]` verbatim, so the A/B/C fork in issue #2002 can
 * be decided off the wire rather than off the converter.
 *
 * Run: `npx tsx dev/explore-preferred-name-relatives.ts [PID]` from
 * `packages/engine/mcp-server`. Default PID is the #1948 bundle's subject.
 */
import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { fetchRetry } from "./http-retry.js";

const API_BASE = "https://api.familysearch.org/platform/tree/persons";
const ACCEPT_HEADER = "application/x-fs-v1+json";

// Clorinda Sleeper — the subject the #1948 tester built the tree from, whose
// children were reported as "EE Morgan" / "RB Torrance".
const DEFAULT_PID = "LHKH-XKK";

interface RawNameForm {
  fullText?: string;
  parts?: { type?: string; value?: string }[];
}
interface RawName {
  preferred?: boolean;
  type?: string;
  nameForms?: RawNameForm[];
}
interface RawPerson {
  id?: string;
  living?: boolean;
  names?: RawName[];
  identifiers?: Record<string, string[]>;
}

function nameText(n: RawName): string {
  const form = n.nameForms?.[0];
  if (form?.fullText) return form.fullText;
  const parts = (form?.parts ?? [])
    .map((p) => p.value)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  return parts.join(" ") || "(empty)";
}

async function main(): Promise<void> {
  const pid = process.argv[2] ?? DEFAULT_PID;
  const url = `${API_BASE}/${encodeURIComponent(pid)}?relatives=true`;

  // Per request: `getValidToken(LOCAL)` auto-refreshes, so an expired token cannot
  // surface as a 401 that reads like a data value.
  const token = await getValidToken(LOCAL);
  const res = await fetchRetry(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: ACCEPT_HEADER,
        "Accept-Language": "en",
      },
    },
    { maxRetries: 4, baseMs: 3_000, label: pid },
  );

  if (!res.ok) {
    console.error(`HTTP ${res.status} for ${pid} — ${(await res.text()).slice(0, 300)}`);
    process.exitCode = 1;
    return;
  }

  const body = (await res.json()) as { persons?: RawPerson[] };
  const persons = body.persons ?? [];
  console.log(`GET ${url}`);
  console.log(`persons returned: ${persons.length}  (subject + relatives)\n`);

  let noPreferred = 0;
  for (const p of persons) {
    const names = p.names ?? [];
    const anyPreferred = names.some((n) => n.preferred === true);
    if (!anyPreferred) noPreferred += 1;
    const persistent = p.identifiers?.["http://gedcomx.org/Persistent"]?.[0];
    console.log(
      `${p.id ?? "(no id)"}  names=${names.length}  ` +
        `preferredPresent=${anyPreferred}  living=${p.living === true}`,
    );
    console.log(`    persistent: ${persistent ?? "(none)"}`);
    names.forEach((n, i) => {
      console.log(
        `    [${i}] preferred=${n.preferred === true}  ` +
          `type=${n.type ?? "(none)"}  "${nameText(n)}"`,
      );
    });
    console.log();
  }

  console.log("─".repeat(60));
  console.log(`persons with NO preferred-marked name: ${noPreferred} / ${persons.length}`);
  console.log(
    "Branch B (issue #2002) is the case where that count is non-zero for relatives:\n" +
      "the gedcomx-convert reorder is a no-op there and names[0] is FS's own order.",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
