// Spec: docs/specs/research-query-tool-spec.md §2.7 (`unlinkedParties`).
//
// A two-party assertion ("Father: Thomas Flynn") bears on both people it names,
// and person-evidence links it to each. Linking only the record person is the
// most common miss, and a review that reads the links cannot see it: the page
// shows the one link there is. This names the second person when the TREE says
// who it is, so a review can report the gap without guessing.
//
// Anchored on the tree, not on the assertion alone: most one-party links to a
// two-party assertion are correct because the second person is not in the tree.
// When the tree gives no single reading, nothing is said; a missed note beats a
// wrong name.

import { isLiveAssertion } from "./assertion-liveness.js";
import { preferredName } from "./name-helpers.js";
import { factTypeKey, isCoupleEventFactType, isTwoParty } from "./record-persona.js";
import { relationshipCategory } from "./relationship-category.js";

export interface UnlinkedPartyRow {
  assertionId: string;
  /** The one tree person the assertion is linked to. */
  linkedPersonId: string;
  /** The tree's person in the asserted relation to `linkedPersonId`, with no
   *  live `person_evidence` link to this assertion. */
  unlinkedPersonId: string;
  note: string;
}

const MALE_WORDS = new Set(["father", "son", "husband", "widower"]);
const FEMALE_WORDS = new Set(["mother", "daughter", "wife", "widow"]);

interface Relation {
  /** What the SECOND person is to the linked one: parent, child or spouse. */
  category: "parent" | "child" | "spouse";
  word: string;
  gender?: "male" | "female";
}

const INVERSE: Record<string, Relation["category"]> = { child: "parent", parent: "child", spouse: "spouse" };

function asOther(word: string): Relation | undefined {
  const category = relationshipCategory(word);
  if (category !== "parent" && category !== "child" && category !== "spouse") return undefined;
  const gender = MALE_WORDS.has(word) ? "male" : FEMALE_WORDS.has(word) ? "female" : undefined;
  return { category, word, gender };
}

/** The readings of who the second person is, tried in order; the first that
 *  finds someone in the tree wins. `relationship_type` is the record subject's
 *  OWN role (research-schema-spec.md, "Direction, for `relationship`"), so
 *  `child` makes the second person a parent. Older data spells it the other way
 *  ("Father: Thomas Flynn" as `father`), so that reading is tried second, and
 *  only it carries a gender. A fact_type such as `father_birthplace` names the
 *  second person directly. */
function readingsOf(assertion: any): Relation[] {
  const sv = assertion?.structured_value;
  const rt = sv && typeof sv === "object" && !Array.isArray(sv) ? sv.relationship_type : undefined;
  if (typeof rt === "string" && rt.trim() !== "") {
    const word = rt.toLowerCase().trim().replace(/_inferred$/, "");
    const own = relationshipCategory(word);
    const out: Relation[] = [];
    const inverse = own === undefined ? undefined : INVERSE[own];
    const role = typeof sv.related_person_role === "string" ? sv.related_person_role.toLowerCase().trim() : "";
    const gender = MALE_WORDS.has(role) ? "male" : FEMALE_WORDS.has(role) ? "female" : undefined;
    if (inverse) out.push({ category: inverse, word: gender ? role : inverse, gender });
    const other = asOther(word);
    if (other) out.push(other);
    return out;
  }
  const key = factTypeKey(assertion?.fact_type);
  if (key.startsWith("father")) return [asOther("father")!];
  if (key.startsWith("mother")) return [asOther("mother")!];
  if (key.startsWith("parent") || key === "filiation") return [asOther("parent")!];
  if (key === "spouse" || key === "couple" || key === "marriage" || isCoupleEventFactType(assertion?.fact_type)) {
    return [asOther("spouse")!];
  }
  return [];
}

function candidates(tree: any, persons: Map<string, any>, personId: string, relation: Relation): string[] {
  return relatedIds(tree, personId, relation.category).filter((id) => {
    const g = persons.get(id)?.gender;
    return !relation.gender || typeof g !== "string" || g.toLowerCase() === relation.gender;
  });
}

function relatedIds(tree: any, personId: string, category: Relation["category"]): string[] {
  const out: string[] = [];
  for (const r of Array.isArray(tree?.relationships) ? tree.relationships : []) {
    if (category === "parent" && r?.type === "ParentChild" && r.child === personId && typeof r.parent === "string") {
      out.push(r.parent);
    } else if (category === "child" && r?.type === "ParentChild" && r.parent === personId && typeof r.child === "string") {
      out.push(r.child);
    } else if (category === "spouse" && r?.type === "Couple") {
      if (r.person1 === personId && typeof r.person2 === "string") out.push(r.person2);
      else if (r.person2 === personId && typeof r.person1 === "string") out.push(r.person1);
    }
  }
  return [...new Set(out)].filter((id) => id !== personId);
}

function displayName(person: any): string | undefined {
  const n = preferredName(Array.isArray(person?.names) ? person.names : undefined);
  const s = [n?.given, n?.surname].filter((p) => typeof p === "string" && p.trim() !== "").join(" ");
  return s === "" ? undefined : s;
}

/** Rows for the two-party assertions behind `pageLinks` that are linked to one
 *  tree person while the tree names the other. Links are counted over the whole
 *  project, so a link a filter or a page boundary hid still counts. Pure. */
export function unlinkedPartyRows(research: any, tree: any, pageLinks: any[]): UnlinkedPartyRow[] {
  const allLinks = (Array.isArray(research?.person_evidence) ? research.person_evidence : []).filter(
    (pe: any) => pe?.superseded_by == null && typeof pe?.assertion_id === "string" && typeof pe?.person_id === "string",
  );
  const assertions = new Map<string, any>();
  for (const a of Array.isArray(research?.assertions) ? research.assertions : []) {
    if (typeof a?.id === "string") assertions.set(a.id, a);
  }
  const persons = new Map<string, any>();
  for (const p of Array.isArray(tree?.persons) ? tree.persons : []) {
    if (typeof p?.id === "string") persons.set(p.id, p);
  }

  const rows: UnlinkedPartyRow[] = [];
  const seen = new Set<string>();
  for (const pe of pageLinks) {
    if (pe?.superseded_by != null || typeof pe?.assertion_id !== "string") continue;
    const assertionId: string = pe.assertion_id;
    if (seen.has(assertionId)) continue;
    seen.add(assertionId);

    const a = assertions.get(assertionId);
    if (!a || !isLiveAssertion(a) || !isTwoParty(a.fact_type)) continue;
    const linked = new Set<string>(
      allLinks.filter((l: any) => l.assertion_id === assertionId).map((l: any) => l.person_id as string),
    );
    if (linked.size !== 1) continue;
    const [personId] = linked;
    let relation: Relation | undefined;
    let found: string[] = [];
    for (const r of readingsOf(a)) {
      found = candidates(tree, persons, personId, r);
      if (found.length > 0) {
        relation = r;
        break;
      }
    }
    if (!relation) continue;

    for (const otherId of found) {
      const other = persons.get(otherId);
      const name = displayName(other);
      const value = typeof a.value === "string" && a.value.trim() !== "" ? ` ("${a.value}")` : "";
      rows.push({
        assertionId,
        linkedPersonId: personId,
        unlinkedPersonId: otherId,
        note:
          `Assertion '${assertionId}'${value} names a second person. The tree's ${relation.word} of ` +
          `'${personId}' is '${otherId}'${name ? ` (${name})` : ""}, and '${otherId}' has no ` +
          `person_evidence link to this assertion.`,
      });
    }
  }
  return rows;
}
