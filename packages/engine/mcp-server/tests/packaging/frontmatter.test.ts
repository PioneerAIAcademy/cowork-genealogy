import { describe, it, expect } from "vitest";
import { extractList } from "./frontmatter.js";

/**
 * `extractList` is the left-hand reading of two packaging guards:
 * `agent-tool-names.test.ts` (spellings) and `ownership-manifest.test.ts`
 * ("names every plugin holder of a writer tool"). Both compare what it returns
 * against a declaration, so an entry it drops or mangles is a grant that stops
 * being compared — and both guards then PASS.
 *
 * That is why the parser has tests of its own rather than being covered only
 * through its callers: through a caller, the failure it has to be proven
 * against is a silent green.
 */

/** Frontmatter + a body, in the shape the plugin files actually carry. */
function doc(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n\nbody text\n`;
}

describe("extractList — entries survive the shapes that reach these lists", () => {
  it("drops a trailing comment and keeps the entry", () => {
    // The shape that fails open. `mcp__genealogy__tree_forget  # practice mode`
    // parsed whole matches no tool name, so the ownership guard stops seeing
    // the grant. Proven against the live tree: granting a skill a writer tool
    // this way left the whole packaging suite green.
    const entries = extractList(
      doc(
        [
          "allowed-tools:",
          "  - mcp__genealogy__tree_forget  # practice mode only",
          "  - mcp__genealogy__research_append # single space before the hash",
          "  - validate_research_schema",
        ].join("\n"),
      ),
      "allowed-tools",
    );
    expect(entries).toEqual([
      "mcp__genealogy__tree_forget",
      "mcp__genealogy__research_append",
      "validate_research_schema",
    ]);
  });

  it("leaves a legitimate entry byte-identical", () => {
    // The other direction. A guard that over-trims is the same bug pointing the
    // other way: it would strip a real entry down to something that resolves to
    // nothing, and both callers would start reporting drift that is not there.
    const entries = extractList(
      doc(
        [
          "tools:",
          "  - mcp__genealogy__record_read",
          "  - mcp__remote-devices__Genealogy_Research__record_read",
          "  - mcp__Genealogy_Research__record_read",
          "  - Read",
          "  - Bash(npm run test:*)",
          "  - WebFetch(domain:familysearch.org)",
        ].join("\n"),
      ),
      "tools",
    );
    expect(entries).toEqual([
      "mcp__genealogy__record_read",
      "mcp__remote-devices__Genealogy_Research__record_read",
      "mcp__Genealogy_Research__record_read",
      "Read",
      "Bash(npm run test:*)",
      "WebFetch(domain:familysearch.org)",
    ]);
  });

  it("reads past a leading comment block inside the list", () => {
    // `record-extractor.md`'s live shape: a 10-line `#` block sits between
    // `tools:` and the first entry. A scan that stops at the first line which
    // is not `- …` reads zero grants for that agent.
    const entries = extractList(
      doc(
        [
          "tools:",
          "  # Listed under all three server spellings: `genealogy`,",
          "  # `remote-devices__Genealogy_Research`, and `Genealogy_Research`.",
          "  - mcp__genealogy__extraction_append",
        ].join("\n"),
      ),
      "tools",
    );
    expect(entries).toEqual(["mcp__genealogy__extraction_append"]);
  });

  it("stops at the next top-level key but not at an unindented comment", () => {
    // Several skills put `description:` after `allowed-tools:`, so the list has
    // to end — and the entry under `description` must not be swept in.
    const entries = extractList(
      doc(
        [
          "allowed-tools:",
          "  - mcp__genealogy__research_append",
          "# an unindented comment is not the next key",
          "  - mcp__genealogy__research_log_append",
          "description: >-",
          "  - not an entry, part of a folded scalar",
        ].join("\n"),
      ),
      "allowed-tools",
    );
    expect(entries).toEqual([
      "mcp__genealogy__research_append",
      "mcp__genealogy__research_log_append",
    ]);
  });

  it("returns [] for an absent key and throws with no frontmatter", () => {
    // The two outcomes a caller must be able to tell apart: `[]` is "declares
    // none, truthfully", which `ownership-manifest.test.ts` keys its emptiness
    // guard on. A file with no frontmatter is malformed, not empty.
    expect(extractList(doc("name: some-skill"), "allowed-tools")).toEqual([]);
    expect(() => extractList("no frontmatter here\n", "tools")).toThrow(
      "no YAML frontmatter",
    );
  });
});
