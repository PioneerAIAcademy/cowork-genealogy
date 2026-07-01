import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeFixtureTree, type FixtureTreeHandle } from '../helpers/fixtureTree';
import { listSkills, parseRubric } from '../../lib/skills';

const SKILL_MD_LOCALITY = `---
name: locality-guide
description: Produces a structured locality research guide.
allowed-tools: place_search, collections_search, external_links_search
---

# Locality Guide

Body content goes here.
`;

const RUBRIC_LOCALITY = `# Locality Guide Rubric

Intro paragraph.

## Jurisdiction accuracy

Did the skill correctly identify the relevant jurisdictions?

- **pass:** Jurisdictions correctly reflect the target period.
- **partial:** Modern names correct but boundaries missed.
- **fail:** Jurisdiction names are wrong.

## Record availability

Did the skill identify available records?

- **pass:** Names specific record classes with start dates.
- **partial:** Lists classes but vague on dates.
- **fail:** Record classes are wrong for the jurisdiction.
`;

const SKILL_MD_INIT = `---
name: init-project
description: Initializes a new genealogy project workspace.
---

# Init Project

Stateless — no allowed-tools.
`;

describe('skills — happy parse', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      skills: [
        { name: 'locality-guide', skillMd: SKILL_MD_LOCALITY, rubricMd: RUBRIC_LOCALITY },
        { name: 'init-project', skillMd: SKILL_MD_INIT },
      ],
    });
    process.env.EVAL_DIR = handle.root;
  });

  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('parses SKILL.md frontmatter and rubric.md dimensions', async () => {
    const skills = await listSkills();
    expect(skills.map((s) => s.name)).toEqual(['init-project', 'locality-guide']);

    const locality = skills.find((s) => s.name === 'locality-guide')!;
    expect(locality.description).toContain('locality research guide');
    expect(locality.allowedTools).toEqual(['place_search', 'collections_search', 'external_links_search']);
    expect(locality.stateless).toBe(false);
    expect(locality.rubricDimensions.map((d) => d.name)).toEqual([
      'Jurisdiction accuracy',
      'Record availability',
    ]);
    expect(locality.rubricDimensions[0].pass).toContain('target period');
    expect(locality.rubricDimensions[0].partial).toContain('boundaries missed');
    expect(locality.rubricDimensions[0].fail).toContain('Jurisdiction names are wrong');
  });

  it('flags stateless skills (no allowed-tools)', async () => {
    const skills = await listSkills();
    const init = skills.find((s) => s.name === 'init-project')!;
    expect(init.allowedTools).toEqual([]);
    expect(init.stateless).toBe(true);
    expect(init.rubricDimensions).toEqual([]);
  });
});

describe('skills — allowed-tools parsing', () => {
  async function readToolsFor(skillMd: string): Promise<string[]> {
    const handle = await makeFixtureTree({ skills: [{ name: 'probe', skillMd }] });
    process.env.EVAL_DIR = handle.root;
    try {
      const skills = await listSkills();
      return skills.find((s) => s.name === 'probe')!.allowedTools;
    } finally {
      delete process.env.EVAL_DIR;
      await handle.cleanup();
    }
  }

  it('handles inline CSV', async () => {
    const md = `---\nname: probe\ndescription: x\nallowed-tools: place_search, collections_search, external_links_search\n---\n`;
    expect(await readToolsFor(md)).toEqual(['place_search', 'collections_search', 'external_links_search']);
  });

  it('handles JSON-flow list', async () => {
    const md = `---\nname: probe\ndescription: x\nallowed-tools: [place_search, collections_search]\n---\n`;
    expect(await readToolsFor(md)).toEqual(['place_search', 'collections_search']);
  });

  it('handles YAML continuation list', async () => {
    const md = `---\nname: probe\ndescription: x\nallowed-tools:\n  - wikipedia_search\n  - place_search\n---\n`;
    expect(await readToolsFor(md)).toEqual(['wikipedia_search', 'place_search']);
  });
});

describe('skills — malformed rubric throws with path pointer', () => {
  it('throws when a dimension has no pass/partial/fail bullets', () => {
    const bad = `# Bad Rubric

## Some dimension

Description only, no bullets.
`;
    expect(() => parseRubric(bad, '/path/to/eval/tests/unit/foo/rubric.md')).toThrow(/rubric.md/);
  });

  it('throws when there are no dimensions at all', () => {
    const bad = `# Bad Rubric

Just intro, no H2 sections.
`;
    expect(() => parseRubric(bad, '/some/path/rubric.md')).toThrow(/no H2 dimension headings/);
  });

  it('surfaces the file path in the error message so a junior can locate it', () => {
    const bad = `# Bad Rubric

## Missing bullets dimension

Description.
`;
    try {
      parseRubric(bad, '/this/specific/path/rubric.md');
      expect.fail('expected throw');
    } catch (err) {
      expect((err as Error).message).toContain('/this/specific/path/rubric.md');
    }
  });
});
