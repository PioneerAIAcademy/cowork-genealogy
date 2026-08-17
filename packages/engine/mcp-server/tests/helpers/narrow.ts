/**
 * Narrowing helpers for tool results that are a discriminated union.
 *
 * Several tools return one shape for one op and another for many, or one shape
 * per mode. A test that calls the single form and then reads a single-form
 * property is correct at runtime but does not typecheck, because TypeScript
 * cannot know which branch came back.
 *
 * The wrong fixes are `as any` (throws away the checking we just turned on)
 * and widening the tool's own return type (weakens production code to suit a
 * test). These narrow instead: they assert the discriminant at runtime and
 * return the surviving branch, so a genuinely wrong shape fails the test with
 * a clear message rather than an undefined-property comparison that quietly
 * passes.
 *
 * Introduced when `tsconfig.typecheck.json` brought `tests/` into scope; see
 * that file's header for why nothing checked these before.
 */

function preview(r: unknown): string {
  return JSON.stringify(r).slice(0, 200);
}

/**
 * Narrow a union to the members that do **not** carry `key`.
 *
 * `Exclude` distributes over the union and drops every member assignable to
 * `Record<K, unknown>` — i.e. every member declaring that key.
 */
export function notHaving<T extends object, K extends string>(
  r: T,
  key: K
): Exclude<T, Record<K, unknown>> {
  if (key in r) {
    throw new Error(`expected a result without \`${key}\`, got ${preview(r)}`);
  }
  return r as Exclude<T, Record<K, unknown>>;
}

/**
 * Narrow a union to the member that carries `key`.
 */
export function having<T extends object, K extends string>(
  r: T,
  key: K
): Extract<T, Record<K, unknown>> {
  if (!(key in r)) {
    throw new Error(`expected a result with \`${key}\`, got ${preview(r)}`);
  }
  return r as Extract<T, Record<K, unknown>>;
}

/**
 * Narrow a single-or-batch tool result to its **single** branch. The batch
 * branch is the one carrying `results[]`.
 */
export function single<T extends object>(r: T): Exclude<T, Record<"results", unknown>> {
  return notHaving(r, "results");
}

/** Narrow a single-or-batch tool result to its **batch** branch. */
export function batch<T extends object>(r: T): Extract<T, Record<"results", unknown>> {
  return having(r, "results");
}

/**
 * Narrow a three-way `single | batch | failure` result to its **single-op
 * success** branch — e.g. `ResearchAppendResult`, where `single()` alone still
 * leaves the failure branch in play and so cannot see `entryId`.
 */
export function singleOk<T extends object>(
  r: T
): Exclude<Exclude<T, Record<"errors", unknown>>, Record<"results", unknown>> {
  return single(notHaving(r, "errors"));
}

/**
 * Read `errors` off a result that may or may not be the failure branch,
 * without asserting which it is.
 *
 * Use this where the test expects **success** and is checking that no errors
 * were reported (`expect(errorsOf(r) ?? []).toEqual([])`). `failure()` is
 * wrong there — it throws on the success it was given, turning a passing
 * assertion into a crash.
 */
export function errorsOf(r: object): string[] | undefined {
  return "errors" in r ? (r as { errors?: string[] }).errors : undefined;
}

/**
 * Narrow a result union to its failure branch (the one carrying `errors`).
 * Only for tests that expect a failure — see `errorsOf` for the other case.
 */
export function failure<T extends object>(r: T): Extract<T, Record<"errors", unknown>> {
  return having(r, "errors");
}
