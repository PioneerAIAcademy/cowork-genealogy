import { describe, it, expect } from "vitest";
import {
  cutAtBoundary,
  fitPage,
  pageText,
  requireWholeNumber,
  type TextPaging,
} from "../../src/utils/text-page.js";
import { escapedBody } from "../helpers/wiki-pages.js";

/** The rule on its own: a page of `n` raw characters from `offset`, moved back to a boundary.
 *  (`fitPage` bounds the ESCAPED body and a line break escapes to two characters, so its page
 *  is shorter than `n` whenever the text has line breaks; these cases fix the page by hand.) */
const cut = (text: string, n: number, offset = 0): string =>
  cutAtBoundary(text, offset, text.slice(offset, offset + n));

/** What the tools do: `fitPage`'s page for `offset`, then moved back to a boundary. */
const part = (text: string, maxChars: number, offset = 0): string =>
  cutAtBoundary(text, offset, fitPage(text, offset, maxChars));

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("requireWholeNumber", () => {
  it("returns a whole number at or above the minimum, the minimum included", () => {
    expect(requireWholeNumber("offset", 0, 0)).toBe(0);
    expect(requireWholeNumber("offset", 7, 0)).toBe(7);
    expect(requireWholeNumber("maxChars", 1, 1)).toBe(1);
  });

  it.each([
    ["a string", "5", '"5"'],
    ["a negative number", -1, "-1"],
    ["a fraction", 1.5, "1.5"],
    ["NaN", Number.NaN, "NaN"],
    ["Infinity", Number.POSITIVE_INFINITY, "Infinity"],
    ["null", null, "null"],
  ])("rejects %s and names the value it got", (_label, value, got) => {
    expect(() => requireWholeNumber("offset", value, 0)).toThrow(
      `offset must be a whole number ≥ 0 (got ${got}). Send it as a number, not a string.`,
    );
  });

  it("applies the minimum it is given", () => {
    expect(() => requireWholeNumber("maxChars", 0, 1)).toThrow(
      /maxChars must be a whole number ≥ 1 \(got 0\)/,
    );
  });
});

