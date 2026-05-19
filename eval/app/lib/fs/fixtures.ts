/**
 * Read MCP fixtures under `eval/fixtures/mcp/<name>.json`.
 *
 * The UI is read-only for fixtures in Phase 1.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixturesDir, testsUnitDir } from '../paths';
import type { McpFixtureFile, UnitTestFile } from '../types';

export interface FixtureListEntry {
  name: string;
  tool: string | null;
  description: string | null;
  usageCount: number;
}

export async function listFixtures(): Promise<{ fixtures: FixtureListEntry[]; corrupt: string[] }> {
  const root = fixturesDir();
  let files: string[];
  try {
    files = await fs.readdir(root);
  } catch {
    return { fixtures: [], corrupt: [] };
  }
  const usageByName = await fixtureUsageCounts();
  const out: FixtureListEntry[] = [];
  const corrupt: string[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const name = file.replace(/\.json$/, '');
    const filePath = path.join(root, file);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as McpFixtureFile;
      out.push({
        name,
        tool: typeof parsed.tool === 'string' ? parsed.tool : null,
        description: typeof parsed.description === 'string' ? parsed.description : null,
        usageCount: usageByName.get(name) ?? 0,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[fixtures.ts] could not read ${filePath}: ${(err as Error).message}`);
      corrupt.push(filePath);
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { fixtures: out, corrupt };
}

export async function readFixture(name: string): Promise<McpFixtureFile | null> {
  const filePath = path.join(fixturesDir(), `${name}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as McpFixtureFile;
  } catch {
    return null;
  }
}

export async function fixtureUsageCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await forEachUnitTest((test) => {
    for (const f of test.mcp_fixtures ?? []) {
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  });
  return counts;
}

export async function testsReferencingFixture(name: string): Promise<Array<{ id: string; name: string; skill: string }>> {
  const out: Array<{ id: string; name: string; skill: string }> = [];
  await forEachUnitTest((test) => {
    if ((test.mcp_fixtures ?? []).includes(name)) {
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
