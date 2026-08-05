import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * GPS terminology lint (issue #907).
 *
 * GPS doctrine splits evidence quality into two independent closed enums
 * (enums.schema.json): `source_classification` (original|derivative|authored)
 * and `information_quality` (primary|secondary|indeterminate). "Primary
 * source" / "secondary source" collapses those two axes into one phrase, and
 * because the prompts are the product here, that phrasing leaking into
 * plugin prose is doctrine rot in the artifact itself — not a docs nit.
 *
 * Forbidden terms (case-insensitive, singular and plural): primary source,
 * secondary source, primary evidence, secondary evidence. An explicit
 * allow-list, keyed to (file, line), covers the citation skill's existing
 * terminology guardrail, which must keep quoting the wrong phrasing back at
 * the user in order to correct it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, "..", "..", ".."); // packages/engine/

const FORBIDDEN = /\b(primary|secondary)\s+(sources?|evidences?)\b/gi;

// ─── File discovery ────────────────────────────────────────────────

function discoverPluginFiles(): { abs: string; rel: string }[] {
  const pluginRoot = join(engineRoot, "plugin");
  const files: { abs: string; rel: string }[] = [];

  const agentsDir = join(pluginRoot, "agents");
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir)) {
      if (f.endsWith(".md")) {
        files.push({ abs: join(agentsDir, f), rel: `agents/${f}` });
      }
    }
  }

  const topReferencesDir = join(pluginRoot, "references");
  if (existsSync(topReferencesDir)) {
    for (const f of readdirSync(topReferencesDir)) {
      if (f.endsWith(".md")) {
        files.push({ abs: join(topReferencesDir, f), rel: `references/${f}` });
      }
    }
  }

  const skillsDir = join(pluginRoot, "skills");
  if (existsSync(skillsDir)) {
    for (const d of readdirSync(skillsDir)) {
      const p = join(skillsDir, d, "SKILL.md");
      if (existsSync(p)) {
        files.push({ abs: p, rel: `skills/${d}/SKILL.md` });
      }

      const refsDir = join(skillsDir, d, "references");
      if (existsSync(refsDir)) {
        for (const f of readdirSync(refsDir)) {
          if (f.endsWith(".md")) {
            files.push({
              abs: join(refsDir, f),
              rel: `skills/${d}/references/${f}`,
            });
          }
        }
      }
    }
  }

  return files;
}

// ─── Match extraction ──────────────────────────────────────────────

interface Match {
  relPath: string;
  lineNo: number;
  text: string;
}

function findMatchesInFile(abs: string, rel: string): Match[] {
  const lines = readFileSync(abs, "utf8").split(/\r?\n/);
  const matches: Match[] = [];
  lines.forEach((line, idx) => {
    for (const m of line.matchAll(FORBIDDEN)) {
      matches.push({ relPath: rel, lineNo: idx + 1, text: m[0] });
    }
  });
  return matches;
}

// ─── Allow-list ────────────────────────────────────────────────────

// Lines that are the terminology guardrail itself — they must quote the
// wrong phrasing back at the user in order to correct it. Each entry needs a
// reason; this is not an escape hatch for "the lint is inconvenient."
const ALLOWLIST: Array<{ relPath: string; lineNo: number; reason: string }> = [
  {
    relPath: "skills/citation/SKILL.md",
    lineNo: 515,
    reason:
      'terminology guardrail: quotes the user\'s "primary source"/"secondary source" phrasing back at them in order to correct it',
  },
  {
    relPath: "skills/citation/SKILL.md",
    lineNo: 545,
    reason:
      "terminology guardrail decision-rule row: same correction context as line 515",
  },
];

// ─── Build the full match list ─────────────────────────────────────

const allFiles = discoverPluginFiles();
const allMatches: Match[] = allFiles.flatMap(({ abs, rel }) =>
  findMatchesInFile(abs, rel),
);

function isAllowed(m: Match): boolean {
  return ALLOWLIST.some(
    (a) => a.relPath === m.relPath && a.lineNo === m.lineNo,
  );
}

describe("GPS terminology lint", () => {
  it("scans agents, top-level references, skill bodies, and skill references", () => {
    const count = (prefix: string, suffix: string) =>
      allFiles.filter((f) => f.rel.startsWith(prefix) && f.rel.endsWith(suffix))
        .length;

    expect(count("agents/", ".md"), "agent bodies").toBeGreaterThan(0);
    expect(count("references/", ".md"), "top-level references").toBeGreaterThan(
      0,
    );
    expect(count("skills/", "/SKILL.md"), "skill bodies").toBeGreaterThan(0);
    expect(
      allFiles.filter((f) => /^skills\/[^/]+\/references\/.+\.md$/.test(f.rel))
        .length,
      "skill reference files",
    ).toBeGreaterThan(0);
  });

  it("no forbidden GPS terminology outside the allow-list", () => {
    const violations = allMatches
      .filter((m) => !isAllowed(m))
      .map((m) => `${m.relPath}:${m.lineNo} — "${m.text}"`);
    expect(
      violations,
      '"primary/secondary source/evidence" collapses source_classification ' +
        "and information_quality into one phrase — use the closed-enum terms " +
        "directly, or add a reasoned allow-list entry if this is correction context",
    ).toEqual([]);
  });

  // Symmetric to enum-drift.test.ts's stale/missing checks: an allow-list
  // entry whose line no longer contains the forbidden term would otherwise
  // silently widen the allow-list for nothing, e.g. if citation/SKILL.md is
  // edited and the guardrail text moves or is reworded away.
  describe("allow-list entries are still needed", () => {
    for (const { relPath, lineNo, reason } of ALLOWLIST) {
      it(`${relPath}:${lineNo} still contains forbidden terminology (${reason})`, () => {
        const stillMatches = allMatches.some(
          (m) => m.relPath === relPath && m.lineNo === lineNo,
        );
        expect(
          stillMatches,
          `allow-list entry ${relPath}:${lineNo} no longer matches — remove ` +
            "the stale entry",
        ).toBe(true);
      });
    }
  });
});
