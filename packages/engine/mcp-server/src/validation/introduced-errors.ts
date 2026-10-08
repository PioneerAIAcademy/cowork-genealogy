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
 * VALIDATES THE SERIALIZED FORM, not the in-memory object. The store persists
 * `JSON.stringify(obj)` (`fs-project-store.ts`), which DROPS a key whose value
 * is `undefined` and turns `NaN` into `null`; `checkRequired` tests `field in
 * obj`, which `{field: undefined}` satisfies. So without this, a writer could
 * report `valid: true` on an object that fails the moment it is read back — and
 * from then on every later call would count that error as pre-existing, i.e. as
 * somebody else's. Both documents are round-tripped, and the round-tripped
 * objects are what `errorKey`/`normalizePath` see too, so paths and messages
 * come from the same objects that were validated.
 *
 * `structuredClone` preserves `undefined` and `NaN`, so the caller's snapshot
 * carries them in; the round-trip has to happen here.
 *
 * It also REMOVES one error class: an `undefined`-valued key outside the
 * allow-list raises `unexpected property '…'` today and nothing afterwards.
 * That is intended — the key never reaches disk.
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

/** The document as the store will persist it.
 *
 *  Never throws, because `validateIntroduced` never throws today and its
 *  callers rely on that: in `research-log-append.ts` a throw here would skip
 *  `cleanupSidecars` and orphan a sidecar `applyLogAppendOp` already finalized
 *  — "an orphan the next validate_research_schema hard-fails on, with no
 *  recovery" (that file's own comment).
 *
 *  `JSON.stringify` throws on a circular reference or a BigInt, and
 *  `JSON.parse(undefined)` is a SyntaxError. None is reachable — every call
 *  site passes both documents, derived from `readProjectJson` (which
 *  `JSON.parse`s) or `sanitizeTree` (which clones and deletes, never assigns
 *  `undefined`), and there is no BigInt in src/ — but "it cannot happen" is the
 *  claim a reviewer checks, so the catch is here and the unit suite pins it.
 *
 *  The catch is the WHOLE guard. An earlier draft also had an
 *  `if (x === undefined) return x` fast path; it was removed because the catch
 *  already produces the identical result (`JSON.parse(undefined)` throws, the
 *  catch returns the original), so no test could distinguish its presence from
 *  its absence — a line that cannot fail reads as coverage.
 *
 *  Falling back to the original is the right failure mode: the class this
 *  closes is serializable by definition, so it never routes through the catch,
 *  and a genuinely unserializable document still fails in the store's
 *  `serialize` exactly as it does today. */
function persistedForm(x: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(x));
  } catch {
    return x;
  }
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
  // Four separate applications, not a ProjectState-shaped wrapper: each site
  // is independently revertible, and the unit suite names the test that reds
  // for each. `before.tree` is the one with no other cover — research_log_append
  // passes the SAME tree reference as both before and after, so leaving that
  // one un-round-tripped makes every call on a tree-drifted project hard-fail
  // on an error it did not introduce.
  const beforeState: ProjectState = {
    research: persistedForm(before.research),
    tree: persistedForm(before.tree),
  };
  const afterState: ProjectState = {
    research: persistedForm(after.research),
    tree: persistedForm(after.tree),
  };

  const [beforeRes, afterRes] = await Promise.all([
    validateParsed(beforeState.research, beforeState.tree, options),
    validateParsed(afterState.research, afterState.tree, options),
  ]);

  const preExistingKeys = new Set(
    beforeRes.errors.map((e) => errorKey(e, beforeState.research, beforeState.tree)),
  );

  const introduced: ValidationError[] = [];
  let preExistingCount = 0;
  for (const e of afterRes.errors) {
    if (preExistingKeys.has(errorKey(e, afterState.research, afterState.tree))) {
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
