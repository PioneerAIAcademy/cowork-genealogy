/**
 * One-shot: list the FATHER actually indexed on each record returned by a
 * `q.fatherGivenName=...` search, at a chosen offset.
 *
 * Section T concluded that `fatherGivenName` ranks rather than filters on
 * content — the total barely moves when the value changes. If that is right,
 * the top of the result set should be full of matching fathers and the tail
 * should not be. This prints the tail so the claim can be looked at directly
 * rather than inferred from totals.
 *
 * Usage: npx tsx dev/try-father-conflicts.ts [offset] [count]
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";

const URL_BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const QUERY = process.env.PROBE_QUERY ??
  "q.surname=Purnell&q.recordCountry=England&q.fatherGivenName=William";
/**
 * Diacritic-insensitive, because the index is not.
 *
 * Without this, `José` does not "contain" `Jose` and every Portuguese father
 * matching the query counts as a CONFLICT. That is exactly what happened on the
 * first enumeration: 11 apparent conflicts, 10 of which were `José` — the very
 * name searched for. A conflict count built on a naive `includes` is measuring
 * the accent, not the name.
 */
const fold = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const WANTED = fold(process.env.PROBE_WANTED ?? "william");

interface RelRef {
  resourceId?: string;
}

interface Entry {
  id?: string;
  content?: {
    gedcomx?: {
      persons?: Array<Record<string, unknown>>;
      relationships?: Array<{ type?: string; person1?: RelRef; person2?: RelRef }>;
    };
  };
}

async function main(): Promise<void> {
  const token = await getValidToken();
  const arg = process.argv[2] ?? "1960";
  // `all` reads the pool to the END rather than sampling one page. A sampled
  // page can only ever say what is near the top; whether a CONFLICTING father
  // exists anywhere in the set is a membership question and needs the whole set.
  const enumerateAll = arg.toLowerCase() === "all";
  const offset0 = enumerateAll ? 0 : Number(arg);
  const count = Number(process.argv[3] ?? 20);
  const PAGE = enumerateAll ? 100 : count;

  const entries: Entry[] = [];
  let reported: number | null = null;
  let complete = false;
  for (let off = offset0; ; off += PAGE) {
    if (off + PAGE > 4999) break; // API search-depth limit
    const url = `${URL_BASE}?${QUERY}&count=${PAGE}&offset=${off}&m.queryRequireDefault=on`;
    if (off === offset0) console.log(url + "\n");
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Language": "en",
        "User-Agent": BROWSER_USER_AGENT,
      },
    });
    const j = JSON.parse(await res.text()) as {
      results?: number;
      errors?: string[];
      entries?: Entry[];
    };
    if (j.errors?.length) {
      console.error(j.errors.join("; "));
      process.exit(1);
    }
    reported ??= j.results ?? null;
    const page = j.entries ?? [];
    entries.push(...page);
    if (!enumerateAll || page.length < PAGE) {
      complete = enumerateAll && page.length < PAGE;
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  let match = 0;
  let conflict = 0;
  let silent = 0;
  const conflicts: string[] = [];
  for (const e of entries) {
    const persons = e.content?.gedcomx?.persons ?? [];
    const matched = persons[0] ?? {};
    const matchedId = matched.id as string | undefined;
    const rels = e.content?.gedcomx?.relationships ?? [];
    // Same resolution the probe uses: parents of the MATCHED persona, via the
    // ParentChild graph, then the male one (display.gender first, then
    // gender.type, then the role label).
    const parentIds =
      matchedId === undefined
        ? []
        : rels
            .filter((r) => r.type?.endsWith("ParentChild") && r.person2?.resourceId === matchedId)
            .map((r) => r.person1?.resourceId)
            .filter((id): id is string => typeof id === "string");
    const spouseIds =
      matchedId === undefined
        ? []
        : rels
            .filter((r) => r.type?.endsWith("Couple"))
            .flatMap((r) => {
              const a = r.person1?.resourceId;
              const b = r.person2?.resourceId;
              if (a === matchedId && typeof b === "string") return [b];
              if (b === matchedId && typeof a === "string") return [a];
              return [];
            });
    const useSpouse = (process.env.PROBE_FAMILY ?? "father") === "spouse";
    const spousePerson = persons.find((p) => spouseIds.includes(p.id as string));
    const father = useSpouse ? spousePerson : persons.find((p) => {
      if (!parentIds.includes(p.id as string)) return false;
      const d = (p.display ?? {}) as { role?: string; gender?: string };
      const genderType = (p.gender as { type?: string } | undefined)?.type ?? "";
      return d.gender === "Male" || /Male$/.test(genderType) || /Father/i.test(d.role ?? "");
    });
    const fatherName = ((father?.display ?? {}) as { name?: string }).name ?? null;
    const relIndexed = useSpouse
      ? persons.filter((p) => spouseIds.includes(p.id as string)).length
      : persons.filter((p) => parentIds.includes(p.id as string)).length;
    const who = ((matched.display ?? {}) as { name?: string }).name ?? "?";


    let verdict: string;
    if (fatherName === null) {
      verdict = relIndexed === 0 ? "no parent indexed" : "parent indexed, no readable name";
      silent++;
      // An INITIAL counts as a match, not a conflict. `Thiago J Bochnia` is a
      // legitimate hit for a `Jose` search — the index holds the initial, and
      // the search matches it. Counting it as a conflict was the second scoring
      // bug in this script (the first was diacritics), and both inflated the
      // conflict count in the same direction: toward "the model is broken".
    } else if (
      fold(fatherName).includes(WANTED) ||
      fold(fatherName)
        .split(/\s+/)
        .some((tok) => tok.replace(/\./g, "").length === 1 && tok[0] === WANTED[0])
    ) {
      verdict = "MATCHES";
      match++;
    } else {
      verdict = "*** CONFLICTS ***";
      conflict++;
      conflicts.push(`${(e.id ?? "?").padEnd(10)} ${who.slice(0, 32).padEnd(32)} father=${fatherName}`);
    }
    if (!enumerateAll) {
      console.log(
        `  ${(e.id ?? "?").padEnd(10)} ${who.slice(0, 34).padEnd(34)} father=${(fatherName ?? "-").slice(0, 30).padEnd(30)} ${verdict}`
      );
    }
  }
  if (conflicts.length) {
    console.log("  CONFLICTING fathers found (record, matched person, indexed father):");
    for (const c of conflicts.slice(0, 25)) console.log(`    ${c}`);
    if (conflicts.length > 25) console.log(`    ... and ${conflicts.length - 25} more`);
  }
  console.log(
    `\n  read ${entries.length} rows${enumerateAll ? (complete ? " (POOL READ TO THE END)" : " (INCOMPLETE — hit the depth limit)") : ` at offset ${offset0}`}:` +
      ` ${match} match, ${conflict} conflict, ${silent} silent` +
      `   (reported total ${reported?.toLocaleString("en-US") ?? "?"})`
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