describe("fitPage", () => {
  it("returns plain text up to maxChars exactly, and all of a shorter text", () => {
    expect(fitPage("x".repeat(500), 0, 100)).toBe("x".repeat(100));
    expect(fitPage("x".repeat(500), 450, 100)).toBe("x".repeat(50));
    expect(fitPage("short", 0, 100)).toBe("short");
  });

  it("holds its bound on the caller's maxChars, not on a fixed constant", () => {
    // A quote escapes to two characters and a control character to six. The two other
    // callers cap at 40,000, so a loop reading that constant passes every one of
    // those tests and fails only here, where the cap is 100.
    expect(fitPage('"'.repeat(1000), 0, 100)).toBe('"'.repeat(50));
    expect(fitPage("\u0001".repeat(1000), 0, 100)).toBe("\u0001".repeat(16));
    expect(fitPage("\\".repeat(1000), 0, 100)).toBe("\\".repeat(50));
    for (const maxChars of [7, 40, 100, 999]) {
      for (const unit of ['"', "\\", "\n", "\u0001", "ab\"", "é"]) {
        const page = fitPage(unit.repeat(2000), 0, maxChars);
        expect(escapedBody(page), `${JSON.stringify(unit)} x ${maxChars}`).toBeLessThanOrEqual(maxChars);
      }
    }
  });

  it("never returns an empty page, even when one unit escapes to more than maxChars", () => {
    // A control character or a lone surrogate escapes to six characters, so with a cap
    // under six not even one fits. The page is never cut below one unit: an empty page
    // would leave nextOffset where it started and a caller paging until `truncated`
    // is false would never finish.
    const texts = ["\u0001".repeat(10), "\uD83D".repeat(10), "\uDE00".repeat(10), "😀".repeat(10), "a😀b😀c"];
    for (const text of texts) {
      for (let maxChars = 1; maxChars <= 5; maxChars++) {
        for (let offset = 0; offset < text.length; offset++) {
          const page = fitPage(text, offset, maxChars);
          expect(page.length, `${JSON.stringify(text)} @${offset} max ${maxChars}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps a surrogate pair whole under a maxChars below six", () => {
    const pairs = "😀😀😀"; // three pairs: six units
    expect(fitPage(pairs, 0, 1)).toBe("😀"); // the one pair, two units: the documented exception
    expect(fitPage(pairs, 0, 2)).toBe("😀");
    expect(fitPage(pairs, 0, 3)).toBe("😀"); // a pair and half the next: the half is cut back
    expect(fitPage(pairs, 0, 4)).toBe("😀😀");
    expect(fitPage("a😀b", 1, 1)).toBe("😀"); // an offset on the pair, maxChars 1: forward, not empty
    expect(fitPage("abcd😀e", 0, 5)).toBe("abcd");
  });

  it("reads past the end as an empty page", () => {
    expect(fitPage("abc", 3, 10)).toBe("");
    expect(fitPage("abc", 99, 10)).toBe("");
  });
});

/** The cut rule as it was first coded, two backward scans with no string search. The shipped
 *  function finds the heading with `lastIndexOf`; this is the rule it must agree with. */
function cutByScan(text: string, offset: number, page: string): string {
  if (offset + page.length >= text.length) return page;
  const midpoint = page.length / 2;
  for (let cut = page.length; cut > midpoint; cut--) {
    if (text[offset + cut] === "#" && text[offset + cut - 1] === "\n") return page.slice(0, cut);
  }
  for (let at = page.length - 1; at > midpoint; at--) {
    if (page[at] === "\n") return page.slice(0, at + 1);
  }
  return page;
}

describe("cutAtBoundary", () => {
  it("agrees with the rule written as two backward scans, on every short text of # \\n a and a surrogate pair", () => {
    // Every text of up to six of these four pieces, every offset into it (an offset right after a
    // line break, where the "\n#" straddles the start of the page, included) and every page length.
    const pieces = ["#", "\n", "a", "😀"];
    const mismatches: string[] = [];
    let cases = 0;
    const walk = (text: string, piecesLeft: number): void => {
      for (let offset = 0; offset <= text.length; offset++) {
        for (let n = 0; offset + n <= text.length; n++) {
          const page = text.slice(offset, offset + n);
          if (cutAtBoundary(text, offset, page) !== cutByScan(text, offset, page)) {
            mismatches.push(JSON.stringify({ text, offset, n }));
          }
          cases++;
        }
      }
      if (piecesLeft > 0) for (const piece of pieces) walk(text + piece, piecesLeft - 1);
    };
    walk("", 6);
    expect(mismatches.slice(0, 3)).toEqual([]);
    expect(cases).toBeGreaterThan(100_000);
  });

  it("moves the end back to the last heading line that starts past the midpoint", () => {
    // 30 characters fit; the heading starts at 20 and a later line break sits at 29.
    const text = "aaaaaaaaa\nbbbbbbbbb\n## Head\nxxxxx\nyyyyyyyyyy";
    expect(cut(text, 30)).toBe(text.slice(0, 20));
    expect(text[20]).toBe("#");
  });

  it("ignores a heading in the first half and uses the last line break instead", () => {
    const text = "ab\n## H1\ncccccccc\ndddddd\neeeeeeeeeeeeeeeeeeee";
    // the heading starts at 3, before the midpoint (15); the last \n past it is at 24
    expect(cut(text, 30)).toBe(text.slice(0, 25));
  });

  it("treats a heading exactly at the midpoint as not past it, and one unit later as past it", () => {
    const atMidpoint = "a".repeat(14) + "\n## H\ncccccccc\ndddddddddddddddd";
    expect(atMidpoint[15]).toBe("#");
    expect(cut(atMidpoint, 30)).toBe(atMidpoint.slice(0, 29)); // falls to the line break at 28
    const pastMidpoint = "a".repeat(15) + "\n## H\nccccccc\ndddddddddddddddd";
    expect(pastMidpoint[16]).toBe("#");
    expect(cut(pastMidpoint, 30)).toBe(pastMidpoint.slice(0, 16));
  });

  it("treats a line break exactly at the midpoint as not past it, and one unit later as past it", () => {
    const atMidpoint = "a".repeat(15) + "\n" + "b".repeat(40);
    expect(atMidpoint[15]).toBe("\n");
    expect(cut(atMidpoint, 30)).toBe(atMidpoint.slice(0, 30)); // nothing past the midpoint: unchanged
    const pastMidpoint = "a".repeat(16) + "\n" + "b".repeat(40);
    expect(pastMidpoint[16]).toBe("\n");
    expect(cut(pastMidpoint, 30)).toBe(pastMidpoint.slice(0, 17));
  });

  it("uses the last line break past the midpoint when no heading qualifies", () => {
    const text = "aaaaaaaaaa\nbbbbbbbbbb\ncccccccccccccccccccc";
    expect(cut(text, 30)).toBe(text.slice(0, 22));
  });

  it("does not take a # in the middle of a line for a heading", () => {
    const text = "aaaaaaaaaa\nbbbbb#bbb\ncccccccccccccccccccccccc";
    expect(text[16]).toBe("#");
    expect(cut(text, 30)).toBe(text.slice(0, 21)); // the line break, not the #
  });

  it("finds a heading after a CRLF", () => {
    const text = "aaaaaaaa\r\nbbbbbbbb\r\n## H\r\ncccccccccccccccc";
    expect(cut(text, 30)).toBe(text.slice(0, 20));
  });

  it("leaves the cut where fitPage made it when there is no line break or heading past the midpoint", () => {
    // one heading, then a single row far longer than the cap: nothing to move back to
    const text = "# Online records\n" + "x".repeat(200);
    expect(cut(text, 40)).toBe(text.slice(0, 40));
  });

  it("keeps a cut that already falls at the start of a heading line", () => {
    // fitPage's page ends exactly where `## Two` begins; an earlier heading lies inside
    // the page past its midpoint. Moving back to it would shorten the page for nothing.
    const text = "aaaaaaaa\nbbbbbbbb\n## One\ncccc\n## Two\nrest of the text goes on";
    expect(text[30]).toBe("#");
    expect(text[29]).toBe("\n");
    expect(text.indexOf("## One")).toBe(18);
    expect(cut(text, 30)).toBe(text.slice(0, 30));
  });

  it("does not take a heading line that starts after the end of the page", () => {
    // the page ends one character before the line break that precedes `## H`: that heading is
    // not in the page, so the cut falls back to the last line break inside it
    const text = "aaaaaaaaa\nbbbbbbbbb\ncccc\n## H\nrest of the text";
    expect(text.slice(24, 26)).toBe("\n#");
    expect(cut(text, 24)).toBe(text.slice(0, 20));
  });

  it("never cuts back the last page of a text", () => {
    const text = "aaaaaaaaaa\n## H\nbbbb";
    expect(cutAtBoundary(text, 0, text)).toBe(text);
    expect(cutAtBoundary(text, 11, text.slice(11))).toBe(text.slice(11));
  });

  it("works from a non-zero offset", () => {
    const head = "zzzzzzzzzz\n";
    const text = head + "aaaaaaaaa\nbbbbbbbbb\n## Head\nxxxxx\nyyyyyyyyyy";
    expect(cut(text, 30, head.length)).toBe(text.slice(head.length, head.length + 20));
  });

  it("never ends a page inside a surrogate pair", () => {
    const text = "😀".repeat(8) + "\n## H\n" + "😀".repeat(10);
    for (let maxChars = 1; maxChars <= text.length; maxChars++) {
      const cut = part(text, maxChars);
      expect(LONE_SURROGATE.test(cut), `maxChars ${maxChars}`).toBe(false);
    }
  });
});

describe("pageText", () => {
  it("returns the bare content for a text that fits when no offset was passed", () => {
    expect(pageText("hello", undefined, 100)).toStrictEqual({ content: "hello" });
  });

  it("adds paging, and no nextOffset, when an offset was passed on a text that fits", () => {
    const r = pageText("hello", 0, 100);
    expect(r).toStrictEqual({ content: "hello", paging: { totalChars: 5, offset: 0, truncated: false } });
    expect(Object.keys(r.paging as TextPaging)).toEqual(["totalChars", "offset", "truncated"]);
  });

  it("reports a truncated part with nextOffset where the content ends", () => {
    const text = "x".repeat(250);
    const r = pageText(text, undefined, 100);
    expect(r.content).toBe("x".repeat(100));
    expect(r.paging).toStrictEqual({ totalChars: 250, offset: 0, truncated: true, nextOffset: 100 });
    const last = pageText(text, 200, 100);
    expect(last.content).toBe("x".repeat(50));
    expect(last.paging).toStrictEqual({ totalChars: 250, offset: 200, truncated: false });
  });

  it("reads an offset at or past the end as an empty part that is not truncated", () => {
    expect(pageText("abc", 3, 10)).toStrictEqual({
      content: "",
      paging: { totalChars: 3, offset: 3, truncated: false },
    });
    expect(pageText("abc", 1_000_000, 10)).toStrictEqual({
      content: "",
      paging: { totalChars: 3, offset: 3, truncated: false },
    });
    expect(pageText("", 0, 10)).toStrictEqual({ content: "", paging: { totalChars: 0, offset: 0, truncated: false } });
  });

  it("holds a text exactly at the cap whole, and pages one unit more", () => {
    expect(pageText("x".repeat(100), undefined, 100)).toStrictEqual({ content: "x".repeat(100) });
    const over = pageText("x".repeat(101), undefined, 100);
    expect(over.content).toBe("x".repeat(100));
    expect(over.paging?.truncated).toBe(true);
  });

  it("bounds a text by its escaped body, not by its length", () => {
    // 100 characters, but every second one is a line break that serializes to two
    const text = "a\n".repeat(50);
    expect(text.length).toBe(100);
    expect(escapedBody(text)).toBe(150);
    const r = pageText(text, undefined, 100);
    expect(r.paging?.truncated).toBe(true);
    expect(escapedBody(r.content)).toBeLessThanOrEqual(100);
  });

  it("walks every shape to the end and joins back to the text, from any offset and at any cap", () => {
    // A deterministic spread of line breaks, headings, quotes, control characters,
    // surrogate pairs and CRLFs. The property, not an example: every part advances,
    // stays inside its cap (bar a single character that cannot fit), and the parts
    // join to exactly the text, so no cut-back rule can lose or repeat a character.
    let seed = 12345;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const alphabet = ["a", "b", " ", "\n", "\n", "#", "# ", "\n# ", '"', "\\", "\u0001", "😀", "é", "\r\n"];
    let chains = 0;
    for (let t = 0; t < 60; t++) {
      const length = Math.floor(rand() * 60);
      const text = Array.from({ length }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
      for (const maxChars of [1, 2, 3, 5, 8, 13, 30]) {
        for (const start of [undefined, 0, Math.floor(rand() * (text.length + 1)), text.length]) {
          const parts: Array<{ content: string; paging?: TextPaging }> = [];
          let offset = start;
          let ended = false;
          for (let guard = 0; guard <= text.length + 2; guard++) {
            const p = pageText(text, offset, maxChars);
            parts.push(p);
            if (!p.paging?.truncated) {
              ended = true;
              break;
            }
            expect(p.content.length, "a truncated part must advance").toBeGreaterThan(0);
            expect(p.paging.nextOffset).toBe(p.paging.offset + p.content.length);
            offset = p.paging.nextOffset;
          }
          const label = `${JSON.stringify(text)} max ${maxChars} from ${start}`;
          expect(ended, `ends: ${label}`).toBe(true);
          expect(parts.map((p) => p.content).join(""), label).toBe(text.slice(start ?? 0));
          for (const p of parts) {
            expect(escapedBody(p.content) <= maxChars || [...p.content].length === 1, label).toBe(true);
          }
          if (start === undefined || start === 0) {
            for (const p of parts) expect(LONE_SURROGATE.test(p.content), label).toBe(false);
          }
          chains++;
        }
      }
    }
    expect(chains).toBeGreaterThan(1000);
  });
});
