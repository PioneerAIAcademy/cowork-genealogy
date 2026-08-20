import { describe, expect, it } from "vitest";
import { allToolSchemas } from "../../src/tool-schemas.js";

/**
 * Keeps the `*Exact` qualifier family from drifting back into paragraphs.
 *
 * Every character here is a billed prompt token on every call to these two
 * tools, and the family had grown to the point where `record_search` shipped
 * about 15,500 characters of description — roughly four times `person_search`'s
 * — with six `*Exact` toggles over 240 characters each and one at 477. The
 * corpus says the family is barely used: across every committed run log only
 * four of the 43 toggles have EVER appeared in a call, so the paragraphs were
 * being paid for on every request and read by nobody.
 *
 * Issue #1409's shape is the fix: state the rule ONCE in the tool-level
 * description, and give each parameter a one-liner underneath. This test is what
 * stops the next editor from re-expanding a one-liner into a paragraph, which is
 * how it got here.
 *
 * The ceiling is SIZED FROM THE DRAFTED ONE-LINERS, not guessed: the longest one
 * written for #1409 is `record_search.surnameExact` at 205 characters, so 240
 * leaves headroom for a genuinely more complex toggle while still failing every
 * paragraph. Before this test, six toggles exceeded it (477, 404, 377, 343, 271,
 * 257).
 *
 * It deliberately checks only the `*Exact` family. Other parameters carry
 * genuinely load-bearing prose (`projectPath`, `subjectId`, `batchNumber`) whose
 * length is not a smell, and inventing a number for those would be exactly the
 * guess this comment says the ceiling is not.
 */
const CEILING = 240;

/**
 * Exempt, by name and with the reason, so an exemption cannot outlive it.
 *
 * `birthYearExact` is the one toggle whose behaviour is still being measured:
 * the population its current text is phrased around — records with no indexed
 * year — was enumerated at zero, and the index turns out to carry estimated date
 * RANGES instead. Issue #1771 rewrites that paragraph and DELETES this
 * exemption. Do not add an entry here without an issue number and a removal
 * condition.
 */
const EXEMPT = new Map<string, string>([
  [
    "record_search.birthYearExact",
    "behaviour under re-measurement; #1771 rewrites the paragraph and deletes this entry",
  ],
]);

describe("*Exact descriptions stay one-liners", () => {
  const TOOLS = ["record_search", "person_search"];

  for (const toolName of TOOLS) {
    it(`${toolName} keeps every *Exact description under ${CEILING} chars`, () => {
      const schema = allToolSchemas.find((t) => t.name === toolName);
      expect(schema, `${toolName} is not in allToolSchemas`).toBeDefined();
      const props = (schema?.inputSchema as { properties?: Record<string, { description?: string }> })
        ?.properties ?? {};

      const overLong = Object.entries(props)
        .filter(([name]) => /Exact$/.test(name))
        .filter(([name]) => !EXEMPT.has(`${toolName}.${name}`))
        .map(([name, prop]) => ({ name, len: (prop.description ?? "").length }))
        .filter((row) => row.len > CEILING)
        .map((row) => `${row.name}: ${row.len} chars`);

      expect(
        overLong,
        `an *Exact description has grown back into a paragraph.\n` +
          `  The rule these toggles share is stated ONCE in the tool-level\n` +
          `  description (issue #1409); a parameter needs only what is specific to\n` +
          `  it. If a toggle genuinely needs more than ${CEILING} chars, say why in\n` +
          `  EXEMPT with an issue number and a removal condition — do NOT raise the\n` +
          `  ceiling, which is sized from the longest one-liner actually written.`
      ).toEqual([]);
    });
  }

  it("every exemption names a reason and stays reachable", () => {
    const problems: string[] = [];
    for (const [key, reason] of EXEMPT) {
      if (reason.trim().length < 20) problems.push(`${key}: reason too thin`);
      const [tool, param] = key.split(".");
      const schema = allToolSchemas.find((t) => t.name === tool);
      const props = (schema?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {};
      if (!(param in props)) problems.push(`${key}: parameter no longer exists — delete the exemption`);
    }
    expect(
      problems,
      "an exemption is unjustified or stale. A stale one is a permanent pass for a paragraph."
    ).toEqual([]);
  });
});
