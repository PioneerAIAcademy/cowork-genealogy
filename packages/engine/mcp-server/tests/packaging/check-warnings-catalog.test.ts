import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_WARNING_TAGS } from "../../src/tools/person-warnings.js";

// The check-warnings agent interprets every tag `person_warnings` returns, from
// the catalog in its own body. Nothing compared that catalog with the tool, so a
// new tag shipped with no entry and the agent read it cold:
// `hasBirthFarFromParentsResidence` went out that way.
//
// The tags it must cover are the shipped tags minus the merge-mode-only ones,
// which only `merge_warnings` emits and this agent never calls. Which tags are
// merge-mode-only comes from the spec's § Tag Catalogue, the human-reviewed
// classification that person-warnings-spec-drift.test.ts keeps tag-complete.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");
const spec = readFileSync(join(repoRoot, "docs", "specs", "person-warnings-tool-spec.md"), "utf8");
const agent = readFileSync(
  join(repoRoot, "packages", "engine", "plugin", "agents", "check-warnings.md"),
  "utf8",
);

/** Tags whose § Tag Catalogue row says the tag fires in merge mode only. */
function mergeOnlyTags(): Set<string> {
  const start = spec.indexOf("### Tag Catalogue");
  const end = spec.indexOf("\n## ", start + 1);
  const section = spec.slice(start, end === -1 ? undefined : end);
  const out = new Set<string>();
  for (const m of section.matchAll(/^\|\s*`([a-z][A-Za-z0-9_]*)`\s*\|([^\n]*)$/gm)) {
    if (/merge-mode only/i.test(m[2])) out.add(m[1]);
  }
  return out;
}

/** Every backticked tag name the agent body mentions. */
function agentTags(): Set<string> {
  return new Set([...agent.matchAll(/`([a-z][A-Za-z0-9_]*)`/g)].map((m) => m[1]));
}

describe("the check-warnings agent catalogs every tag person_warnings emits", () => {
  const mergeOnly = mergeOnlyTags();
  const owed = ALL_WARNING_TAGS.filter((t) => !mergeOnly.has(t));

  // Without these, a renamed heading or a broken pattern compares empty sets
  // and passes.
  it("finds the tags on both sides", () => {
    expect(mergeOnly.size, "no merge-mode-only rows parsed from § Tag Catalogue").toBe(18);
    expect(owed.length).toBe(ALL_WARNING_TAGS.length - 18);
  });

  it("names every non-merge tag somewhere in the agent body", () => {
    const named = agentTags();
    const missing = owed.filter((t) => !named.has(t)).sort();
    expect(
      missing,
      "person_warnings emits these tags but packages/engine/plugin/agents/check-warnings.md " +
        "never names them; add each to its Appendix A catalog",
    ).toEqual([]);
  });
});
