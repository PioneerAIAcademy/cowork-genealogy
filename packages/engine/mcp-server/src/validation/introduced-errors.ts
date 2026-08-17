/**
 * Block a writer tool only on the validation errors its own call INTRODUCED,
 * letting pre-existing schema drift ride along as a warning instead of freezing
 * the whole project. Issue #1572: a research.json written in a legacy shape
 * (person_id/notes on assertions, author/record_id/title on sources,
 * resolution_notes on conflicts) fails `validateParsed`, and because every
 * writer validates the WHOLE document, one drifted section blocked all nine
 * writing tools — even a call that never touched it.
 *
 * The design (issue #1572, "Option 1"): validate the pre-call snapshot too and
 * subtract its errors from the post-call errors; only what is left is this
 * call's fault. Prevention (stopping the writes that create drift) is the real
 * fix and is handled elsewhere — this is the tolerance layer for projects that
 * already carry legacy drift.
 *
 * The load-bearing detail is that a naive `{path, message}` diff is wrong: a
 * validation error's `path` carries an array index (`.../sources[3]`,
 * `persons[5]`), and the tree/merge/forget tools reindex arrays with `.filter`,
 * so a pre-existing error at `persons[7]` becomes `persons[6]` after a removal
 * and a naive diff reports it as new — the exact false-deny this fix exists to
 * kill. So the diff keys on the drifted object's stable `id` (src_/a_/c_ on
 * research objects, `.id` on tree persons/relationships/sources), resolved from
 * the before/after documents, which survives reindexing without index math.
 *
 * "Keep it simple" (Dallan, 2026-08-14): array elements with no `.id` keep
 * their raw index. A pre-existing id-less error at an UNCHANGED index still
 * matches across before/after and is demoted (tolerated); only an id-less
 * element that *reindexes* reads as introduced and would block. None of the nine
 * writer tools reindex an id-less array, and all six known drift keys sit on
 * id-bearing objects, so that residual false-block is theoretical — the
 * tolerance is real for the cases that occur.
 *
 * Caller contract: a tool that mutates a document IN PLACE must pass a
 * pre-mutation deep clone (`structuredClone`) as `before` — never the same
 * reference it passes as `after`, which would make the diff empty and silently
 * demote every error the call actually introduced in that document. Tools that
 * never mutate a given document may pass the same reference for it.
 */

import { validateParsed } from "./validator.js";
import type { ValidationError, ValidationResult, ValidationWarning } from "./types.js";

/** The two persisted documents a writer validates together. */
export interface ProjectState {
  research: unknown;
  tree: unknown;
}

/**
 * Rewrite an error `path` so it is stable across array reindexing: each
 * `key[index]` segment becomes `key[id=<element.id>]` when the element at that
 * index carries a string `.id`, walking `doc` alongside the path so nested
 * arrays resolve too. Segments without a resolvable id keep their raw index.
 */
function normalizePath(path: string, research: unknown, tree: unknown): string {
  const segments = path.split("/");
  const root = segments[0];
  let node: any = root === "tree.gedcomx.json" ? tree : research;
  const out: string[] = [root];

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const m = seg.match(/^(.+)\[(\d+)\]$/);
    if (m && node && typeof node === "object") {
      const key = m[1];
      const idx = Number(m[2]);
      const arr = (node as any)[key];
      const el = Array.isArray(arr) ? arr[idx] : undefined;
      if (el && typeof el === "object" && typeof el.id === "string") {
        out.push(`${key}[id=${el.id}]`);
      } else {
        out.push(seg);
      }
      node = el;
    } else {
      node = node && typeof node === "object" ? (node as any)[seg] : undefined;
      out.push(seg);
    }
  }

  return out.join("/");
}

/** Identity of a validation error for the before/after diff: its
 *  reindex-stable path plus its message (which names the offending field). */
function errorKey(e: ValidationError, research: unknown, tree: unknown): string {
  return `${normalizePath(e.path, research, tree)} ${e.message}`;
}

/**
 * Validate `after`, then demote to warnings every error that was already
 * present in `before`, so the returned result blocks only on errors this call
 * introduced.
 *
 * Both passes run with the caller's `options`, so the sidecar and cross-file
 * checks run on the before-snapshot too: a pre-existing sidecar / dangling
 * results-ref / D5 error is then present in `before` and demoted, not read as
 * new and blocked. Omitting `projectPath` on the before-pass would re-freeze
 * exactly that class of pre-existing drift — the bug #1572 exists to kill
 * (validate-project-refactor-spec §5 rules on it: omitting `projectPath` is
 * right only for a caller with no project directory, and this one always has
 * one; the same section shows the sidecar pass is invariant under a merge, so
 * before and after agree on pre-existing sidecar state). A project with no
 * pre-existing drift produces an empty `before` error set, so the result is
 * byte-identical to calling `validateParsed(after, options)` directly.
 */
export async function validateIntroduced(
  before: ProjectState,
  after: ProjectState,
  options?: { projectPath?: string },
): Promise<ValidationResult> {
  const [beforeRes, afterRes] = await Promise.all([
    validateParsed(before.research, before.tree, options),
    validateParsed(after.research, after.tree, options),
  ]);

  const preExistingKeys = new Set(
    beforeRes.errors.map((e) => errorKey(e, before.research, before.tree)),
  );

  const introduced: ValidationError[] = [];
  let preExistingCount = 0;
  for (const e of afterRes.errors) {
    if (preExistingKeys.has(errorKey(e, after.research, after.tree))) {
      preExistingCount++;
    } else {
      introduced.push(e);
    }
  }

  // One summary line, not one warning per demoted error. A drifted project can
  // carry dozens (the #1476 census was 45 over one call), and a wall of them on
  // the SUCCESS path buries the warnings the agent must act on — retention gaps,
  // place-resolution misses, sanitize notes. This is also #1572's asked-for
  // "N pre-existing schema errors" wording, without the wall.
  const preExisting: ValidationWarning[] =
    preExistingCount > 0
      ? [
          {
            path: "",
            message:
              `this project has ${preExistingCount} pre-existing schema error(s) ` +
              `not caused by this call; run validate_research_schema for the list`,
          },
        ]
      : [];

  return {
    valid: introduced.length === 0,
    errors: introduced,
    warnings: [...afterRes.warnings, ...preExisting],
  };
}
