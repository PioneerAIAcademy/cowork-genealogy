// The search step's delegations, written out for the router to send as they are.
//
// research/SKILL.md has the router hand each search agent its plan item and the
// subject in a fixed shape (`plan_item:` and `subject:` JSON blocks, with the ids
// on lines of their own). A cheaper router rewrote that shape as prose, dropped
// the subject block, or sent one spawn for two items (Haiku 5.5 low,
// ut_research_fo1, si3, 014, uh1). Everything the delegation holds is in the
// project documents, so the tool writes it (ADR-0011) and the router copies it.

import { awaitingUploadItemIds } from "./awaiting-hand-offs.js";
import { routesToFamilySearch } from "./plan-item-plausibility.js";

/** At most this many search agents run in one step (research/SKILL.md). */
export const MAX_SEARCH_SPAWNS = 4;

/** One search agent to spawn: which agent, and the prompt to send it verbatim. */
export interface SearchDelegation {
  planItemId: string;
  agent: "search-records" | "search-images" | "search-full-text" | "search-hints" | "search-external-sites";
  prompt: string;
}

/** A question that asks about the subject's parentage. Same words as the
 *  research suite's validator (`_ASKS_ABOUT_A_PARENT`). */
const ASKS_ABOUT_A_PARENT = /\b(?:parents?|parentage|father|mother)\b|\b(?:son|daughter|child) of\b/i;

/** The lane research-plan writes into a FamilySearch item's repository:
 *  "FamilySearch (full-text)" or "FamilySearch (images)" (research-plan.md, plan
 *  item fields). Read from the field, never guessed from the rationale's words. */
const FULL_TEXT = /\bfull[- ]text\b/i;
const IMAGES = /\(images\)/i;

/** A FamilySearch person id, as the hints item's rationale names it. */
const FS_PERSON_ID = /\b[A-Z0-9]{4}-[A-Z0-9]{3,4}\b/;

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function agentFor(item: any): SearchDelegation["agent"] {
  if (item?.record_type === "fs_hints") return "search-hints";
  if (!routesToFamilySearch(item)) return "search-external-sites";
  const repository = String(item?.repository ?? "");
  if (FULL_TEXT.test(repository)) return "search-full-text";
  if (IMAGES.test(repository)) return "search-images";
  return "search-records";
}

/** One vital event as the tree holds it: the primary fact of that type, else the first. */
function event(person: any, type: string): { date?: string; place?: string } | undefined {
  const facts = arr(person?.facts).filter((f) => f && typeof f === "object" && f.type === type);
  const fact = facts.find((f) => f.primary === true) ?? facts[0];
  if (!fact) return undefined;
  const out: { date?: string; place?: string } = {};
  const date = str(fact.date) ?? str(fact.standard_date);
  const place = str(fact.place) ?? str(fact.standard_place);
  if (date) out.date = date;
  if (place) out.place = place;
  return Object.keys(out).length > 0 ? out : undefined;
}

