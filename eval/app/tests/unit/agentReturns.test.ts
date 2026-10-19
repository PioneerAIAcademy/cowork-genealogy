import { describe, expect, it } from 'vitest';

import { parseAgentReturns, splitAgentReturns } from '@/lib/agentReturns';

/**
 * The three cases the annotator panel has to get right. Each is a silent
 * failure if it is wrong — a mislabelled panel reads exactly like a correct
 * one, and the annotator confirms a score against the wrong text.
 *
 * No committed routed run carries `agent_returns` yet (the capture ships in
 * this PR), so the routed cases cannot be exercised from the corpus. They are
 * constructed here instead, which is why this is a unit test rather than a
 * browser check.
 */

const SW = { subagent_type: 'search-wikipedia', text: 'Saved the summary to `x.md`.' };
const RE = { subagent_type: 'record-extractor', text: 'Extracted 4 assertions.' };

describe('splitAgentReturns', () => {
  it('grades a direct test’s return from the agent under test', () => {
    const { graded, other } = splitAgentReturns([SW], true, 'search-wikipedia');
    expect(graded).toEqual([SW]);
    expect(other).toEqual([]);
  });

  it('grades nothing on a routed run, even when it spawned an agent', () => {
    // `ut_timeline_008` spawns `record-extractor` on a ROUTED run. The judge
    // grades `text_response` there, so labelling this "what the judge graded"
    // would be a lie. Making the panel ungated is exactly what this catches.
    const { graded, other } = splitAgentReturns([RE], false, 'timeline');
    expect(graded).toEqual([]);
    expect(other).toEqual([RE]);
  });

  it('does not grade another agent’s return on a direct test', () => {
    const { graded, other } = splitAgentReturns([RE], true, 'search-wikipedia');
    expect(graded).toEqual([]);
    expect(other).toEqual([RE]);
  });

  it('splits a direct run that spawned both', () => {
    const { graded, other } = splitAgentReturns([SW, RE], true, 'search-wikipedia');
    expect(graded).toEqual([SW]);
    expect(other).toEqual([RE]);
  });

  it('grades nothing when the agent returned empty text', () => {
    // The judge falls back to `text_response` here, so the panel must not
    // claim an empty string is what was graded.
    const empty = { subagent_type: 'search-wikipedia', text: '' };
    const { graded, other } = splitAgentReturns([empty], true, 'search-wikipedia');
    expect(graded).toEqual([]);
    expect(other).toEqual([empty]);
  });
});

describe('parseAgentReturns', () => {
  it('keeps well-formed entries', () => {
    expect(parseAgentReturns([SW, RE])).toEqual([SW, RE]);
  });

  it('returns [] for a missing or non-array field', () => {
    // A routed run omits `agent_returns` entirely, and every pre-capture run
    // log in the corpus does too.
    expect(parseAgentReturns(undefined)).toEqual([]);
    expect(parseAgentReturns(null)).toEqual([]);
    expect(parseAgentReturns('nope')).toEqual([]);
  });

  it('drops malformed entries rather than rendering them', () => {
    expect(
      parseAgentReturns([SW, null, { subagent_type: 'x' }, { text: 'y' }, { subagent_type: 1, text: 2 }]),
    ).toEqual([SW]);
  });
});
