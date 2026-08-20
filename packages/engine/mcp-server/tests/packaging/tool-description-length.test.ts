import { describe, expect, it } from "vitest";
import { allToolSchemas } from "../../src/tool-schemas.js";

/**
 * Keeps the `*Exact` qualifier family from drifting back into paragraphs.
 *
 * The family had grown to the point where `record_search` shipped about 15,500
 * characters of description — roughly four times `person_search`'s — with six
 * `*Exact` toggles over 240 characters each and one at 475. The corpus says the
 * family is barely used: across every committed run log only four of the 43
 * toggles have EVER appeared in a call.
 *
 * **The justification is clarity, not token cost.** Measured after the rewrite:
 * `record_search` 15,509 -> 14,286 and `person_search` 3,745 -> 4,918 (its
 * toggles were stubs that were also wrong, so correctness cost tokens there), for
 * a combined 19,254 -> 19,204 — a net saving of about 50 characters. An earlier
 * version of this docstring led with the token argument; it does not survive
 * measurement, and `record_search.birthYearExact` at 475 chars is most of the
 * remaining bulk. What this lint buys is that the shared rule is stated once and
 * cannot silently be re-expanded into 43 paragraphs.
 *
 * Issue #1409's shape is the fix: state the rule ONCE in the tool-level
 * description, and give each parameter a one-liner underneath. This test is what
 * stops the next editor from re-expanding a one-liner into a paragraph, which is
 * how it got here.
 *
 * The ceiling is SIZED FROM THE ONE-LINERS ACTUALLY WRITTEN, not guessed. The
 * two longest non-exempt descriptions are `record_search.givenNameExact` at **238**
 * and `record_search.surnameExact` at **237** — both within three characters of the
 * ceiling. Next is `birthPlaceExact` at 181. Before this change six toggles
 * exceeded the ceiling: 475, 402, 375, 341, 269, 255.
 *
 * **So the ceiling is effectively binding on two descriptions, not one.** A
 * three-word clarification to either trips this lint. When it does, the fix is to
 * shorten it or split a clause out to the spec — NOT to raise the ceiling, and NOT
 * to add an `EXEMPT` entry, which is for a description whose behaviour is under
 * active measurement.
 *
 * **This comment has now been wrong three times about its own basis** — first
 * citing `surnameExact` at 205 with a baseline list uniformly +2 (counting the
 * enclosing quotes); then naming `birthPlaceExact` as longest while quoting a
 * bigger number for `givenNameExact` in the same sentence; then carrying 201/198
 * for two descriptions that a later commit rewrote to 181/237. The cause each time
 * was measuring, then editing the descriptions, then not re-measuring. If you
 * change any `*Exact` description, re-derive these numbers from `allToolSchemas`
 * before touching this comment — it is the only justification for 240, so being
 * wrong here is the same class of defect as guessing the threshold.
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
 * `birthYearExact` is the one toggle whose behaviour is unestablished and under
 * revision (nothing is actively measuring it today):
 * the population its current text is phrased around — records with no indexed
 * year — is reported by a session probe as empty, with the index carrying estimated date
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
      if (!(param in props)) {
        problems.push(`${key}: parameter no longer exists — delete the exemption`);
        continue;
      }
      // The docstring promises an exemption cannot outlive its reason, and only
      // this assertion makes that true. Checking the parameter still EXISTS is
      // not enough: when the description it excuses is rewritten as a one-liner
      // (which is exactly what the issue owning `birthYearExact` will do), a
      // leftover entry becomes a permanent pass for that parameter and nothing
      // goes red. An exemption for a description that already fits is dead.
      const len = ((props[param] as { description?: string }).description ?? "").length;
      if (len <= CEILING) {
        problems.push(
          `${key}: description is ${len} chars, already under the ${CEILING} ceiling — ` +
            `the exemption is dead, delete it`
        );
      }
    }
    expect(
      problems,
      "an exemption is unjustified or stale. A stale one is a permanent pass for a paragraph."
    ).toEqual([]);
  });
});