function displayName(person: any): string | null {
  const names = arr(person?.names).filter((n) => n && typeof n === "object");
  const n = names.find((x) => x.preferred === true) ?? names[0];
  const parts = [str(n?.given), str(n?.surname)].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * The `subject:` block for a search: the tree's names, birth, death and
 * parents. Parents are left out when the search serves a question about the
 * subject's parentage, and when the tree gives more than two. A given name no
 * linked record carries (`unsupported`) is replaced by its `searchAs` form.
 */
export function subjectBlock(
  tree: any,
  subjectId: string,
  questionText: string,
  unsupported?: { given: string; searchAs: string },
): Record<string, unknown> | null {
  const person = arr(tree?.persons).find((p) => p && typeof p === "object" && p.id === subjectId);
  if (!person) return null;
  const names = arr(person.names)
    .filter((n) => n && typeof n === "object")
    .map((n) => {
      const given = unsupported ? unsupported.searchAs : str(n.given);
      return Object.fromEntries(
        Object.entries({ given, surname: str(n.surname), type: str(n.type) }).filter(([, v]) => v !== null),
      );
    });
  const block: Record<string, unknown> = { subjectId, names };
  const birth = event(person, "Birth");
  const death = event(person, "Death");
  if (birth) block.birth = birth;
  if (death) block.death = death;
  if (!ASKS_ABOUT_A_PARENT.test(questionText)) {
    const parentIds = [
      ...new Set(
        arr(tree?.relationships)
          .filter((r) => r?.type === "ParentChild" && r?.child === subjectId && typeof r?.parent === "string")
          .map((r) => r.parent as string),
      ),
    ];
    if (parentIds.length > 0 && parentIds.length <= 2) {
      block.parents = parentIds.map((id) => {
        const p = arr(tree?.persons).find((x) => x?.id === id);
        return { personId: id, name: displayName(p) ?? id };
      });
    }
  }
  return block;
}

/** The tree source project_create writes first, for the Family Tree read itself. */
const TREE_READ_SOURCE = /^FamilySearch Family Tree \(read from /;

/**
 * The sources attached to the subject on FamilySearch when the project was made:
 * project_create keeps the read's own sources as tree `S2…` and points the
 * person's, names' and facts' refs at them. The Family Tree source itself is
 * left out. A source attached on FamilySearch later is not in the tree.
 */
export function attachedSources(tree: any, subjectId: string): { id: string; title: string }[] {
  const person = arr(tree?.persons).find((p) => p && typeof p === "object" && p.id === subjectId);
  if (!person) return [];
  const refs = new Set<string>();
  const collect = (list: unknown) => {
    for (const s of arr(list)) if (typeof s?.ref === "string") refs.add(s.ref);
  };
  collect(person.sources);
  for (const n of arr(person.names)) collect(n?.sources);
  for (const f of arr(person.facts)) collect(f?.sources);
  return arr(tree?.sources)
    .filter((s) => s && typeof s.id === "string" && refs.has(s.id) && typeof s.title === "string")
    .filter((s) => !TREE_READ_SOURCE.test(s.title))
    .map((s) => ({ id: s.id as string, title: s.title as string }));
}

/** A fallback item runs only after its primary has run and found nothing. */
function fallbackDue(item: any, items: any[], log: any[]): boolean {
  const primaryId = str(item?.fallback_for);
  if (!primaryId) return true;
  const primary = items.find((i) => i?.id === primaryId);
  if (primary && (primary.status === "planned" || primary.status === "in_progress")) return false;
  const entries = log.filter((e) => e?.plan_item_id === primaryId);
  return entries.length > 0 && entries.every((e) => e?.outcome === "negative");
}

/**
 * The delegations for one question's search step: one per open item of its
 * active plan, lowest sequence first, at most `MAX_SEARCH_SPAWNS`. Left out: an
 * item waiting on the researcher's upload, one whose film's image cap is spent
 * (`exhaustedItemIds`), and a fallback whose primary has not come back empty. A
 * hints item at the head of the plan goes alone: its verdicts can save a search.
 */
export function searchDelegations(
  projectPath: string,
  research: any,
  tree: any,
  question: any,
  exhaustedItemIds: ReadonlySet<string>,
  unsupported?: { given: string; searchAs: string },
): SearchDelegation[] {
  const qid = str(question?.id);
  if (!qid) return [];
  const plan = arr(research?.plans).find(
    (p) => p && typeof p === "object" && p.question_id === qid && (p.status === undefined || p.status === "active"),
  );
  if (!plan || !str(plan.id)) return [];
  const items = arr(plan.items).filter((i) => i && typeof i === "object" && str(i.id));
  const log = arr(research?.log);
  const waiting = awaitingUploadItemIds(research?.log);
  const open = items
    .filter((i) => i.status === "planned" || i.status === "in_progress")
    .filter((i) => !waiting.has(i.id) && !exhaustedItemIds.has(i.id) && fallbackDue(i, items, log))
    .sort((a, b) => (Number(a?.sequence) || 0) - (Number(b?.sequence) || 0));
  if (open.length === 0) return [];
  const batch = open[0].record_type === "fs_hints" ? [open[0]] : open.filter((i) => i.record_type !== "fs_hints");
  const subjectId = str(arr(research?.project?.subject_person_ids)[0]);
  const questionText = typeof question?.question === "string" ? question.question : "";
  const subject = subjectId ? subjectBlock(tree, subjectId, questionText, unsupported) : null;
  return batch.slice(0, MAX_SEARCH_SPAWNS).map((item) => {
    const agent = agentFor(item);
    const lines = [`projectPath: ${projectPath}`, `questionId: ${qid}`, `planId: ${plan.id}`, `planItemId: ${item.id}`];
    if (agent === "search-hints") {
      const personId = String(item.rationale ?? "").match(FS_PERSON_ID)?.[0];
      if (personId) lines.push(`personId: ${personId}`);
    }
    lines.push(`plan_item: ${JSON.stringify(item)}`);
    if (subject && (agent === "search-records" || agent === "search-images" || agent === "search-full-text")) {
      lines.push(`subject: ${JSON.stringify(subject)}`);
      if (unsupported) {
        lines.push(
          `The tree's given name "${unsupported.given}" is a reading in doubt: no linked record gives it, ` +
            `so the subject is searched as "${unsupported.searchAs}".`,
        );
      }
    }
    return { planItemId: item.id, agent, prompt: lines.join("\n") };
  });
}
