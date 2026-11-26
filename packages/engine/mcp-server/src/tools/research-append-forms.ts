// The two input forms research_append accepts beside its canonical batch, and
// their conversion into that batch. Haiku miscounts closing brackets when it
// writes ops whose payload sits one level down in `entry`/`fields`, and when a
// long batch repeats `section`/`op`/`planId` on every item (issue #4866). So:
//
// - A flat op carries its payload beside `section` and `op`. It becomes the
//   canonical op with that payload under `entry` (append) or `fields` (update).
// - The plan form, `plan` + `planItems`, is one new plan and its items. It
//   becomes a `plans` append followed by one `plan_items` append per item,
//   each item carrying PLAN_FORM_PLAN_ID until the caller resolves it to the
//   id the plan is about to get.
//
// Everything after the conversion — validation, the all-or-nothing write, the
// refusals — is the canonical batch's. Mirrored in the plugin hook
// (`guard_project_files.py`, `_ops`) and the eval validators
// (`validators_lib.research_append_ops`); change all three together.

import type { ResearchAppendOp } from "./research-append.js";

/** The keys a canonical op carries. Any other key on an op is its payload. */
export const OP_KEYS: ReadonlySet<string> = new Set([
  "section",
  "op",
  "entry",
  "entryId",
  "fields",
  "edits",
  "guideSection",
  "surveyRef",
  "planId",
]);

/** The call's own arguments. Sent on an op they were never read and still are
 *  not: they stay on the op, never moved into its payload. */
export const CALL_KEYS: ReadonlySet<string> = new Set([
  "projectPath",
  "resolveStandardPlace",
  "sourceDescription",
  "verdict",
]);

/** Stands in for the new plan's id on the plan form's items until the tool has
 *  read research.json. Not a valid `pl_` id, so it can never match a plan. */
export const PLAN_FORM_PLAN_ID = "<plan form: the new plan>";

/** `op` in canonical form, or an error naming what is ambiguous. An op with no
 *  payload keys, an op that is not an object, and an op whose `op` is neither
 *  append nor update come back unchanged for the canonical checks to judge. */
export function canonicalOp(op: unknown): { op: unknown; error?: string } {
  if (!op || typeof op !== "object" || Array.isArray(op)) return { op };
  const record = op as Record<string, unknown>;
  const stays = (k: string) => OP_KEYS.has(k) || CALL_KEYS.has(k);
  const loose = Object.keys(record).filter((k) => !stays(k));
  if (loose.length === 0) return { op };
  const kind = record.op;
  const wrapper = kind === "append" ? "entry" : kind === "update" ? "fields" : null;
  if (wrapper === null) return { op };
  if (wrapper in record) {
    return {
      op,
      error:
        `carries both \`${wrapper}\` and fields beside it (${loose.join(", ")}). ` +
        `Put the ${kind === "append" ? "entry's" : "changed"} fields either directly on the op or inside \`${wrapper}\`, not both.`,
    };
  }
  const out: Record<string, unknown> = {};
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (stays(k)) out[k] = v;
    else payload[k] = v;
  }
  out[wrapper] = payload;
  return { op: out };
}

/** Every op in canonical form, plus `ops[i]: …` errors for the ambiguous ones. */
export function canonicalOps(ops: unknown[]): { ops: unknown[]; errors: string[] } {
  const errors: string[] = [];
  const out = ops.map((op, i) => {
    const r = canonicalOp(op);
    if (r.error) errors.push(`ops[${i}]: ${r.error}`);
    return r.op;
  });
  return { ops: out, errors };
}

/** True when the call uses the plan form. */
export function isPlanForm(input: { plan?: unknown; planItems?: unknown }): boolean {
  return input.plan !== undefined || input.planItems !== undefined;
}

/** Why the plan form cannot be converted, or null. `plan` is an object,
 *  `planItems` an array of objects, and neither `ops` nor `section` is sent. */
export function planFormError(input: {
  plan?: unknown;
  planItems?: unknown;
  ops?: unknown;
  section?: unknown;
}): string | null {
  if (input.ops !== undefined || input.section !== undefined) {
    return "pass a new plan as `plan` + `planItems`, a batch as `ops`, or one op as `section` + `op`: one of the three, not several.";
  }
  if (!input.plan || typeof input.plan !== "object" || Array.isArray(input.plan)) {
    return "`plan` must be the new plan's entry (an object with question_id, status and created), sent with `planItems`.";
  }
  if (!Array.isArray(input.planItems)) {
    return "`planItems` must be an array of the new plan's items, each a plan_items entry, in sequence order.";
  }
  const bad = input.planItems.findIndex((it) => !it || typeof it !== "object" || Array.isArray(it));
  if (bad !== -1) return `planItems[${bad}] must be an object: one plan_items entry.`;
  return null;
}

/** The plan form as the canonical batch: the `plans` append, then one
 *  `plan_items` append per item, each under PLAN_FORM_PLAN_ID. */
export function planFormOps(plan: Record<string, unknown>, planItems: Record<string, unknown>[]): ResearchAppendOp[] {
  return [
    { section: "plans", op: "append", entry: plan },
    ...planItems.map(
      (item): ResearchAppendOp => ({ section: "plan_items", op: "append", planId: PLAN_FORM_PLAN_ID, entry: item }),
    ),
  ];
}

/** Gives the plan form's items the id their plan is about to get. */
export function resolvePlanFormPlanId(ops: unknown, planId: string): void {
  if (!Array.isArray(ops)) return;
  for (const op of ops as ResearchAppendOp[]) {
    if (op && op.planId === PLAN_FORM_PLAN_ID) op.planId = planId;
  }
}

/** An error from the canonical batch, re-addressed to the plan form the caller
 *  sent: `ops[0]` is `plan`, `ops[k]` is `planItems[k-1]`. */
export function planFormMessage(message: string): string {
  return message.replace(/^ops\[(\d+)\]/, (_m, i: string) => (i === "0" ? "plan" : `planItems[${Number(i) - 1}]`));
}
