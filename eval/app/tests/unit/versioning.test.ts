import { describe, it, expect } from 'vitest';
import { annFilenameFor, classify, classifyAnn, sortNewestFirst } from '../../lib/versioning';

describe('classify', () => {
  it('recognizes released files', () => {
    expect(classify('v3.json')).toEqual({ kind: 'released', version: 3, timestamp: null });
    expect(classify('v12.json')).toEqual({ kind: 'released', version: 12, timestamp: null });
  });

  it('recognizes candidate files', () => {
    expect(classify('v3_2026-05-18_10-30-00.json')).toEqual({
      kind: 'candidate',
      version: 3,
      timestamp: '2026-05-18_10-30-00',
    });
  });

  it('recognizes scratch files', () => {
    expect(classify('scratch_2026-05-18_10-30-00.json')).toEqual({
      kind: 'scratch',
      version: null,
      timestamp: '2026-05-18_10-30-00',
    });
  });

  it('returns other for unrecognized filenames', () => {
    expect(classify('foo.json').kind).toBe('other');
    expect(classify('v3.ann.json').kind).toBe('other');
  });

  it('classifyAnn handles annotation filenames', () => {
    expect(classifyAnn('v3.ann.json').kind).toBe('released');
    expect(classifyAnn('v3_2026-05-18_10-30-00.ann.json').kind).toBe('candidate');
    expect(classifyAnn('scratch_2026-05-18_10-30-00.ann.json').kind).toBe('scratch');
  });
});

describe('annFilenameFor', () => {
  it('appends .ann to the json basename', () => {
    expect(annFilenameFor('v3.json')).toBe('v3.ann.json');
    expect(annFilenameFor('v3_2026-05-18_10-30-00.json')).toBe('v3_2026-05-18_10-30-00.ann.json');
  });

  it('throws on non-json input', () => {
    expect(() => annFilenameFor('v3.txt')).toThrow();
  });
});

describe('sortNewestFirst', () => {
  it('puts released ahead of candidate, candidate ahead of scratch', () => {
    const files = [
      'scratch_2030-01-01_00-00-00.json',
      'v2_2026-05-19_00-00-00.json',
      'v1.json',
    ];
    files.sort(sortNewestFirst);
    expect(files).toEqual([
      'v1.json',
      'v2_2026-05-19_00-00-00.json',
      'scratch_2030-01-01_00-00-00.json',
    ]);
  });

  it('orders candidates by version desc then timestamp desc', () => {
    const files = [
      'v2_2026-05-18_10-30-00.json',
      'v2_2026-05-18_12-00-00.json',
      'v3_2026-05-18_09-00-00.json',
    ];
    files.sort(sortNewestFirst);
    expect(files).toEqual([
      'v3_2026-05-18_09-00-00.json',
      'v2_2026-05-18_12-00-00.json',
      'v2_2026-05-18_10-30-00.json',
    ]);
  });
});
