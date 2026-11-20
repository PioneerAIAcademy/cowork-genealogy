/**
 * The record the objective asks for leads the plan (issue #2030, lead decision
 * 2026-08-31; tracked under issue #2475).
 *
 * When `project.objective` names a target record ("baptism record", "death
 * certificate", "1851 census") AND the place of that event ("born ... in
 * Kongsberg"), the first question's plan must not sequence that record behind
 * other work, and must not make it a `fallback_for` an item that is not itself
 * the target. The submitted session behind feedback #1945 put the Kongsberg
 * baptism at sequence 6 of 11, ran item 1 only, and spent 3h18m in Trysil
 * burial images.
 *
 * The rule stays SILENT when no item in the plan targets that record at that
 * place, so a misparsed objective can never refuse: the place it picked matches
 * no item. Measured before merging, as the ruling requires
 * (`dev/measure-objective-target-lead.ts`): over the 241
 * model-written plans in the e2e corpus it applies to 1 and refuses 0.
 */

export type TargetEvent = "baptism" | "marriage" | "death" | "burial" | "census";

export interface ObjectiveTarget {
  event: TargetEvent;
  /** The most specific word of the event's place, case- and accent-folded. */
  place: string;
  /** Places the objective ties to a DIFFERENT event (the death place of a
   *  baptism objective). An item naming one of them is not the target. */
  otherPlaces: string[];
}

const RECORD_NOUN: [RegExp, TargetEvent][] = [
  [/\b(?:baptism|baptismal|christening)\s+(?:record|register|entr)/i, "baptism"],
  [/\bbirth\s+(?:record|register|certificate|entr)/i, "baptism"],
  [/\bmarriage\s+(?:record|register|certificate|bond|licen[cs]e|entr)/i, "marriage"],
  [/\bdeath\s+(?:record|register|certificate|entr)/i, "death"],
  [/\bburial\s+(?:record|register|entr)/i, "burial"],
  [/\bcensus\b/i, "census"],
];

const EVENT_VERB: Record<TargetEvent, string> = {
  baptism: "born|baptized|baptised|christened",
  marriage: "married",
  death: "died",
  burial: "buried",
  census: "census",
};

/** The `record_type` values a plan item for each event can carry. The field is
 *  coarse (`church` covers a baptism and a burial alike), so the place is what
 *  tells the target from the item that buried it. */
const RECORD_TYPES: Record<TargetEvent, ReadonlySet<string>> = {
  baptism: new Set(["church", "vital_record", "vital"]),
  marriage: new Set(["church", "vital_record", "vital", "marriage"]),
  death: new Set(["church", "vital_record", "vital", "cemetery", "probate", "newspaper"]),
  burial: new Set(["church", "cemetery", "vital_record", "vital"]),
  census: new Set(["census"]),
};

function fold(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The first capitalised word after `in`/`at` (`of` too for a census) in the
 *  clause following the event's own verb, stopping at another event's verb.
 *  `of` is excluded otherwise because it usually introduces a person ("the baptism record of Hoval Hansen"). */
function eventPlace(objective: string, event: TargetEvent): string | null {
  const preps = event === "census" ? "in|at|of" : "in|at";
  const others = (Object.keys(EVENT_VERB) as TargetEvent[])
    .filter((e) => e !== event)
    .map((e) => EVENT_VERB[e])
    .join("|");
  const rx = new RegExp(
    `\\b(?:${EVENT_VERB[event]})\\b(?:(?!\\b(?:${others})\\b)[^.;?])*?\\b(?:${preps})\\s+(?:the\\s+)?(?:city\\s+of\\s+|parish\\s+of\\s+)?(\\p{Lu}[\\p{L}'’\\-]*)`,
    "giu",
  );
  for (const m of objective.matchAll(rx)) {
    const word = m[1];
    if (!/^\p{Lu}/u.test(word)) continue;
    const w = fold(word);
    if (w.length > 2) return w;
  }
  return null;
}

/** The objective's target record and place, or null when it names either not
 *  at all. */
export function objectiveTarget(objective: unknown): ObjectiveTarget | null {
  if (typeof objective !== "string" || !objective.trim()) return null;
  const hit = RECORD_NOUN.find(([rx]) => rx.test(objective));
  if (!hit) return null;
  const event = hit[1];
  const place = eventPlace(objective, event);
  if (!place) return null;
  const otherPlaces = (Object.keys(EVENT_VERB) as TargetEvent[])
    .filter((e) => e !== event)
    .map((e) => eventPlace(objective, e))
    .filter((p): p is string => p !== null && p !== place);
  return { event, place, otherPlaces: [...new Set(otherPlaces)] };
}

/** Whether one plan item searches the objective's target record at its place. */
export function targetsObjective(item: any, t: ObjectiveTarget): boolean {
  const j = fold(String(item?.jurisdiction ?? ""));
  return (
    j.includes(t.place) &&
    !t.otherPlaces.some((o) => j.includes(o)) &&
    RECORD_TYPES[t.event].has(String(item?.record_type ?? ""))
  );
}

const seqOf = (i: any) => (typeof i?.sequence === "number" ? i.sequence : Number.MAX_SAFE_INTEGER);

/** Why this plan buries the objective's target, or null when it does not (or
 *  when no item targets it). The message names the way out, as the ruling
 *  requires. */
export function objectiveTargetLeadError(plan: any, t: ObjectiveTarget): string | null {
  const items = (Array.isArray(plan?.items) ? plan.items : []).filter((i: any) => i && typeof i === "object");
  if (items.length === 0) return null;
  const ordered = [...items].sort((a: any, b: any) => seqOf(a) - seqOf(b));
  const first = ordered.find((i: any) => targetsObjective(i, t));
  if (!first) return null;
  const parent = items.find((i: any) => i.id === first.fallback_for);
  const leads = first === ordered[0] || seqOf(first) === seqOf(ordered[0]);
  const gated = parent !== undefined && !targetsObjective(parent, t);
  if (leads && !gated) return null;
  const what = `the objective asks for a ${t.event} record and names its place (${t.place})`;
  if (!leads) {
    const ahead = ordered.filter((i: any) => seqOf(i) < seqOf(first));
    return (
      `plan ${plan?.id ?? "(new)"}: ${what}, but ${first.id ?? "its item"} (sequence ${first.sequence}) ` +
      `is sequenced behind ${ahead.map((i: any) => `${i.id ?? "?"} (${i.record_type ?? "?"}, ${i.jurisdiction ?? "?"})`).join(", ")}. ` +
      `Give ${first.id ?? "that item"} sequence 1. If the identity, the place or the record's availability ` +
      `is genuinely uncertain, say so in the objective first; this rule applies only when the objective ` +
      `states both the record and its place.`
    );
  }
  return (
    `plan ${plan?.id ?? "(new)"}: ${what}, but ${first.id ?? "its item"} is a fallback_for ` +
    `${parent.id} (${parent.record_type ?? "?"}, ${parent.jurisdiction ?? "?"}), so it is searched only if ` +
    `that search succeeds. Set its fallback_for to null.`
  );
}

/** Plan fields whose change can move the target: an update touching none of
 *  them (a search agent's status-only write) is never judged. */
export const ORDER_FIELDS = ["sequence", "jurisdiction", "record_type", "fallback_for"] as const;
