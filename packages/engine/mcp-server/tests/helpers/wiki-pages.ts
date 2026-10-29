/**
 * Synthetic wiki pages for the paging tests, one per shape that makes a cut hard. They are
 * generated, never a copy of a real page: a real page changes when the wiki is edited, and
 * a test of the cut must not change with it. Also the two pieces every paging suite
 * needs: `escapedBody`, what the cap bounds, and `SHAPES`, the three pages each tool is run over.
 */

const line = (i: number, k: number): string =>
  `Line ${i}.${k}: the "indexed" registers at the library, see [the guide](https://example.org/g/${i}/${k}) for the years held.\n`;

/** 50 `##` sections of about 1,300 characters each: a little over 66,000 characters, the
 *  shape of a county page, where a heading is never far away. */
export function headingPage(chars = 66_000, headings = 50): string {
  const perSection = Math.ceil(chars / headings);
  let out = "";
  for (let i = 0; i < headings; i++) {
    let section = `## Heading ${i}\n\n`;
    for (let k = 0; section.length < perSection; k++) section += line(i, k);
    out += `${section}\n`;
  }
  return out;
}

/** One heading, short lines, then a single table row of about 46,000 characters, then more
 *  short lines: the shape of an online-records page, where the row is nine tenths of the
 *  page and there is no heading or line break to cut at inside it. About 53,000 in all. */
export function oneLinePage(rowChars = 46_000): string {
  const before = Array.from({ length: 30 }, (_, i) => `Intro line ${i} about the record collections listed in the table below.\n`).join("");
  let row = "| Collection | Years | Where |";
  for (let i = 0; row.length < rowChars; i++) {
    const yy = String(i % 100).padStart(2, "0");
    row += ` Collection ${i} | 18${yy}-19${yy} | Library ${i} |`;
  }
  const after = Array.from({ length: 50 }, (_, i) => `Closing line ${i} with a [link](https://example.org/${i}) to read on.\n`).join("");
  return `# Online records\n\n${before}${row}\n${after}`;
}

/** 66,000 double quotes: every character serializes to two, so the page is a third of
 *  what a cap on its raw length would let through. */
export function quotePage(chars = 66_000): string {
  return '"'.repeat(chars);
}

/** What the cap bounds: the JSON-escaped body of `s`, the two wrapping quotes excluded. */
export const escapedBody = (s: string): number => JSON.stringify(s).length - 2;

/** The three pages both wiki tools are run over, each with the label its test names carry. */
export const SHAPES: Array<[string, () => string]> = [
  ["about 50 headings over 66,000 characters", () => headingPage()],
  ["one heading and one 46,000-character row", () => oneLinePage()],
  ["66,000 double quotes", () => quotePage()],
];

/** Call a paged tool from the start and follow `nextOffset` until `truncated` is false.
 *  The guard turns a chain that never ends into a failure rather than a hang. */
export async function walkParts<T extends { truncated?: boolean; nextOffset?: number }>(
  call: (offset?: number) => Promise<T>,
  guard = 20,
): Promise<T[]> {
  const parts: T[] = [];
  let offset: number | undefined;
  for (let i = 0; i < guard; i++) {
    const part = await call(offset);
    parts.push(part);
    if (!part.truncated) return parts;
    offset = part.nextOffset;
  }
  throw new Error(`the chain did not end within ${guard} calls`);
}
