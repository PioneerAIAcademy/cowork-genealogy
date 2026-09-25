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

  it("unquotes a quoted entry and yields the bare name", () => {
    // The trailing-comment failure one shape over. `"tree_forget"` kept its
    // quotes, matched no tool name, and the ownership guard passed: proven on
    // `search-wikipedia`, where the plain grant reds and the quoted one left
    // the packaging suite green.
    const entries = extractList(
      doc(
        [
          "allowed-tools:",
          '  - "tree_forget"',
          "  - 'mcp__genealogy__research_append'",
          '  - "mcp__genealogy__tree_edit"  # quoted and commented',
        ].join("\n"),
      ),
      "allowed-tools",
    );
    expect(entries).toEqual([
      "tree_forget",
      "mcp__genealogy__research_append",
      "mcp__genealogy__tree_edit",
    ]);
  });

  it("reads a quoted scalar as a unit, so a ` #` inside it is not a comment", () => {
    // YAML ends a PLAIN scalar at ` #`, but a quoted one runs to its closing
    // quote. Cutting inside the quotes left `"foo` — unpaired, so it kept its
    // quote and matched nothing.
    const entries = extractList(
      doc(
        [
          "tools:",
          '  - "foo #bar"',
          "  - 'it''s'",
          "  - 'foo #bar'  # a real comment after the closing quote",
        ].join("\n"),
      ),
      "tools",
    );
    expect(entries).toEqual(["foo #bar", "it's", "foo #bar"]);
  });

  it("still ends a plain scalar at ` #`, as YAML does", () => {
    // The over-correction to avoid. A plain entry containing quotes is not a
    // quoted scalar, so YAML's plain-scalar comment rule applies to it.
    const entries = extractList(doc(['tools:', '  - Bash(echo "a #b")'].join("\n")), "tools");
    expect(entries).toEqual(['Bash(echo "a']);
  });

  it("reads a block sequence written at the key's own indent", () => {
    // Valid YAML, and read as empty by a scan that stopped at every
    // unindented line.
    const entries = extractList(
      doc(["tools:", "- Read", "- mcp__genealogy__record_read", "name: x"].join("\n")),
      "tools",
    );
    expect(entries).toEqual(["Read", "mcp__genealogy__record_read"]);
  });

  it("reads a flow sequence and the comma form on the key line", () => {
    // `tools: Read, Grep` is the documented subagent form; `[a, b]` is YAML's
    // flow sequence. Each read as `[]` before, and an empty read passes both
    // guards that call this.
    expect(extractList(doc('tools: [Read, "tree_forget"]  # flow'), "tools")).toEqual([
      "Read",
      "tree_forget",
    ]);
    expect(extractList(doc("tools: Read, mcp__genealogy__tree_forget"), "tools")).toEqual([
      "Read",
      "mcp__genealogy__tree_forget",
    ]);
    expect(extractList(doc("allowed-tools: tree_forget"), "allowed-tools")).toEqual([
      "tree_forget",
    ]);
  });

  it("strips only a matching outer pair of quotes", () => {
    // The over-trim direction. An unpaired or mismatched quote is not a quoted
    // scalar, and a quote inside an entry belongs to the entry.
    const entries = extractList(
      doc(
        [
          "tools:",
          '  - "tree_forget',
          "  - \"tree_forget'",
          '  - Bash(echo "x")',
        ].join("\n"),
      ),
      "tools",
    );
    expect(entries).toEqual(['"tree_forget', "\"tree_forget'", 'Bash(echo "x")']);
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
