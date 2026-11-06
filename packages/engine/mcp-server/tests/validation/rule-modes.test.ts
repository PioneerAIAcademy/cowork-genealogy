import { describe, it, expect } from "vitest";
import {
  applyRuleMode,
  RULE_MODES,
  summaryConcern,
  treeConcern,
  WILL_BE_REFUSED,
} from "../../src/validation/rule-modes.js";

describe("rule modes", () => {
  it("a rule in warn mode warns and does not refuse; in refuse mode it refuses", () => {
    const messages = ["the claim names no tree object"];
    const warned = applyRuleMode("warn", summaryConcern("ps_001"), messages);
    expect(warned.errors).toEqual([]);
    expect(warned.warnings).toEqual([
      `${WILL_BE_REFUSED} proof_summaries ps_001: the claim names no tree object`,
    ]);
    const refused = applyRuleMode("refuse", summaryConcern("ps_001"), messages);
    expect(refused).toEqual({ errors: messages, warnings: [] });
  });

  it("names a tree object by its holder and id, so a shared fact id is not ambiguous", () => {
    expect(treeConcern({ personId: "I2", factId: "F1" })).toBe("personId I2, factId F1");
    expect(treeConcern({ relationshipId: "R1", factId: "F1" })).toBe("relationshipId R1, factId F1");
    expect(treeConcern({ personId: "I2", nameId: "N1" })).toBe("personId I2, nameId N1");
    expect(treeConcern({ relationshipId: "R1" })).toBe("relationshipId R1");
  });

  it("every staged rule has a known mode", () => {
    for (const mode of Object.values(RULE_MODES)) expect(["warn", "refuse"]).toContain(mode);
  });
});
