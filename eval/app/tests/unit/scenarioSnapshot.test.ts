import { describe, it, expect } from 'vitest';
import { findScenarioData } from '@/lib/scenarioSnapshot';

const SCEN = 'mid-research-flynn';
const research = JSON.stringify({ project: { objective: 'Find Patrick' }, questions: [] });
const tree = JSON.stringify({ persons: [{ id: 'I1' }], relationships: [] });

function snap(extra: Record<string, string> = {}): Record<string, string> {
  return {
    [`eval/fixtures/scenarios/${SCEN}/research.json`]: research,
    [`eval/fixtures/scenarios/${SCEN}/tree.gedcomx.json`]: tree,
    'packages/engine/plugin/skills/citation/SKILL.md': '# unrelated',
    ...extra,
  };
}

describe('findScenarioData', () => {
  it('parses research + gedcomx for a scenario present in the snapshot', () => {
    const out = findScenarioData(snap(), SCEN);
    expect(out).not.toBeNull();
    expect((out!.research.project as { objective: string }).objective).toBe('Find Patrick');
    expect(Array.isArray((out!.gedcomx as { persons: unknown[] }).persons)).toBe(true);
  });

  it('returns null when the scenario is not in the snapshot', () => {
    expect(findScenarioData(snap(), 'no-such-scenario')).toBeNull();
  });

  it('returns null when research.json is missing (cannot orient without it)', () => {
    const s = snap();
    delete s[`eval/fixtures/scenarios/${SCEN}/research.json`];
    expect(findScenarioData(s, SCEN)).toBeNull();
  });

  it('tolerates a missing tree.gedcomx.json (gedcomx: null)', () => {
    const s = snap();
    delete s[`eval/fixtures/scenarios/${SCEN}/tree.gedcomx.json`];
    const out = findScenarioData(s, SCEN);
    expect(out).not.toBeNull();
    expect(out!.gedcomx).toBeNull();
  });

  it('returns null on unparseable research.json rather than throwing', () => {
    const out = findScenarioData(
      { [`eval/fixtures/scenarios/${SCEN}/research.json`]: '{not json' },
      SCEN,
    );
    expect(out).toBeNull();
  });
});
