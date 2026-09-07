/**
 * Skills introspection.
 *
 * - `packages/engine/plugin/skills/<name>/SKILL.md` — frontmatter parsed for `name`,
 *   `description`, `allowed-tools`.
 * - `eval/tests/unit/<name>/rubric.md` — parsed for grading
 *   dimensions per unit-test-spec.md §7.
 *
 * No caching: the scan is sub-millisecond, and dev edits to
 * `rubric.md` show up without a server restart. A rubric that fails to
 * parse is reported on its own skill as `rubricError` and takes only
 * that skill's dimensions down — one bad file used to throw out of
 * `listSkills` and 500 the whole picker for every skill.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pluginSkillsDir, testsUnitDir } from './paths';
import { PathEscapeError, resolveWithin } from './fs/safe-path';
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
  // Blank gets its own message. It is the one malformed shape with an
  // obvious fix, and "no H2 dimension headings found" does not name it.
  // Matches parse_rubric_or_empty in eval/harness/harness/rubric.py.
  if (content.trim() === '') {
    throw new Error(
      `Malformed rubric: ${filePath} is blank. To grade a skill on the base dimensions only, delete the file.`,
    );
  }
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

/**
 * A skill's rubric dimensions, plus why they are missing when they are.
 *
 * `error` is null both when the file parsed and when there is no file at
 * all — absent is the supported opt-out, so it is not an error. Only a
 * parse failure fills it in, and only a parse failure is caught: any
 * other read failure (EACCES, EISDIR) is a broken checkout rather than
 * bad content, and still throws.
 */
async function readRubricFor(
  skillName: string,
): Promise<{ dimensions: SkillRubricDimension[]; error: string | null }> {
  const rubricPath = path.join(testsUnitDir(), skillName, 'rubric.md');
  let content: string;
  try {
    content = await fs.readFile(rubricPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { dimensions: [], error: null };
    }
    throw err;
  }
  try {
    return { dimensions: parseRubric(content, rubricPath), error: null };
  } catch (err) {
    return { dimensions: [], error: (err as Error).message };
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
    const rubric = await readRubricFor(name);
    out.push({
      name,
      description: parsed?.frontmatter.description?.trim() ?? null,
      allowedTools,
      rubricDimensions: rubric.dimensions,
      rubricError: rubric.error,
      stateless: isStateless(allowedTools),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function readSkill(name: string): Promise<SkillInfo | null> {
  // The one sink in this file that takes caller input. `readSkillMd` and
  // `readRubricFor` below build paths from a name too, but they are private and
  // have exactly two callers: this function, which contains the name here before
  // passing it on, and `listSkills`, which passes readdir entry names off disk.
  // Guarding them as well would add two checks no test could ever red — the
  // resolve here throws first on every reachable path — and this PR's own
  // doctrine is that a guard which cannot fail reads as coverage.
  //
  // Returns null rather than throwing, matching `readFixture`, `readScenario`,
  // `readRunLogById` and `readAnnotation`: a read keeps its not-found contract,
  // and only writes and deletes throw. Nothing calls this today, but the reason
  // it is contained is that a route will — and that route should answer 404,
  // not surface an unhandled throw as a 500.
  let dir: string;
  try {
    dir = resolveWithin(pluginSkillsDir(), name);
  } catch (e) {
    if (!(e instanceof PathEscapeError)) throw e;
    return null;
  }
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) return null;
  const parsed = await readSkillMd(name);
  const allowedTools = parseAllowedTools(parsed?.frontmatter['allowed-tools']);
  const rubric = await readRubricFor(name);
  return {
    name,
    description: parsed?.frontmatter.description?.trim() ?? null,
    allowedTools,
    rubricDimensions: rubric.dimensions,
    rubricError: rubric.error,
    stateless: isStateless(allowedTools),
  };
}
