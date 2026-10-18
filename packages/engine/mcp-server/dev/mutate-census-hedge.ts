/**
 * Mutation sweep: take out one clause or guard of the pre-1880 census hedge
 * at a time and check that `tests/tools/pre1880-census-hedge.test.ts` notices.
 *
 * WHY THIS EXISTS. The hedge is a deny, and a deny that fails open fails
 * silently. Twice on issue #2123's PR a mechanism shipped that no test
 * exercised — the backward branch and the sentence stop in one round, the
 * `of` and `includes` relations in the next — and in each case the suite was
 * green with the mechanism deleted. Reading the tests does not catch that: a
 * note written to exercise one clause routinely satisfies two, so the clause
 * you meant to pin is covered incidentally by a neighbour and the coverage is
 * imaginary. Only removing it and watching the suite go red says otherwise.
 *
 * A GREEN ROW IS A FINDING, not a pass. It means that clause can be deleted
 * with the suite still green, so either it needs a test or it is inert and
 * should go. One clause was deleted on exactly that basis: the requirement
 * that a person stand outside a `(head)` bracket moved nothing over 4,322
 * corpus notes and could not be given a failing test, because it did nothing.
 *
 * HOW THIS SCRIPT ITSELF FAILED, which is why it is shaped as it is. The
 * first version ran the suite through `npx` and treated any output it could
 * not parse as a red. On Windows `execFileSync("npx", …)` throws
 * `spawnSync npx ENOENT`, every mutation landed in "did not compile", and it
 * printed "18 of 18 pinned" and exited 0 HAVING RUN NO TESTS — a check that
 * passes by doing nothing, in a script `research-log-editor-spec.md` §8.2
 * tells the reader to run instead of trusting the prose, on the platform the
 * genealogist team uses. Three rules follow, and none of them is optional:
 *
 *   1. The UNMUTATED suite runs first and must pass. If the harness cannot
 *      run, or the tree is already red, the sweep says so and stops rather
 *      than reporting on mutations whose result it cannot interpret.
 *   2. A mutation counts as red ONLY when a failure count is parsed out of
 *      the run. Not "the process exited non-zero", not "the output did not
 *      match" — a number.
 *   3. Anything else is an ERROR and exits 1: a run that produced no parsable
 *      result, and a `SKIPPED` entry whose substring no longer matches the
 *      source, which silently stops covering its clause.
 *
 * It launches vitest as `node node_modules/vitest/vitest.mjs` rather than
 * through `npx` or a shell, so there is no `.cmd` resolution to get wrong.
 *
 * Offline; no FamilySearch session needed. Not shipped in any artifact.
 *
 * Usage:
 *   npx tsx dev/mutate-census-hedge.ts
 * Exits 0 only when every mutation was observed to turn the suite red.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../src/tools/research-log-append.ts");
const PKG = resolve(here, "..");
const VITEST = resolve(PKG, "node_modules/vitest/vitest.mjs");
const SPEC = "tests/tools/pre1880-census-hedge.test.ts";

/** [label, literal substring of the source, what to replace it with]. */
const MUTATIONS: readonly (readonly [string, string, string])[] = [
  ["coresidence arm", "...phrasesOf(CORESIDENCE_CLAIM, notes).map(otherClaim),", ""],
  ["compound arm", "...householdCompounds(sentence).map(headClaim),", ""],
  ["place guard", 'run.every((t) => !PLACE_MARKER_ONLY.test(t.replace(/\\.$/, "")))', "true"],
  ["complement guard", "(?![ ]${HOUSEHOLD_COMPLEMENT}\\b)", ""],
  ["sentence-opener strip", "while (run.length > 0 && SENTENCE_OPENER.test(run[0])) run.shift();", ""],
  ["sentence stop", ".split(/[.;]\\s/)", ".split(/\\u0000/)"],
  ["role in parens", "...phrasesOf(ROLE_IN_PARENS, notes).map(roleClaim),", ""],
  ["`of` relation", "\\b${HOUSEHOLD_NOUNS}\\s+of\\b", "(?!x)x"],
  ["`in` relation", "\\b(?:in|within)\\s+(?:[\\w.'’-]+\\s+){0,3}${HOUSEHOLD_NOUNS}\\b", "(?!x)x"],
  ["possessive relation", "\\b[\\w.’-]+(?:'s|s'|’s|s’)\\s+${HOUSEHOLD_NOUNS}\\b", "(?!x)x"],
  ["includes relation", "\\b${HOUSEHOLD_NOUNS}\\s+(?:\\d+\\s+)?(?:also\\s+)?(?:includes?|contains?|comprises?|lists?|holds?)\\b", "(?!x)x"],
  ["headship, head-first", "\\bhead(?:s|ing|ed)?\\s+(?:a|the|his|her|their|own|her\\s+own|his\\s+own)?\\s*${HOUSEHOLD_NOUNS}\\b", "(?!x)x"],
  ["headship, headed-by", "\\b${HOUSEHOLD_NOUNS}\\s+head(?:s|ing|ed)?\\s+by\\b", "(?!x)x"],
  ["head participle", "head(?:s|ing|ed)?\\s+(?:a|the", "heads?\\s+(?:a|the"],
  ["kinship: children", "|parents?|children)", "|parents?)"],
  ["kinship: report verb", "(?:(?:is|was|are|were)\\s+(?:listed|recorded|shown|given|named)\\s+as\\s+)?", ""],
  ["kinship: possessive carve-out", "/(?<!\\b(?:his|her|their)\\s)\\b(?:mother|", "/\\b(?:mother|"],
  ["hyphen in the hedge", "relationship[\\s-]+(?:to[\\s-]+head[\\s-]+)?column", "relationship\\s+(?:to\\s+head\\s+)?column"],
  ["roster arm", "...householdRosters(sentence).map(otherClaim),", ""],
  ["roster place guard", 'run.split(" ").some((t) => PLACE_MARKER_ONLY.test(t.replace(/\\.$/, "")));', "false;"],
  ["roster: linking words", "((?:[ ][a-z][\\w.'’-]*){0,3})", "()"],
  ["roster: several linking words", "((?:[ ][a-z][\\w.'’-]*){0,3})", "((?:[ ][a-z][\\w.'’-]*){0,1})"],
  ["roster of spellings", "if (ROSTER_OF_SPELLINGS.test(m[1])) continue;", ""],
  ["roster of places", "if (ROSTER_OF_PLACES.test(sentence.slice((m.index ?? 0) + m[0].length))) continue;", ""],
  ["kinship: plural punctuation", "...(payload ? phrasesOf(PLURAL_KINSHIP_PUNCTUATED, notes).map(otherClaim) : []),", ""],
  ["plural punctuation: payload only", "(payload ? phrasesOf(PLURAL_KINSHIP_PUNCTUATED", "(true ? phrasesOf(PLURAL_KINSHIP_PUNCTUATED"],
  ["as role", "...asRoleClaims(notes),", ""],
  ["as role: other-source sentence", "!SOURCE_NAMED.test(sentence.toLowerCase()) && ", ""],
  ["as role: tree sentence", " && !/\\btree\\b/i.test(sentence)", ""],
  ["as role: initial not a stop", ".split(/(?<!\\b[A-Z])[.;]\\s/)", ".split(/[.;]\\s/)"],
  ["household head named", "...phrasesOf(HOUSEHOLD_HEAD_NAMED, notes).map(headClaim),", ""],
  ["head of household", "...phrasesOf(HEAD_OF_HOUSEHOLD, notes).map(headClaim),", ""],
  ["roster place names", 'ROSTER_PLACE_NAMES.has(run.replace(/\\.$/, "")) ||', ""],
  ["possessive kinship", "...(payload ? phrasesOf(POSSESSIVE_KINSHIP, notes).map(otherClaim) : []),", ""],
  ["possessive: payload only", "(payload ? phrasesOf(POSSESSIVE_KINSHIP", "(true ? phrasesOf(POSSESSIVE_KINSHIP"],
  ["coresidents named", "...phrasesOf(CORESIDENTS_NAMED, notes).map(otherClaim),", ""],
  ["coresidents: names required", "(?:(?:are|were|include[sd]?|including)\\s+|:\\s*)?(?!(?:None|No|Not|Nil|N\\/A)\\b)[A-Z]/", "/"],
  ["coresidents: none is no name", "(?!(?:None|No|Not|Nil|N\\/A)\\b)", ""],
  ["hedge: no relationships stated", "/\\bno\\s+relationships?\\s+(?:is\\s+|are\\s+|was\\s+|were\\s+)?(?:stated|given|recorded|listed)\\b/.test(text) ||", ""],
  ["hedge: does not record a relationship", "/\\b(?:does|did)(?:\\s+not|n['’]t)\\s+record\\b[^.]{0,60}\\brelationship/.test(text) ||", ""],
  ["pre- binding", "Number(y) - (before && i === 0 ? 1 : 0)", "Number(y)"],
  ["pre- first year only", "(before && i === 0 ? 1 : 0)", "(before ? 1 : 0)"],
  ["payload: every row British", "if (!BRITISH_TITLE.test(title.trim())) return undefined;", "if (!BRITISH_TITLE.test(title.trim())) continue;"],
  ["payload: title anchored", "const BRITISH_TITLE = /^(?:", "const BRITISH_TITLE = /(?:"],
  ["payload: tool guard", 'if (tool !== "record_search" && tool !== "record_read") return undefined;', ""],
  ["qualified: pre-1880 is US", "const qualified = before || usAfter ||", "const qualified = usAfter ||"],
  ["qualified: census of the U.S.", "const qualified = before || usAfter ||", "const qualified = before ||"],
  ["qualified: united states", "(?:u\\.?\\s?s|united\\s+states|federal)\\b/i;", "(?:u\\.?\\s?s|federal)\\b/i;"],
  ["qualified: USA", "(?:u\\.?\\s?s(?:\\.?a)?\\b|united", "(?:u\\.?\\s?s\\b|united"],
  ["payload: qualified kept", "!m.qualified && payloadColumnFrom !== undefined", "payloadColumnFrom !== undefined"],
  ["payload: sd_c_ only", '&& s.id.startsWith("sd_c_")', ""],
  ["payload: British wording", "fired.every((m) => m.columnFrom === 1851)", "false"],
  ["head-only: head claims dropped", "claims.filter((c) => !(headOnly && c.head))", "claims"],
  ["head-only: US mentions only", "m.columnFrom === 1880 && HEAD_ONLY_US_CENSUS_YEARS.has(m.year)", "HEAD_ONLY_US_CENSUS_YEARS.has(m.year)"],
  ["head-only: census years, not a range", "HEAD_ONLY_US_CENSUS_YEARS.has(m.year)", "(m.year >= 1790 && m.year <= 1840)"],
  ["head-only: payload years", ": payloadYears.every((y) => HEAD_ONLY_US_CENSUS_YEARS.has(y));", ": false;"],
  ["head-only: head role", "head: /\\bhead\\b(?!['’]s\\b)/i.test(phrase)", "head: false"],
  ["head-only: other roles", "head: /\\bhead\\b(?!['’]s\\b)/i.test(phrase)", "head: true"],
  ["head-only: the head's is not head", "\\bhead\\b(?!['’]s\\b)/i", "\\bhead\\b/i"],
  ["head-only: head relations", "phrasesOf(HOUSEHOLD_HEAD_CLAIM, sentence).map(headClaim)", "phrasesOf(HOUSEHOLD_HEAD_CLAIM, sentence).map(otherClaim)"],
  ["head-only: member relations", "phrasesOf(HOUSEHOLD_MEMBER_CLAIM, sentence).map(otherClaim)", "phrasesOf(HOUSEHOLD_MEMBER_CLAIM, sentence).map(headClaim)"],
  ["head-only: compounds", "householdCompounds(sentence).map(headClaim)", "householdCompounds(sentence).map(otherClaim)"],
  ["head-only: rosters", "householdRosters(sentence).map(otherClaim)", "householdRosters(sentence).map(headClaim)"],
  ["head-only: co-residence", "phrasesOf(CORESIDENCE_CLAIM, notes).map(otherClaim)", "phrasesOf(CORESIDENCE_CLAIM, notes).map(headClaim)"],
  ["head-only: named co-residents", "phrasesOf(CORESIDENTS_NAMED, notes).map(otherClaim)", "phrasesOf(CORESIDENTS_NAMED, notes).map(headClaim)"],
  ["head-only: kinship", "phrasesOf(KINSHIP_CLAIM, notes).map(otherClaim)", "phrasesOf(KINSHIP_CLAIM, notes).map(headClaim)"],
  ["head-only: plural punctuation", "phrasesOf(PLURAL_KINSHIP_PUNCTUATED, notes).map(otherClaim)", "phrasesOf(PLURAL_KINSHIP_PUNCTUATED, notes).map(headClaim)"],
  ["head-only: possessive kinship", "phrasesOf(POSSESSIVE_KINSHIP, notes).map(otherClaim)", "phrasesOf(POSSESSIVE_KINSHIP, notes).map(headClaim)"],
  ["head-only: household head", "phrasesOf(HOUSEHOLD_HEAD_NAMED, notes).map(headClaim)", "phrasesOf(HOUSEHOLD_HEAD_NAMED, notes).map(otherClaim)"],
  ["head-only: head of household", "phrasesOf(HEAD_OF_HOUSEHOLD, notes).map(headClaim)", "phrasesOf(HEAD_OF_HOUSEHOLD, notes).map(otherClaim)"],
  ["head-only: wording", "LogAppendError(\n    headOnly\n", "LogAppendError(\n    false\n"],
  ["head-only: other persons", "...(excusesHead ? otherPersonClaims(notes) : []),", ""],
  ["other persons: beside a head claim", "const excusesHead = headOnly && claims.some((c) => c.head);", "const excusesHead = headOnly;"],
  ["other persons: census sentences", "return censusSentences(notes)", "return [notes]"],
  ["other persons: relation words", "...phrasesOf(HEAD_ONLY_RELATION, sentence),", ""],
  ["other persons: relation any case", "widow(?:er)?s?)\\b/i;", "widow(?:er)?s?)\\b/;"],
  ["other persons: after his/her/their", "/\\b(?:wife|wives|husbands?", "/(?<!\\b(?:his|her|their)\\s)\\b(?:wife|wives|husbands?"],
  ["other persons: grand- and step-", "(?:grand|step)?(?:sons?", "(?:sons?"],
  ["other persons: companions", "...[...sentence.matchAll(NAMED_COMPANION_G)].filter((m) => !isPlaceRun(m[1])).map((m) => m[0]),", ""],
  ["other persons: a place is no companion", ".filter((m) => !isPlaceRun(m[1]))", ""],
  ["other persons: names with ages", "...phrasesOf(AGED_NAMES, sentence),", ""],
  ["other persons: two ages, not one", "(?:and[ ]+)?${AGED_NAME})+", "(?:and[ ]+)?${AGED_NAME})*"],
  ["other persons: a name on a tally", "...phrasesOf(NAMED_TALLY, sentence),", ""],
  ["other persons: not a pronoun", "(?!(?:He|She|It|They|This|That|The|Who)\\b)", ""],
  ["other persons: enumerated in it", "...phrasesOf(NAMED_IN_IT, sentence),", ""],
  ["one-side binding", 'if (boundTokens.has(m.index + (m[1] ?? "").length)) continue;', ""],
  ["roster after a place word", "if (ROSTER_AFTER_PLACE_WORD.test(m[1])) continue;", ""],
  ["roster: a census run is no person", " && !/\\bCensus\\b/.test(run)", ""],
  ["roster place names: United States", '"Wyoming", "United States",', '"Wyoming",'],
  ["quotes: the census", "? quoted(fired.map((m) => m.phrase))", '? ""'],
  ["quotes: the staged census", "`the staged search's ${[...new Set(payloadYears)].sort((a, b) => a - b).join(\"/\")} US census rows`", '""'],
  ["quotes: the wording", "const wording = quoted(stated.map((c) => c.phrase));", 'const wording = "";'],
  ["quotes: whole words", '+ (/^[\\w\'’-]*/.exec(s.slice(end))?.[0] ?? "")', ""],
  ["quotes: the pre- prefix", '`${prefix ?? ""}${m[0]}`', "m[0]"],
  ["quotes: at most eight", "distinct.slice(0, 8)", "distinct"],
  ["quotes: a long one cut", "p.length > 80 ?", "false ?"],
  ["quotes: each phrase once", "lower.indexOf(lower[i]) === i && ", ""],
  ["quotes: none inside another", " && !lower.some((q) => q.length > p.length && q.includes(lower[i]))", ""],
];

