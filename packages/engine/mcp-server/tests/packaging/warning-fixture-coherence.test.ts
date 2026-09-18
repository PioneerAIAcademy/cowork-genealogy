// Every person_warnings fixture's cited facts must be able to satisfy that
// warning's own message.
//
// Why this exists: before D6 the facts were bare ids, so nobody could see that a
// "lifespan greater than 120 years" fixture cited a birth and a death 63 years
// apart, or that an "event after death" fixture cited no event after the death.
// The rename puts those dates in front of the judge, and the check-warnings
// rubric tells it to grade the skill's citation against the tool response it can
// now read — so an incoherent fixture marks the skill down for reporting the
// tool faithfully, and costs a paid eval run to discover.
//
// DEPTH: this is the nested check `mcp-fixture-shape.test.ts` cannot make. That
// test compares TOP-LEVEL response keys only, so a nested rename or a nonsense
// date never reaches it.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(__dirname, "../../../../../eval/fixtures/mcp");

interface Fact { id: string; type: string; date: string | null }
interface Warning { issueType: string; facts?: Fact[] }

function fixtures(): Array<{ name: string; warnings: Warning[] }> {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.startsWith("person-warnings-") && f.endsWith(".json"))
    .map((f) => {
      const body = JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf-8"));
      return { name: f, warnings: (body.response?.warnings ?? []) as Warning[] };
    })
    .filter((f) => f.warnings.some((w) => w.facts !== undefined));
}

// Leading year of a date string: "1908-03-12" -> 1908, "~1845" -> 1845.
function year(date: string | null): number | null {
  if (!date) return null;
  const m = /(\d{4})/.exec(date);
  return m ? Number(m[1]) : null;
}
const of = (w: Warning, type: string) => (w.facts ?? []).filter((f) => f.type === type);

describe("person_warnings fixtures are coherent with their own messages", () => {
  it("finds the fixtures", () => {
    // A rename or a move must fail loudly rather than silently checking nothing.
    expect(fixtures().length).toBeGreaterThanOrEqual(9);
  });

  it("every fact entry has exactly id, type and date", () => {
    for (const { name, warnings } of fixtures()) {
      for (const w of warnings) {
        for (const f of w.facts ?? []) {
          expect(Object.keys(f).sort(), `${name} / ${w.issueType}`).toEqual([
            "date", "id", "type",
          ]);
          expect(typeof f.id, `${name} / ${w.issueType}`).toBe("string");
          expect(typeof f.type, `${name} / ${w.issueType}`).toBe("string");
        }
      }
    }
  });

  it("a >120 lifespan warning cites facts more than 120 years apart", () => {
    for (const { name, warnings } of fixtures()) {
      for (const w of warnings.filter((x) => /AgeRangeGreaterThan120/.test(x.issueType))) {
        const births = (w.facts ?? []).filter((f) => /Birth|Christening|Baptism/.test(f.type));
        const deaths = (w.facts ?? []).filter((f) => /Death|Burial|Probate|Will/.test(f.type));
        // A relative-scoped warning may cite only the relative's birth; the span
        // is asserted by the tool, not derivable. Only check when both ends are cited.
        if (births.length === 0 || deaths.length === 0) continue;
        const b = year(births[0].date), d = year(deaths[deaths.length - 1].date);
        if (b === null || d === null) continue;
        expect(d - b, `${name} / ${w.issueType} spans ${d - b} years`).toBeGreaterThan(120);
      }
    }
  });

  it("an event-after-death warning cites an event dated after the death", () => {
    for (const { name, warnings } of fixtures()) {
      for (const w of warnings.filter((x) => /EventAfterDeath/.test(x.issueType))) {
        const deaths = of(w, "Death");
        expect(deaths.length, `${name}: no Death fact cited`).toBeGreaterThan(0);
        const dy = year(deaths[0].date);
        const after = (w.facts ?? []).some((f) => {
          const y = year(f.date);
          return f.type !== "Death" && y !== null && dy !== null && y > dy;
        });
        expect(after, `${name}: no cited fact is dated after the death`).toBe(true);
      }
    }
  });

  it("a two-death-dates warning cites two death facts", () => {
    for (const { name, warnings } of fixtures()) {
      for (const w of warnings.filter((x) => /tooManyDeathDates/.test(x.issueType))) {
        expect(of(w, "Death").length, `${name} / ${w.issueType}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("a before-birth / before-death warning cites the earlier fact as earlier", () => {
    const pairs: Array<[RegExp, string, string]> = [
      [/ChristeningBeforeBirth/, "Christening", "Birth"],
      [/BurialBeforeDeath/, "Burial", "Death"],
    ];
    for (const { name, warnings } of fixtures()) {
      for (const w of warnings) {
        for (const [re, early, late] of pairs) {
          if (!re.test(w.issueType)) continue;
          const e = year(of(w, early)[0]?.date ?? null);
          const l = year(of(w, late)[0]?.date ?? null);
          expect(e, `${name}: no ${early} cited`).not.toBeNull();
          expect(l, `${name}: no ${late} cited`).not.toBeNull();
          expect(e!, `${name}: ${early} ${e} is not before ${late} ${l}`).toBeLessThan(l!);
        }
      }
    }
  });
});
