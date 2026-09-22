/**
 * Skills introspection.
 *
 * - `packages/engine/plugin/skills/<name>/SKILL.md` — frontmatter parsed for `name`,
 *   `description`, `allowed-tools`.
 * - `packages/engine/plugin/agents/<name>.md` — the same frontmatter (with
 *   `tools` in place of `allowed-tools`), for an agent-keyed suite that has no
 *   skill directory behind it (issue #1253).
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
import { pluginAgentsDir, pluginSkillsDir, testsUnitDir } from './paths';
import { PathEscapeError, resolveWithin } from './fs/safe-path';
import type { SkillInfo, SkillRubricDimension } from './types';

interface SkillFrontmatter {
  name?: string;
  description?: string;
  'allowed-tools'?: string | string[];
  /**
   * A plugin agent declares its tools as `tools:`, a skill as `allowed-tools:`
   * (`eval/harness/harness/allowed_tools.py` reads exactly this pair). Present
   * so an agent-keyed suite reports the agent's real tool list instead of an
   * empty one — see `readSkillMd`.
   */
  tools?: string | string[];
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

/**
 * Frontmatter for a suite, from its SKILL.md — or, for an agent-keyed suite
 * with no skill directory (issue #1253), from the plugin agent file of the
 * same name.
 *
 * Agents carry the same frontmatter convention as skills (`description`,
 * `allowed-tools`/`tools`), which is why the harness's own
 * `load_skill_frontmatter` is documented to work on either. Without the
 * fallback `gps-mentor` would reach the picker with a null description and an
 * empty tool list, and so be mislabelled `stateless` — the flag that tells an
 * author their tests need no MCP fixtures.
 */
async function readSkillMd(skillName: string): Promise<{ frontmatter: SkillFrontmatter; body: string } | null> {
  const candidates = [
    path.join(pluginSkillsDir(), skillName, 'SKILL.md'),
    path.join(pluginAgentsDir(), `${skillName}.md`),
  ];
  for (const filePath of candidates) {
    try {
      return parseFrontmatter(await fs.readFile(filePath, 'utf8'));
    } catch (err) {
      // Absent is the supported answer, and the only one: an agent-keyed suite
      // has no SKILL.md, and an ordinary skill has no same-named agent file.
      // ENOTDIR is the same answer reached differently — a path component that
      // exists but is not a directory. Anything else (EACCES, EISDIR, EMFILE)
      // is a broken checkout rather than absent content, and still throws,
      // matching `readRubricFor` below. Swallowing those would report a skill
      // as description-less and tool-less — which reads in the picker exactly
      // like a skill that declares nothing.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') continue;
      throw err;
    }
  }
  return null;
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

/**
 * Directory names of every suite the picker should offer: the plugin skills,
 * plus any `eval/tests/unit/<name>/` that has no skill directory behind it.
 *
 * The second half is what reaches an agent-keyed suite (issue #1253).
 * `gps-mentor` has a rubric and tests under `eval/tests/unit/` and no skill
 * directory at all, so enumerating `pluginSkillsDir()` alone left its rubric
 * unreachable from the UI genealogists annotate in — and `check_runlogs.py`
 * blocks the PR until that annotation lands, so the suite could not be
 * finished at all.
 *
 * Keyed on directory existence rather than a name list, so a new suite appears
 * here the moment it lands.
 *
 * Deliberately NOT the same rule as the harness's `run_tests.py::_list_skills`,
 * which requires a directory to hold at least one runnable test JSON. That is
 * right for something about to execute a suite and wrong for a picker an author
 * opens to write `rubric.md` before the first test exists. The guard here only
 * drops directories that are not suites at all — no `rubric.md` and no `.json`
 * — so a stray `__pycache__` never becomes a skill in the UI.
 */
async function looksLikeSuite(dir: string): Promise<boolean> {
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  return files.some((f) => f === 'rubric.md' || f.endsWith('.json'));
}

async function suiteNames(): Promise<string[]> {
  const names = new Set<string>();
  // A plugin skill is listed whether or not it has tests — pre-existing
  // behaviour, unchanged. A tests-only directory must look like a suite.
  for (const [root, mustLookLikeSuite] of [
    [pluginSkillsDir(), false] as const,
    [testsUnitDir(), true] as const,
  ]) {
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      const dir = path.join(root, name);
      const stat = await fs.stat(dir).catch(() => null);
      if (!stat?.isDirectory()) continue;
      if (mustLookLikeSuite && !(await looksLikeSuite(dir))) continue;
      names.add(name);
    }
  }
  return [...names];
}

export async function listSkills(): Promise<SkillInfo[]> {
  const out: SkillInfo[] = [];
  for (const name of await suiteNames()) {
    const parsed = await readSkillMd(name);
    const allowedTools = parseAllowedTools(parsed?.frontmatter['allowed-tools'] ?? parsed?.frontmatter.tools);
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
  //
  // Both roots are resolved, and either one existing is enough: an agent-keyed
  // suite (issue #1253) has a directory under `eval/tests/unit/` and none under
  // `packages/engine/plugin/skills/`. Containment is still checked against each
  // root separately, so a traversing name is refused before either stat.
  let dirs: string[];
  try {
    dirs = [
      resolveWithin(pluginSkillsDir(), name),
      resolveWithin(testsUnitDir(), name),
    ];
  } catch (e) {
    if (!(e instanceof PathEscapeError)) throw e;
    return null;
  }
  let found = false;
  for (const dir of dirs) {
    const stat = await fs.stat(dir).catch(() => null);
    if (stat?.isDirectory()) {
      found = true;
      break;
    }
  }
  if (!found) return null;
  const parsed = await readSkillMd(name);
  const allowedTools = parseAllowedTools(parsed?.frontmatter['allowed-tools'] ?? parsed?.frontmatter.tools);
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
