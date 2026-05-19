/**
 * Tests for lib/argTable — the pure helpers behind the trace view's
 * per-MCP-call expected/actual table. The contract is parity with
 * `harness.fixtures.matches` in Python; mismatches surface fixture-side
 * behavior differing from the UI's reading of it.
 */

import { describe, expect, test } from 'vitest';
import {
  argMatches,
  buildArgTableRows,
  formatArgValue,
  getAtPath,
} from '@/lib/argTable';

describe('getAtPath', () => {
  test('returns top-level value', () => {
    expect(getAtPath({ q: 'Ohio' }, 'q')).toBe('Ohio');
  });

  test('strips args. prefix', () => {
    expect(getAtPath({ q: 'Ohio' }, 'args.q')).toBe('Ohio');
  });

  test('walks nested dotted path', () => {
    expect(getAtPath({ payload: { id: 42 } }, 'args.payload.id')).toBe(42);
  });

  test('returns undefined for missing top-level key', () => {
    expect(getAtPath({ q: 'Ohio' }, 'missing')).toBeUndefined();
  });

  test('returns undefined when an intermediate is not an object', () => {
    expect(getAtPath({ foo: 'scalar' }, 'args.foo.bar')).toBeUndefined();
  });

  test('returns undefined when an intermediate is null', () => {
    expect(getAtPath({ foo: null }, 'args.foo.bar')).toBeUndefined();
  });
});

describe('argMatches', () => {
  test('exact equality on strings', () => {
    expect(argMatches('Ohio', 'Ohio')).toBe(true);
    expect(argMatches('Ohio', 'Texas')).toBe(false);
  });

  test('exact equality on numbers and booleans', () => {
    expect(argMatches(42, 42)).toBe(true);
    expect(argMatches(42, '42')).toBe(false);
    expect(argMatches(true, true)).toBe(true);
  });

  test('~ prefix triggers case-insensitive substring match', () => {
    expect(argMatches('~Ohio', 'Cincinnati, Ohio')).toBe(true);
    expect(argMatches('~OHIO', 'cincinnati, ohio')).toBe(true);
    expect(argMatches('~Iowa', 'Cincinnati, Ohio')).toBe(false);
  });

  test('~ prefix coerces non-string actual via String()', () => {
    expect(argMatches('~42', 42)).toBe(true);
  });

  test('~ alone (empty needle) matches everything', () => {
    expect(argMatches('~', 'anything')).toBe(true);
  });
});

describe('formatArgValue', () => {
  test('undefined → em dash', () => {
    expect(formatArgValue(undefined)).toBe('—');
  });

  test('null → "null"', () => {
    expect(formatArgValue(null)).toBe('null');
  });

  test('string passes through unquoted', () => {
    expect(formatArgValue('hello')).toBe('hello');
  });

  test('number serialized as JSON', () => {
    expect(formatArgValue(42)).toBe('42');
  });

  test('object serialized as JSON', () => {
    expect(formatArgValue({ k: 1 })).toBe('{"k":1}');
  });
});

describe('buildArgTableRows', () => {
  test('marks matching string args as match', () => {
    const rows = buildArgTableRows({ query: 'Ohio' }, { query: 'Ohio' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'query', status: { kind: 'match' } });
  });

  test('marks mismatching args as mismatch', () => {
    const rows = buildArgTableRows({ query: 'Ohio' }, { query: 'Texas' });
    expect(rows[0].status.kind).toBe('mismatch');
  });

  test('marks ~-substring match correctly', () => {
    const rows = buildArgTableRows({ query: '~Famine' }, { query: 'Great Famine in Ireland' });
    expect(rows[0].status.kind).toBe('match');
  });

  test('marks actual-missing when expected key is absent in actual', () => {
    const rows = buildArgTableRows({ q: 'Ohio' }, {});
    expect(rows[0].status.kind).toBe('actual-missing');
  });

  test('flags extra actual keys not declared in expected', () => {
    const rows = buildArgTableRows({ query: 'Ohio' }, { query: 'Ohio', limit: 5 });
    expect(rows).toHaveLength(2);
    const extra = rows.find((r) => r.key === 'limit');
    expect(extra?.status.kind).toBe('extra');
  });

  test('null expected (no fixture matched) surfaces all actual as extra', () => {
    const rows = buildArgTableRows(null, { query: 'Ohio', limit: 5 });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status.kind === 'extra')).toBe(true);
  });

  test('strips args. prefix for display key', () => {
    const rows = buildArgTableRows({ 'args.q': 'Ohio' }, { q: 'Ohio' });
    expect(rows[0].key).toBe('q');
    expect(rows[0].rawKey).toBe('args.q');
    expect(rows[0].status.kind).toBe('match');
  });

  test('handles multi-key fixture predicate', () => {
    const rows = buildArgTableRows(
      { surname: 'Flynn', year: 1850 },
      { surname: 'Flynn', year: 1850, place: 'Schuylkill' },
    );
    expect(rows.find((r) => r.key === 'surname')?.status.kind).toBe('match');
    expect(rows.find((r) => r.key === 'year')?.status.kind).toBe('match');
    expect(rows.find((r) => r.key === 'place')?.status.kind).toBe('extra');
  });

  test('mismatched partial multi-key surfaces per-param status', () => {
    const rows = buildArgTableRows(
      { surname: 'Flynn', year: 1850 },
      { surname: 'Flynn', year: 1860 },
    );
    expect(rows.find((r) => r.key === 'surname')?.status.kind).toBe('match');
    expect(rows.find((r) => r.key === 'year')?.status.kind).toBe('mismatch');
  });
});
