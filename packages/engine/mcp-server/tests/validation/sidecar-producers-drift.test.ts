import { describe, it, expect } from "vitest";
import {
  PERSONA_BEARING_PRODUCERS,
  NO_PERSONA_REASON,
  stagesPersonas,
} from "../../src/validation/sidecar-producers.js";
import { STAGING_CAPABLE_TOOLS } from "../../src/tools/research-log-append.js";

/**
 * The persona-bearing whitelist must classify every staging producer, and only
 * those.
 *
 * `research_log_append` decides which tools get a results sidecar; the D2 write
 * check and the D5 persisted check decide which of those sidecars can hold a
 * persona. Those were two independent copies of one list — and a third,
 * `personaReachable`, which hardcoded `tool === "record_search"` in the same
 * file that imports this module. The `record_read` case is deliberately outside
 * this set: it stages no sidecar, and its persona is reachable by re-reading the
 * record rather than by opening one.
 *
 * The dangerous direction FAILS OPEN. A fourth staging producer that returns
 * GedcomX, added to `STAGING_CAPABLE_TOOLS` alone, is silently treated as
 * carrying no personas: every legitimate `record_persona_id` on an assertion
 * sourced from it is hard-rejected, and `personaReachable` independently marks
 * it unreachable, suppressing the match-score advisory. Neither shows up as a
 * missing check — both look like working refusals.
 */
describe("the persona-bearing whitelist tracks the staging producers", () => {
  it("classifies every staging-capable tool exactly once", () => {
    const classified = new Set([...PERSONA_BEARING_PRODUCERS, ...Object.keys(NO_PERSONA_REASON)]);
    const unclassified = [...STAGING_CAPABLE_TOOLS].filter((t) => !classified.has(t)).sort();
    const orphaned = [...classified].filter((t) => !STAGING_CAPABLE_TOOLS.has(t)).sort();
    expect(
      { unclassified, orphaned },
      "a staging producer with no classification is treated as persona-less, which " +
        "hard-rejects every legitimate record_persona_id sourced from it — decide " +
        "which side it belongs on in src/validation/sidecar-producers.ts",
    ).toEqual({ unclassified: [], orphaned: [] });
  });

  it("puts each tool on exactly one side", () => {
    const both = [...PERSONA_BEARING_PRODUCERS].filter((t) => t in NO_PERSONA_REASON);
    expect(both, "a tool cannot both stage personas and carry a no-persona reason").toEqual([]);
  });

  it("stagesPersonas answers for the whole set, and rejects an unknown tool", () => {
    for (const t of STAGING_CAPABLE_TOOLS) {
      expect(stagesPersonas(t), t).toBe(PERSONA_BEARING_PRODUCERS.has(t));
    }
    // Fails safe: unclassified, null, and a non-string all read as "no personas".
    expect(stagesPersonas("some_future_search")).toBe(false);
    expect(stagesPersonas(undefined)).toBe(false);
    expect(stagesPersonas(null)).toBe(false);
    expect(stagesPersonas(42)).toBe(false);
    expect(stagesPersonas({ tool: "record_search" })).toBe(false);
  });
});
