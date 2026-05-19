/**
 * Pure helpers for the trace view's per-MCP-call expected/actual table.
 *
 * Match semantics mirror `eval/harness/harness/fixtures.py::matches` so a
 * fixture predicate that fires in the Python dispatcher also displays as
 * a "match" in the TS UI. Shared test vectors keep the two implementations
 * honest — see eval/app/tests/unit/argTable.test.ts.
 */

export type ArgMatch =
  | { kind: 'match' }
  | { kind: 'mismatch' }
  | { kind: 'actual-missing' }
  | { kind: 'extra' };

/** Walk a dotted path through a nested object; return undefined if absent.
 *  Strips the optional `args.` prefix to mirror the Python `removeprefix`. */
export function getAtPath(obj: Record<string, unknown>, dottedPath: string): unknown {
  const path = dottedPath.startsWith('args.') ? dottedPath.slice(5) : dottedPath;
  let cursor: unknown = obj;
  for (const part of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
    if (cursor === undefined) return undefined;
  }
  return cursor;
}

/**
 * Mirror of harness.fixtures.matches for a single key/value pair.
 * String values prefixed with `~` are case-insensitive substring matches;
 * everything else is exact equality.
 */
export function argMatches(expected: unknown, actual: unknown): boolean {
  if (typeof expected === 'string' && expected.startsWith('~')) {
    const needle = expected.slice(1).toLowerCase();
    return String(actual ?? '').toLowerCase().includes(needle);
  }
  return expected === actual;
}

export function formatArgValue(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

export interface ArgTableRow {
  key: string;
  rawKey: string;
  status: ArgMatch;
  expected: unknown;
  actual: unknown;
}

/**
 * Compute the rows for the per-param table. Every key the fixture
 * declared appears as a row (match / mismatch / actual-missing); every
 * arg Claude passed that the fixture didn't declare appears as an
 * "extra" row.
 *
 * When `expected` is null (no fixture matched), every actual arg is
 * surfaced as "extra" — fixture_not_found case.
 */
export function buildArgTableRows(
  expected: Record<string, unknown> | null,
  actual: Record<string, unknown>,
): ArgTableRow[] {
  const expectedEntries = expected ? Object.entries(expected) : [];
  const expectedDisplayKeys = new Set(
    expectedEntries.map(([k]) => (k.startsWith('args.') ? k.slice(5) : k)),
  );

  const rows: ArgTableRow[] = [];

  for (const [rawKey, expVal] of expectedEntries) {
    const displayKey = rawKey.startsWith('args.') ? rawKey.slice(5) : rawKey;
    const actVal = getAtPath(actual, rawKey);
    if (actVal === undefined) {
      rows.push({ key: displayKey, rawKey, status: { kind: 'actual-missing' }, expected: expVal, actual: actVal });
    } else if (argMatches(expVal, actVal)) {
      rows.push({ key: displayKey, rawKey, status: { kind: 'match' }, expected: expVal, actual: actVal });
    } else {
      rows.push({ key: displayKey, rawKey, status: { kind: 'mismatch' }, expected: expVal, actual: actVal });
    }
  }
  for (const [k, v] of Object.entries(actual)) {
    if (expectedDisplayKeys.has(k)) continue;
    rows.push({ key: k, rawKey: k, status: { kind: 'extra' }, expected: undefined, actual: v });
  }

  return rows;
}
