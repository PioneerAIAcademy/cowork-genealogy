// Is this string shaped like a FamilySearch person id?
//
// FamilySearch person ids are four characters, a hyphen, three characters,
// drawn from A-Z0-9 minus the vowels (e.g. `KD96-TV2`, `KWCJ-RN4`). A project's
// own local ids (`I1`, `P3`) never match, and neither does anything FamilySearch
// would refuse — its quality service answers `I1` with 400 "Invalid j-encoded
// identifier". Checked against every FamilySearch-shaped person id in the eval
// scenarios, e2e fixtures and person-quality/person-read MCP fixtures
// (2026-09-24): all accepted, none rejected.
//
// Deliberately does NOT trim. `match-engine.ts` tests raw ark segments, and a
// trimming predicate would let a padded segment through as valid where it is
// minted today. A caller that takes user input trims first.

const FS_PERSON_ID_RE = /^[BCDFGHJKLMNPQRSTVWXYZ0-9]{4}-[BCDFGHJKLMNPQRSTVWXYZ0-9]{3}$/;

export function isFamilySearchPersonId(id: string): boolean {
  return FS_PERSON_ID_RE.test(id.toUpperCase());
}
