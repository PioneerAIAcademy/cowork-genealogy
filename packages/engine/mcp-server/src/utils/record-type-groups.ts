/**
 * The record-type group vocabulary for `volume_search`.
 *
 * FamilySearch's RMS group-search endpoint filters by record type through
 * `coverage.recordTypeConceptIds`, applying **hierarchy containment** — an
 * ancestor concept id matches its whole subtree — and OR-ing the array. So a
 * group needs only its *anchor* id; the API expands the subtree server-side.
 *
 * Some ids belong to a group editorially while the taxonomy files them
 * elsewhere, outside the anchor's subtree. Those are `strays`, sent alongside
 * the anchor because containment cannot reach them. Dropping one is silent and
 * expensive: Baptism's `127575` alone accounts for ~208k volumes.
 *
 * `parent` is not sent upstream, but it is not decoration either: `descendantsOf`
 * walks it to decide whose strays go into the request, so re-parenting a row
 * changes what the tool asks for. Pointing Prison at Legal drops its three
 * strays from a `Government` search. Change a parent only with the `tree` probe
 * output in hand.
 *
 * The contract, the evidence and the decisions behind every row are in
 * docs/specs/volume-search-tool-spec.md § "Record-type filtering". This table
 * and that document's group/strays tables must agree;
 * tests/packaging/record-type-group-drift.test.ts parses those tables and
 * compares them to this one, so a mis-transcription fails a test rather than
 * silently narrowing a search.
 */

export interface RecordTypeGroup {
  /** The enum literal callers pass in `recordTypeGroups`. Case-sensitive. */
  readonly name: string;
  /** Concept id whose subtree covers the group. */
  readonly anchor: number;
  /** Group whose subtree contains this one, or null for a taxonomy root. */
  readonly parent: string | null;
  /** Ids belonging to this group but outside the anchor's subtree. */
  readonly strays?: readonly number[];
}

/**
 * The single source of truth. Everything in this module is derived from it, and
 * the companion probe imports it rather than keeping its own list — an earlier
 * version did, and reported full corpus reach for a vocabulary that did not ship.
 */
export const RECORD_TYPE_GROUP_TABLE: readonly RecordTypeGroup[] = [
  { name: "Genealogies", anchor: 123682, parent: null },
  { name: "Biography", anchor: 122921, parent: "Genealogies" },
  { name: "Vital", anchor: 124443, parent: null },
  { name: "Birth", anchor: 103979, parent: "Vital" },
  { name: "Death", anchor: 104898, parent: "Vital", strays: [122911] },
  { name: "Cemetery", anchor: 104497, parent: "Death" },
  { name: "Marriage", anchor: 104727, parent: "Vital" },
  { name: "Divorce", anchor: 104832, parent: "Vital" },
  { name: "Religious", anchor: 123402, parent: null },
  { name: "Baptism", anchor: 103612, parent: "Religious", strays: [127575] },
  { name: "Religious Death", anchor: 127576, parent: "Religious", strays: [127739] },
  { name: "Religious Marriage", anchor: 127577, parent: "Religious" },
  { name: "Confirmation", anchor: 101655, parent: "Religious" },
  { name: "Military", anchor: 124133, parent: null },
  { name: "Military Pensions", anchor: 127621, parent: "Military" },
  { name: "Draft", anchor: 104808, parent: "Military" },
  { name: "Migration", anchor: 127023, parent: null },
  { name: "Emigration", anchor: 123632, parent: "Migration", strays: [131602] },
  { name: "Naturalization", anchor: 124162, parent: "Migration" },
  { name: "Census", anchor: 123363, parent: null, strays: [104611] },
  { name: "Legal", anchor: 122797, parent: null },
  { name: "Court", anchor: 127010, parent: "Legal", strays: [127571] },
  { name: "Probate", anchor: 124277, parent: "Court" },
  { name: "Guardianship", anchor: 123769, parent: "Probate" },
  { name: "Wills", anchor: 124457, parent: "Legal", strays: [127073, 129547] },
  { name: "Land", anchor: 127026, parent: "Legal" },
  { name: "Enslavement", anchor: 126864, parent: "Land" },
  { name: "Notarial", anchor: 100599, parent: "Legal" },
  { name: "Government", anchor: 126517, parent: null },
  { name: "ID documents", anchor: 126546, parent: "Government", strays: [129962, 129964] },
  { name: "Passports", anchor: 124216, parent: "ID documents", strays: [124432, 124442, 131572] },
  { name: "Foreigner", anchor: 131588, parent: "Government" },
  { name: "Tax", anchor: 124410, parent: "Government", strays: [129065] },
  { name: "Wartime", anchor: 130090, parent: "Government" },
  { name: "Poor Law", anchor: 126768, parent: "Government" },
  { name: "Prison", anchor: 123478, parent: "Government", strays: [131448, 130086, 126416] },
  { name: "Government Pensions", anchor: 124227, parent: "Government", strays: [126869, 124383, 127027] },
  { name: "Indigenous", anchor: 130717, parent: "Government" },
  { name: "Voting", anchor: 127015, parent: null },
  { name: "School", anchor: 124365, parent: null },
  { name: "Business", anchor: 126340, parent: null },
  { name: "Reference", anchor: 126808, parent: null },
  { name: "Medical", anchor: 127076, parent: null },
  { name: "Photographs", anchor: 122956, parent: null },
  { name: "Miscellaneous", anchor: 124078, parent: null },
  { name: "Administrative", anchor: 135784, parent: null },
  { name: "Newspapers", anchor: 124231, parent: null },
];

/** Group names, for the tool schema's `enum`. */
export const RECORD_TYPE_GROUP_NAMES: readonly string[] =
  RECORD_TYPE_GROUP_TABLE.map((g) => g.name);