/** `{ passed, failed }` from one vitest run, or null if none was parsed. */
function runSuite(): { passed: number; failed: number } | null {
  let out: string;
  try {
    out = execFileSync(process.execPath, [VITEST, "run", SPEC], {
      cwd: PKG,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { stdout?: string | null; stderr?: string | null };
    // A non-zero exit is expected when the suite goes red, and the summary is
    // still on stdout. A runner that never STARTED has neither, which is the
    // case that must not read as a red.
    if (err.stdout == null && err.stderr == null) return null;
    out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
  const m = /Tests\s+(?:(\d+) failed \| )?(\d+) passed/.exec(out);
  if (!m) return null;
  return { failed: Number(m[1] ?? 0), passed: Number(m[2]) };
}

// A function DECLARATION, not a const arrow: TypeScript narrows through a
// never-returning call only for this form, and the `baseline` checks below
// depend on that narrowing.
function fail(msg: string): never {
  console.error(`sweep aborted: ${msg}`);
  process.exit(1);
}

if (!existsSync(VITEST)) fail(`vitest not found at ${VITEST} — run npm ci in ${PKG}`);

// Rule 1: the harness has to work, and the tree has to be green, BEFORE any
// mutation result can be interpreted.
const baseline = runSuite();
if (baseline === null) fail("the unmutated suite produced no parsable result — the runner did not start");
if (baseline.failed > 0) fail(`the unmutated suite is already red (${baseline.failed} failed) — fix that first`);
console.log(`baseline: ${baseline.passed} passed, 0 failed\n`);

const original = readFileSync(SRC, { encoding: "utf-8" });
const rows: string[] = [];
let bad = 0;

try {
  for (const [label, from, to] of MUTATIONS) {
    const hits = original.split(from).length - 1;
    if (hits !== 1) {
      rows.push(`${label.padEnd(30)} SKIPPED — substring appears ${hits}x; re-key this entry`);
      bad++;
      continue;
    }
    writeFileSync(SRC, original.replace(from, to), { encoding: "utf-8" });
    const r = runSuite();
    // Rule 2: red means a parsed failure count, and nothing else.
    if (r === null) {
      rows.push(`${label.padEnd(30)} ERROR — no parsable result; the run did not happen`);
      bad++;
    } else if (r.failed > 0) {
      rows.push(`${label.padEnd(30)} red (${r.failed} failed)`);
    } else {
      rows.push(`${label.padEnd(30)} GREEN — unpinned, needs a test or deletion`);
      bad++;
    }
  }
} finally {
  writeFileSync(SRC, original, { encoding: "utf-8" });
}

console.log(rows.join("\n"));
// Rule 3: anything that is not an observed red fails the sweep.
console.log(`\n${MUTATIONS.length - bad} of ${MUTATIONS.length} observed red.`);
process.exit(bad === 0 ? 0 : 1);
