import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { countsAgainstFsBudget } from "../../src/utils/fs-budget.js";
import { TOKEN_URL } from "../../src/auth/config.js";
import { join } from "path";

// A spent FamilySearch budget throws a MARKED error, and every retry loop and
// swallow site in the engine decides what to do by calling isFsBudgetExhausted
// on it. A `catch` that rewraps the error in a plain `new Error(...)` destroys
// that marker, and every guard downstream of it silently stops firing -- the
// guard still compiles, still reads as coverage, and can never be true.
//
// That is not hypothetical: four of them shipped at once. image-group.ts,
// source-attachments.ts, match-by-id.ts and volume-search.ts each rewrapped a
// FamilySearch fetch failure, which made the rethrows added above them in
// image-search.ts, rank-search-matches.ts and tree-gaps.ts dead on arrival.
//
// So: any catch block that rewraps a FamilySearch call must let the refusal
// past first. Non-FamilySearch services (wiki, Pop Stats, OpenRouter, the
// matcher service) do not count against the budget and are not matched here.

const SRC = join(import.meta.dirname, "../../src");

// One file legitimately rewraps a FamilySearch call without the guard:
// auth/refresh.ts, whose call is the OAuth token endpoint. That endpoint is
// EXEMPT from the budget (fs-budget.ts), so no refusal can reach its catch.
//
// The exemption is derived, not asserted: if someone makes the OAuth endpoint
// count again, `oauthExempt` goes false, refresh.ts stops being exempt here,
// and this test reds until that catch grows a guard. An allow-list that just
// named the file would silently keep passing.
const oauthExempt = !countsAgainstFsBudget(TOKEN_URL);
const EXEMPT_FILES = oauthExempt ? new Set(["auth/refresh.ts"]) : new Set<string>();

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Block and line comments removed, so commented-out code never counts as code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** The rewrap sites: a `throw new Error(...)` naming a FamilySearch endpoint. */
const REWRAP = /throw new Error\(\s*$|throw new Error\(/;
const NAMES_FS = /Could not reach FamilySearch|FamilySearch session has expired/;

describe("a FamilySearch rewrap lets the budget refusal past first", () => {
  it("every catch that rewraps a FamilySearch failure rethrows the refusal", () => {
    const offenders: string[] = [];

    for (const file of tsFiles(SRC)) {
      // fs-budget.ts defines the marker; it is not a call site.
      if (file.endsWith("/fs-budget.ts")) continue;
      if (EXEMPT_FILES.has(file.slice(SRC.length + 1))) continue;
      const lines = readFileSync(file, "utf-8").split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (!NAMES_FS.test(lines[i])) continue;

        // Walk back to the `catch` that encloses this throw. Bounded: a rewrap
        // sits within a few lines of its catch in this codebase.
        let ci = -1;
        for (let j = i; j >= 0 && i - j <= 12; j--) {
          if (/^\s*\}?\s*catch\s*(\([^)]*\))?\s*\{/.test(lines[j])) {
            ci = j;
            break;
          }
          // A function boundary means this throw is not inside a catch at all.
          if (/^(export )?(async )?function |^\s*\} catch/.test(lines[j]) && j !== i) break;
        }
        if (ci === -1) continue; // not in a catch: a plain throw, not a rewrap

        // Strip comments first. A guard that someone commented out is text
        // that still matches but code that no longer runs, which is the exact
        // shape that makes a lint read as coverage while catching nothing.
        const between = stripComments(lines.slice(ci, i).join("\n"));
        if (!/isFsBudgetExhausted\s*\(/.test(between)) {
          offenders.push(`${file.slice(SRC.length + 1)}:${i + 1} — ${lines[i].trim().slice(0, 70)}`);
        }
      }
    }

    expect(
      offenders,
      "These catch blocks rewrap a FamilySearch failure without first letting a\n" +
        "budget refusal through. Add `if (isFsBudgetExhausted(err)) throw err;` as\n" +
        "the first line of the catch. Without it the marker is destroyed and every\n" +
        "isFsBudgetExhausted guard downstream becomes dead code:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("exempts auth/refresh.ts only while the OAuth endpoint is budget-exempt", () => {
    expect(countsAgainstFsBudget(TOKEN_URL)).toBe(false);
    expect([...EXEMPT_FILES]).toEqual(["auth/refresh.ts"]);
  });

  // The other direction: the check must still accept the legitimate shape, or
  // it gets `skip`ped the first time someone reflows a line.
  it("accepts a guarded catch however it is spelled", () => {
    const guarded = [
      "  } catch (err) {",
      "    if (isFsBudgetExhausted(err)) throw err;",
      "    throw new Error(`Could not reach FamilySearch match API: ${d(err)}.`);",
    ].join("\n");
    const between = guarded.split("\n").slice(0, 2).join("\n");
    expect(/isFsBudgetExhausted\s*\(/.test(between)).toBe(true);

    // ...including with the guard several lines down, behind comments.
    const commented = ["  } catch (error) {", "    // why", "    // more", "    if (isFsBudgetExhausted(error)) throw error;"].join("\n");
    expect(/isFsBudgetExhausted\s*\(/.test(stripComments(commented))).toBe(true);

    // And the inverse: a guard that is ONLY a comment does not count.
    const onlyAComment = ["  } catch (error) {", "    // if (isFsBudgetExhausted(error)) throw error;"].join("\n");
    expect(/isFsBudgetExhausted\s*\(/.test(stripComments(onlyAComment))).toBe(false);
  });
});