/** Name -> group, for validation and expansion. */
export const RECORD_TYPE_GROUPS: ReadonlyMap<string, RecordTypeGroup> = new Map(
  RECORD_TYPE_GROUP_TABLE.map((g) => [g.name, g])
);

/**
 * Parent name -> its immediate children, built once at module load so
 * `descendantsOf` costs the size of the subtree rather than a full table scan.
 */
const CHILDREN: ReadonlyMap<string, readonly RecordTypeGroup[]> = (() => {
  const index = new Map<string, RecordTypeGroup[]>();
  for (const group of RECORD_TYPE_GROUP_TABLE) {
    if (group.parent === null) continue;
    const siblings = index.get(group.parent);
    if (siblings) siblings.push(group);
    else index.set(group.parent, [group]);
  }
  return index;
})();

/**
 * Every group nested beneath `name`, at any depth.
 *
 * Breadth-first over `CHILDREN`, refusing to visit a name twice. A
 * mis-transcribed `parent` — two rows naming each other — would otherwise spin
 * here forever, and it would do so *before* the request is built, so
 * `fetchWithTimeout` never gets the chance to bound it. Throwing names the row.
 *
 * The visited check is the first thing done to every node, which is what makes
 * the guard hold for a group inside the cycle as well as one reaching it from
 * outside — the swapped-adjacent-rows case a hand edit most easily produces.
 *
 * A cycle elsewhere in the table is not reachable from here, so it is
 * `assertAcyclicTable` — not this guard — that checks all 47 chains.
 */
function descendantsOf(name: string): RecordTypeGroup[] {
  const out: RecordTypeGroup[] = [];
  const seen = new Set<string>([name]);
  const queue: RecordTypeGroup[] = [...(CHILDREN.get(name) ?? [])];
  while (queue.length > 0) {
    const group = queue.shift() as RecordTypeGroup;
    if (seen.has(group.name)) {
      throw new Error(
        `Cyclic parent chain in the record-type group table at "${group.name}". ` +
          `Every group's parent chain must end at a root.`
      );
    }
    seen.add(group.name);
    out.push(group);
    const children = CHILDREN.get(group.name);
    if (children) queue.push(...children);
  }
  return out;
}

/**
 * Every group's parent chain terminates at a root.
 *
 * Exported for the drift test. `descendantsOf` only notices a cycle it walks
 * into, so a corrupt row nowhere near the queried group would go unreported at
 * runtime; this checks the whole table at once and is what fails in CI.
 */
export function assertAcyclicTable(): void {
  for (const group of RECORD_TYPE_GROUP_TABLE) {
    const seen = new Set<string>([group.name]);
    let parent = group.parent;
    while (parent !== null) {
      if (seen.has(parent)) {
        throw new Error(
          `Cyclic parent chain in the record-type group table at "${parent}" ` +
            `(reached from "${group.name}"). Every group's parent chain must end at a root.`
        );
      }
      seen.add(parent);
      parent = RECORD_TYPE_GROUPS.get(parent)?.parent ?? null;
    }
  }
}

/**
 * Throw unless every name is a known group, listing all the bad ones.
 *
 * One template, called by `volume_search`'s `validate()` and by
 * `conceptIdsForGroups` below, so the tool's error and its backstop cannot word
 * the same failure differently. Non-string entries are rendered rather than
 * joined raw: `["Tax", null].join(", ")` coerces `null` to an empty string, so
 * the one entry actually wrong would be invisible in the message.
 */
export function assertKnownGroupNames(names: readonly unknown[]): void {
  const unknown = names.filter(
    (name) => typeof name !== "string" || !RECORD_TYPE_GROUPS.has(name)
  );
  if (unknown.length === 0) return;
  const named = unknown.map((name) =>
    typeof name === "string" ? name : JSON.stringify(name) ?? String(name)
  );
  throw new Error(
    `Unknown record-type group(s): ${named.join(", ")}. Valid groups: ` +
      RECORD_TYPE_GROUP_NAMES.join(", ") +
      "."
  );
}

/**
 * The concept ids to send for a set of group names: each group's anchor and
 * strays, **plus the strays of every group nested beneath it**.
 *
 * The descendants' *anchors* are deliberately not included — upstream hierarchy
 * containment already returns them. Their *strays* are a different matter: a
 * stray sits outside its own anchor's subtree, and often outside the parent's
 * too, so containment cannot reach it from either. Prison's `130086` and
 * `126416` are filed under Legal; Tax's `129065` under Census; Passports'
 * `124432`/`124442`/`131572` under Migration.
 *
 * Without this, selecting `Government` returned strictly fewer prison volumes
 * than selecting `Prison` — broadening a search lost results, silently, while
 * the tool description promised the opposite.
 *
 * Unknown names throw, in the same shape `volume_search`'s `validate()` uses, so
 * whichever guard fires the caller reads one message. `validate()` reports every
 * bad name at once and is the path a tool call takes; this is the backstop for a
 * future caller that skips it, which would otherwise get a silently wider search
 * — the failure this vocabulary exists to prevent.
 */
export function conceptIdsForGroups(names: readonly string[]): number[] {
  assertKnownGroupNames(names);
  const ids = new Set<number>();
  for (const name of names) {
    const group = RECORD_TYPE_GROUPS.get(name) as RecordTypeGroup;
    ids.add(group.anchor);
    for (const stray of group.strays ?? []) ids.add(stray);
    for (const descendant of descendantsOf(name)) {
      for (const stray of descendant.strays ?? []) ids.add(stray);
    }
  }
  // Sorted, so the same set of groups produces the same request body whatever
  // order the caller listed them in. The API ORs the array either way, but a
  // body that varies by argument order is harder to compare between runs.
  return [...ids].sort((a, b) => a - b);
}
