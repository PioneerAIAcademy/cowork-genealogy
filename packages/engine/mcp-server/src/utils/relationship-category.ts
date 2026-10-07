// The relation-word tables used by issue #2535's relationship-direction rule.
// Lifted out of `src/tools/research-append.ts` so `rank-search-matches.ts` can
// reuse `relationshipCategory` for its near-relationship check (#2213) without
// being misread as a document writer: the packaging check in
// `tests/packaging/ownership-manifest.test.ts` walks a module's imports to
// decide what writes, and importing a value from a writer-tool module turns
// the importer into a writer. Pure data; no writes, no `fs`, no `atomicWrite*`.

// Prototype-less: the keys come from a model-supplied `relationship_type`, and
// on a plain object literal `constructor`, `toString` and `__proto__` all read
// back truthy — which turned an unknown spelling into a refusal quoting
// `a function Object() { [native code] } relation`, against the
// skip-never-refuse contract the rule documents. Fixed here rather than at
// each index site so a third one cannot reintroduce it, and so the lookup
// means what the Python mirror's `dict.get()` already meant.
// Exported only so the cross-language drift test can pin it against the
// Python copy; nothing else outside this module reads it directly.
export const RELATION_CATEGORY: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    father: "parent", mother: "parent", parent: "parent",
    son: "child", daughter: "child", child: "child",
    wife: "spouse", husband: "spouse", spouse: "spouse",
    widow: "spouse", widower: "spouse",
    brother: "sibling", sister: "sibling", sibling: "sibling",
  },
);
const RELATION_WORDS = Object.keys(RELATION_CATEGORY).join("|");

// A value LABELS the other party in two shapes that need different patterns.
// An earlier single pattern spanning `[^,]*?` was wrong both ways: a stray
// `[KEY:` colon suppressed real sibling refusals, and one comma in `Father of
// the groom, named as X` made it miss and wrongly refuse a correct assertion.
//
// Only ONE label guard is needed. A label with no ` of ` -- `father: Jan
// Roelfs`, `father named as Casper` -- never reaches here, because
// STATES_SUBJECT_ROLE requires ` of `. A second guard for those was written,
// measured against the corpus, found to change nothing, and deleted; do not
// add it back.
//
// By role: `Father of groom named as Tellef`. The party being named is
// identified by ROLE -- a bare lowercase word -- so it is the other party. A
// CAPITALISED token there is a name, so the value states the subject's own tie
// and must not be skipped.
const LABELS_BY_ROLE = new RegExp(
  `^\\s*(?:the\\s+)?(?:${RELATION_WORDS})\\s+of\\s+(?:the\\s+)?(\\w+)[\\s,]*(?::|\\s+named\\b)`,
  "i",
);
const STATES_SUBJECT_ROLE = new RegExp(
  `^\\s*(?:the\\s+)?(${RELATION_WORDS})\\s+of\\s+`,
  "i",
);

/** Exported only so the cross-language drift test can pin it against the
 *  Python `_relationship_category`: the table alone does not cover the
 *  `_inferred` strip or the trim, and `String.replace` with a string pattern
 *  replaces the FIRST occurrence here while Python's replaces every one. */
export function relationshipCategory(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Anchored, and one suffix only. A bare `.replace("_inferred", "")` strips
  // the FIRST occurrence here and EVERY occurrence in the Python mirror, so
  // `child_inferred_inferred` was unknown to this side and `child` to that
  // one.
  return RELATION_CATEGORY[value.toLowerCase().trim().replace(/_inferred$/, "")];
}

/** The category the VALUE claims for the record subject, or undefined when it
 *  does not speak to the subject's own role. Exported so the cross-language
 *  drift test can pin it against the Python copy in
 *  `eval/harness/validators/test_record_extraction.py`: the rule exists twice
 *  because the harness and the engine share no runtime, and nothing else keeps
 *  the two in step. */
export function subjectRoleInValue(value: string): string | undefined {
  const byRole = LABELS_BY_ROLE.exec(value);
  // A lowercase ASCII token is a role word, not a name. Must stay an explicit
  // class, never a case test: `=== toLowerCase()` is true for a token with no
  // case (`2`) where the Python mirror's .islower() is false, so the two
  // disagreed in both directions before this. The capture stays `\w+` although
  // that is ASCII here and Unicode there: with this guard both spellings reach
  // the same verdict either way, and widening it to `\S+?` was reverted as
  // unobservable.
  if (byRole && /^[a-z]+$/.test(byRole[1])) return undefined;
  const m = STATES_SUBJECT_ROLE.exec(value);
  if (!m) return undefined;
  return RELATION_CATEGORY[m[1].toLowerCase()];
}
