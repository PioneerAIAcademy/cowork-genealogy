/**
 * Skills introspection.
 *
 * - `plugin/skills/<name>/SKILL.md` — frontmatter parsed for `name`,
 *   `description`, `allowed-tools`.
 * - `eval/tests/unit/<name>/rubric.md` — parsed for grading
 *   dimensions per unit-test-spec.md §7.
 *
 * No caching: the scan is sub-millisecond, and dev edits to
 * `rubric.md` show up without a server restart. Malformed rubrics
 * throw with a path pointer — surfaces as a clean 500 from the first
 * request that hits the bad file.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pluginSkillsDir, testsUnitDir } from './paths';
import type { SkillInfo, SkillRubricDimension } from './types';

interface SkillFrontmatter {
  name?: string;
  description?: string;
  'allowed-tools'?: string | string[];
}

function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: content };

  const block = m[1];
  const body = m[2];
  const frontmatter: SkillFrontmatter = {};
  // Very small YAML subset: `key: value` lines, with continuation on
  // any line that starts with whitespace. Sufficient for our skills.
  const lines = block.split(/\r?\n/);
  let currentKey: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (line === '') {
      currentKey = null;
      continue;
    }
    const kvMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_\-]*):\s*(.*)$/);
    if (kvMatch && !/^\s/.test(rawLine)) {
      const k = kvMatch[1];
      const v = kvMatch[2];
      (frontmatter as Record<string, unknown>)[k] = v;
      currentKey = k;
      continue;
    }
    if (currentKey && /^\s/.test(rawLine)) {
      const cur = (frontmatter as Record<string, unknown>)[currentKey];
      const trimmed = rawLine.trim();
      (frontmatter as Record<string, unknown>)[currentKey] = (cur ?? '') + ' ' + trimmed;
    }
  }
  return { frontmatter, body };
}

function parseAllowedTools(raw: SkillFrontmatter['allowed-tools']): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  // Accept three forms:
  //   allowed-tools: a, b, c            (inline CSV)
  //   allowed-tools:
  //     - a
  //     - b                             (YAML list — our mini parser
  //                                      flattens continuation lines into
  //                                      one space-joined string, so we
  //                                      split on `-` markers)
  //   allowed-tools: [a, b]             (inline JSON-flow list)
  const s = raw.trim();
  // JSON-flow list.
  if (s.startsWith('[') && s.endsWith(']')) {
    return s
      .slice(1, -1)
      .split(',')
      .map((p) => p.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  // YAML continuation list: items separated by `-` markers after flatten.
  if (s.includes('-')) {
    const parts = s.split(/\s+-\s+/);
    // The first piece is what was on the same line as the key, often empty.
    return parts
      .map((p) => p.replace(/^-\s+/, '').trim())
      .filter(Boolean);
  }
  return s
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Parse `rubric.md`. Format (per unit-test-spec.md §7):
 *
 *     # <Skill> Rubric
 *
 *     (optional intro paragraph)
 *
 *     ## <Dimension name>
 *
 *     <dimension description, free-form>
 *
 *     - **pass:** ...
 *     - **partial:** ...
 *     - **fail:** ...
 *
 * Throws on malformed input with a file-path pointer.
 */
export function parseRubric(content: string, filePath: string): SkillRubricDimension[] {
  const lines = content.split(/\r?\n/);
  const dimensions: SkillRubricDimension[] = [];

  let i = 0;
  // Skip up to and including the H1 line.
  while (i < lines.length && !/^# /.test(lines[i])) i++;
  if (i < lines.length) i++;

  while (i < lines.length) {
    if (/^##\s+/.test(lines[i])) {
      const name = lines[i].replace(/^##\s+/, '').trim();
      i++;
      // Skip a blank line.
      while (i < lines.length && lines[i].trim() === '') i++;
      // Collect description lines until we hit the pass/partial/fail
      // bullets or the next H2.
      const descLines: string[] = [];
      while (i < lines.length && !/^##\s+/.test(lines[i]) && !/^-\s+\*\*(pass|partial|fail)/i.test(lines[i].trim())) {
        descLines.push(lines[i]);
        i++;
      }
      const description = descLines.join('\n').trim();

      let pass: string | null = null;
      let partial: string | null = null;
      let fail: string | null = null;
      while (i < lines.length && !/^##\s+/.test(lines[i])) {
        const line = lines[i].trim();
        const m = line.match(/^-\s+\*\*(pass|partial|fail):?\*\*\s*(.*)$/i);
        if (m) {
          const key = m[1].toLowerCase() as 'pass' | 'partial' | 'fail';
          const text = m[2].trim();
          if (key === 'pass') pass = text;
          else if (key === 'partial') partial = text;
          else fail = text;
        }
        i++;
      }
      if (pass === null && partial === null && fail === null) {
        throw new Error(`Malformed rubric: dimension "${name}" is missing all of pass/partial/fail bullets in ${filePath}`);
      }
      dimensions.push({ name, description, pass, partial, fail });
    } else {
      i++;
    }
  }

  if (dimensions.length === 0) {
    throw new Error(`Malformed rubric: no H2 dimension headings found in ${filePath}`);
  }
  return dimensions;
}

async function readSkillMd(skillName: string): Promise<{ frontmatter: SkillFrontmatter; body: string } | null> {
  const filePath = path.join(pluginSkillsDir(), skillName, 'SKILL.md');
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return parseFrontmatter(content);
  } catch {
    return null;
  }
}

async function readRubricFor(skillName: string): Promise<SkillRubricDimension[]> {
  const rubricPath = path.join(testsUnitDir(), skillName, 'rubric.md');
  try {
    const content = await fs.readFile(rubricPath, 'utf8');
    return parseRubric(content, rubricPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * True when the skill has no `allowed-tools`. Stateless skills aren't
 * required to supply MCP fixtures in unit tests.
 */
function isStateless(allowedTools: string[]): boolean {
  return allowedTools.length === 0;
}

export async function listSkills(): Promise<SkillInfo[]> {
  const root = pluginSkillsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }
  const out: SkillInfo[] = [];
  for (const name of entries) {
    const dir = path.join(root, name);
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const parsed = await readSkillMd(name);
    const allowedTools = parseAllowedTools(parsed?.frontmatter['allowed-tools']);
    const rubricDimensions = await readRubricFor(name);
    out.push({
      name,
      description: parsed?.frontmatter.description?.trim() ?? null,
      allowedTools,
      rubricDimensions,
      stateless: isStateless(allowedTools),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function readSkill(name: string): Promise<SkillInfo | null> {
  const dir = path.join(pluginSkillsDir(), name);
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) return null;
  const parsed = await readSkillMd(name);
  const allowedTools = parseAllowedTools(parsed?.frontmatter['allowed-tools']);
  const rubricDimensions = await readRubricFor(name);
  return {
    name,
    description: parsed?.frontmatter.description?.trim() ?? null,
    allowedTools,
    rubricDimensions,
    stateless: isStateless(allowedTools),
  };
}
