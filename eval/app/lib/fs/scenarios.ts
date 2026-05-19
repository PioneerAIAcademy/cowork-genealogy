/**
 * Read scenarios under `eval/fixtures/scenarios/<name>/`.
 *
 * Each scenario is a directory containing `README.md`, `research.json`,
 * and `tree.gedcomx.json`. The UI is read-only for scenarios in
 * Phase 1; devs author scenarios on disk.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenariosDir, testsUnitDir } from '../paths';
import type { ScenarioInfo, UnitTestFile } from '../types';

export interface ScenarioListEntry {
  name: string;
  description: string | null;
  usageCount: number;
}

async function readJsonIfExists(p: string): Promise<unknown> {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readTextIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

function firstParagraph(readme: string | null): string | null {
  if (!readme) return null;
  // Strip the leading H1 line, then take the first non-empty para.
  const lines = readme.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].startsWith('#')) i++;
  while (i < lines.length && lines[i].trim() === '') i++;
  const para: string[] = [];
  while (i < lines.length && lines[i].trim() !== '') {
    para.push(lines[i]);
    i++;
  }
  const out = para.join(' ').trim();
  return out === '' ? null : out;
}

export async function listScenarios(): Promise<ScenarioListEntry[]> {
  const root = scenariosDir();
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }

  const usageByName = await scenarioUsageCounts();
  const out: ScenarioListEntry[] = [];
  for (const name of entries) {
    const dir = path.join(root, name);
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const readme = await readTextIfExists(path.join(dir, 'README.md'));
    out.push({
      name,
      description: firstParagraph(readme),
      usageCount: usageByName.get(name) ?? 0,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function readScenario(name: string): Promise<ScenarioInfo | null> {
  const dir = path.join(scenariosDir(), name);
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) return null;
  return {
    name,
    readme: await readTextIfExists(path.join(dir, 'README.md')),
    research: await readJsonIfExists(path.join(dir, 'research.json')),
    tree: await readJsonIfExists(path.join(dir, 'tree.gedcomx.json')),
  };
}

/**
 * Reverse lookup: which tests reference each scenario.
 */
export async function scenarioUsageCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await forEachUnitTest((test) => {
    const name = test.input.scenario;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return counts;
}

export async function testsReferencingScenario(name: string): Promise<Array<{ id: string; name: string; skill: string }>> {
  const out: Array<{ id: string; name: string; skill: string }> = [];
  await forEachUnitTest((test) => {
    if (test.input.scenario === name) {
      out.push({ id: test.test.id, name: test.test.name, skill: test.test.skill });
    }
  });
  return out.sort((a, b) => a.skill.localeCompare(b.skill) || a.name.localeCompare(b.name));
}

async function forEachUnitTest(visit: (test: UnitTestFile) => void): Promise<void> {
  const root = testsUnitDir();
  let skillDirs: string[];
  try {
    skillDirs = await fs.readdir(root);
  } catch {
    return;
  }
  for (const skill of skillDirs) {
    const skillPath = path.join(root, skill);
    let files: string[];
    try {
      files = await fs.readdir(skillPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(skillPath, file), 'utf8');
        visit(JSON.parse(raw) as UnitTestFile);
      } catch {
        continue;
      }
    }
  }
}
