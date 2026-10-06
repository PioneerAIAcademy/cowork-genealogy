import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  citedLineNumbers,
  citedMakeTargets,
  headingAnchors,
  makeTargetResolves,
  pathResolves,
  pathResolvesIn,
  slugifyHeading,
} from "./repo-paths.js";

/**
 * Unit tests for the forms the doc lints must read the way GitHub and a reader
 * do. Each case is one the widened corpus contains; getting one wrong reddens a
 * correct doc, and a lint that does that gets skipped.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..", "..", "..", "..");

describe("slugifyHeading matches GitHub's anchors", () => {
  it("keeps one hyphen per space, so dropped punctuation leaves a double hyphen", () => {
    expect(slugifyHeading("Place → collection scope")).toBe("place--collection-scope");
    expect(
      slugifyHeading("`relativeTerms` — whether the relative you anchored on is actually there"),
    ).toBe("relativeterms--whether-the-relative-you-anchored-on-is-actually-there");
  });

  it("keeps underscores, which GitHub keeps", () => {
    expect(slugifyHeading("Places_Search_resource")).toBe("places_search_resource");
    expect(slugifyHeading("`place_search` tool")).toBe("place_search-tool");
  });

  it("drops underscore and asterisk emphasis, but not an unpaired underscore", () => {
    expect(slugifyHeading("An _emphasised_ word")).toBe("an-emphasised-word");
    expect(slugifyHeading("The _id field")).toBe("the-_id-field");
    expect(slugifyHeading("A **bold** claim")).toBe("a-bold-claim");
  });

  it("drops apostrophes and link targets", () => {
    expect(slugifyHeading("If you're asked to…")).toBe("if-youre-asked-to");
    expect(slugifyHeading("See [the spec](docs/x.md)")).toBe("see-the-spec");
  });
});

describe("headingAnchors", () => {
  it("suffixes repeated headings -1, -2 in order, as GitHub does", () => {
    const text = "## If you're asked to…\n\n## Other\n\n## If you're asked to…\n\n## If you're asked to…\n";
    expect([...headingAnchors(text)]).toEqual([
      "if-youre-asked-to",
      "other",
      "if-youre-asked-to-1",
      "if-youre-asked-to-2",
    ]);
  });

  it("skips a suffix a real heading already took, as github-slugger does", () => {
    expect([...headingAnchors("# Foo\n# Foo 1\n# Foo\n")]).toEqual(["foo", "foo-1", "foo-2"]);
  });

  it("drops a closing ATX sequence", () => {
    expect([...headingAnchors("## Title ##\n")]).toEqual(["title"]);
  });

  it("ignores headings inside fenced blocks", () => {
    expect([...headingAnchors("```\n# not a heading\n```\n## Real\n")]).toEqual(["real"]);
  });
});

describe("pathResolves with a ** glob", () => {
  it("resolves a corpus glob through any depth", () => {
    expect(pathResolves(projectRoot, "eval/**/research.json")).toBe(true);
    expect(pathResolves(projectRoot, "eval/**/*final-research.json")).toBe(true);
  });

  it("lets ** match zero directories", () => {
    expect(pathResolves(projectRoot, "docs/**/architecture.md")).toBe(true);
  });

  it("still fails a ** glob that matches nothing", () => {
    expect(pathResolves(projectRoot, "eval/**/zz-no-such-file.json")).toBe(false);
    expect(pathResolves(projectRoot, "zz-no-such-dir/**/research.json")).toBe(false);
  });

  it("reads a run of placeholders as one segment, not a globstar", () => {
    expect(pathResolves(projectRoot, "docs/<a><b>/architecture.md")).toBe(false);
    expect(pathResolves(projectRoot, "docs/<a><b>.md")).toBe(true);
  });

  it("needs at least one entry under a trailing **", () => {
    const root = mkdtempSync(join(tmpdir(), "repo-paths-"));
    mkdirSync(join(root, "empty"));
    mkdirSync(join(root, "full"));
    writeFileSync(join(root, "full", "a.md"), "x");
    expect(pathResolves(root, "empty/**")).toBe(false);
    expect(pathResolves(root, "full/**")).toBe(true);
  });
});

describe("citedLineNumbers", () => {
  it("reports a .md line cite, with an en-dash range whole", () => {
    expect(citedLineNumbers("see `packages/engine/plugin/skills/x/SKILL.md:98–110`")).toEqual([
      "packages/engine/plugin/skills/x/SKILL.md:98–110",
    ]);
    expect(citedLineNumbers("see `docs/a.md:12-14` and `src/v.ts:3`")).toEqual([
      "docs/a.md:12-14",
      "src/v.ts:3",
    ]);
  });

  it("leaves anchors, times, ARKs and prose alone", () => {
    expect(
      citedLineNumbers("`docs/foo.md#section`, `9:30`, `1:1:QL69-GBJC`, and docs/a.md:12 outside a span"),
    ).toEqual([]);
  });
});

describe("make target citations", () => {
  const targets = new Set(["e2e-run", "e2e-corpus", "engine-test"]);

  it("reads a family glob after a literal prefix", () => {
    expect(citedMakeTargets("their `make e2e-*` targets")).toEqual(["e2e-*"]);
    expect(makeTargetResolves(targets, "e2e-*")).toBe(true);
    expect(makeTargetResolves(targets, "zz-*")).toBe(false);
    expect(makeTargetResolves(targets, "engine-test*")).toBe(false);
  });

  it("does not extract a target that is only a placeholder", () => {
    expect(citedMakeTargets("run `make <target>`")).toEqual([]);
  });

  it("still checks a plain target exactly", () => {
    expect(citedMakeTargets("`make engine-test TEST=x`")).toEqual(["engine-test"]);
    expect(makeTargetResolves(targets, "engine-test")).toBe(true);
    expect(makeTargetResolves(targets, "engine-tests")).toBe(false);
  });
});

describe("pathResolvesIn (what git can see, not the disk)", () => {
  const entries = new Set([
    "docs", "docs/a.md",
    ".claude", ".claude/agents", ".claude/agents/x.md",
    "eval", "eval/x", "eval/x/research.json",
  ]);

  it("resolves literal files and directories, with or without a trailing slash", () => {
    expect(pathResolvesIn(entries, "docs/a.md")).toBe(true);
    expect(pathResolvesIn(entries, "docs/")).toBe(true);
    expect(pathResolvesIn(entries, "docs/b.md")).toBe(false);
  });

  it("matches a brace or angle placeholder against the real entries", () => {
    expect(pathResolvesIn(entries, ".claude/{agents,commands,skills}")).toBe(true);
    expect(pathResolvesIn(entries, ".claude/agents/<name>.md")).toBe(true);
    expect(pathResolvesIn(entries, "docs/<a><b>/a.md")).toBe(false);
  });

  it("reads ** as zero or more directories, and a trailing ** as needing an entry", () => {
    expect(pathResolvesIn(entries, "eval/**/research.json")).toBe(true);
    expect(pathResolvesIn(entries, "**/a.md")).toBe(true);
    expect(pathResolvesIn(entries, "eval/**/zz.json")).toBe(false);
    expect(pathResolvesIn(entries, "eval/x/**")).toBe(true);
    expect(pathResolvesIn(entries, "eval/x/research.json/**")).toBe(false);
  });

  it("does not see a gitignored file that exists on this checkout", () => {
    expect(pathResolvesIn(entries, "eval/.env")).toBe(false);
  });
});
