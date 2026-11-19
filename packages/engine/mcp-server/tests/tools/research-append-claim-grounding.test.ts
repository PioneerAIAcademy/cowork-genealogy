// Claim rule 7 (grounding) over the claims study's hand-labelled proofs
// (issue #3032 Stage 1b; docs/plan/conclusion-tree.md, Decision 28). Each vector
// is one concluded object, at its labelled tier, citing its proof's full
// supporting set. Built by dev/build-claim-grounding-vectors.ts from
// tests/fixtures/claim-grounding-labels/ and the committed runs they name.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claimGrounding, namedPersons } from "../../src/validation/claim-rules.js";

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "fixtures", "claim-grounding-vectors.json"), "utf-8"),
);
const held = (kind: string) =>
  fixture.vectors.filter((v: any) => v.kind === kind && claimGrounding(v.claim, fixture.proofs[v.label]) !== null);

describe("claim rule 7 over the labelled proofs", () => {
  it("covers the 45 labelled proofs: 89 relationships, 25 facts, 11 couple facts", () => {
    expect(Object.keys(fixture.proofs)).toHaveLength(45);
    const count = (k: string) => fixture.vectors.filter((v: any) => v.kind === k).length;
    expect([count("relationship"), count("fact"), count("couple_fact")]).toEqual([89, 25, 11]);
  });

  it("holds exactly 8 of 89 relationships at possible, each for an unlinked person", () => {
    const rels = held("relationship");
    expect(rels).toHaveLength(8);
    for (const v of rels) expect(claimGrounding(v.claim, fixture.proofs[v.label])).toMatch(/no assertion it cites is linked to/);
  });

  it("holds 0 of 25 facts", () => {
    expect(held("fact")).toHaveLength(0);
  });

  it("holds 1 of 11 couple facts, whose spouse is unlinked", () => {
    const cf = held("couple_fact");
    expect(cf).toHaveLength(1);
    expect(claimGrounding(cf[0].claim, fixture.proofs[cf[0].label])).toMatch(/no assertion it cites is linked to/);
  });

  it("georg-gajdosch-spouse's proved Marriage of 24 January 1714 stands, though no one persona is tied to both spouses", () => {
    const label = Object.keys(fixture.proofs).find((k) =>
      fixture.vectors.some((v: any) => v.label === k && v.kind === "couple_fact" && /24 Jan(uary)? 1714/.test(v.claim.fact.date ?? "")),
    );
    expect(label).toBeDefined();
    const v = fixture.vectors.find((x: any) => x.label === label && x.kind === "couple_fact");
    expect(namedPersons(v.claim)).toEqual(["I2", "K69J-F7Y"]);
    expect(claimGrounding(v.claim, fixture.proofs[v.label])).toBeNull();
  });
});
