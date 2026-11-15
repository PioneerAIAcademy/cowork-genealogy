/**
 * A locality guide saved one section per call (research-append-tool-spec §5.14).
 *
 * `research_append` takes a `guideSection` on a `localities` update: markdown that
 * begins with a `## ` or `### ` heading line. This module places it in the entry's
 * stored `guide_markdown`, in the order of the locality-guide template, replacing a
 * block that carries the same heading.
 */

/** The template's `## ` sections and the `### ` subsections under each, in order.
 *  `tests/packaging/locality-guide-headings.test.ts` fails when the template in
 *  `agents/locality-guide.md` parts from this. A sent heading matches a title here
 *  when it begins with it, ignoring case. */
export const LOCALITY_GUIDE_OUTLINE: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["Jurisdiction overview", []],
  ["Boundary changes", []],
  [
    "Available record types",
    [
      "Vital records",
      "Church records",
      "Census records",
      "Probate and court records",
      "Land records",
      "Military records",
      "Cemetery records",
      "Newspaper records",
      "Immigration/emigration records",
      "Tax records",
      "Other record types",
    ],
  ],
  ["Repository guide", ["Online repositories", "Physical repositories"]],
  ["Records NOT online", []],
  ["Known record losses", []],
  ["Research tips", []],
];

/** The most one `guideSection` may carry. 4 of the 6,716 blocks in the 428 guides
 *  saved in committed runs are longer; a whole guide is 12,000 and up. */
export const GUIDE_SECTION_MAX_CHARS = 4000;

/** The section a `### ` block goes under when the call names none and the
 *  template does not place it. */
const DEFAULT_PARENT = "Available record types";

interface Block {
  level: 2 | 3;
  title: string;
  /** The whole block: its heading line and the text under it, trimmed. */
  text: string;
}

const HEADING = /^(#{2,3})[ \t]+(\S.*?)[ \t]*$/;

const norm = (title: string) => title.toLowerCase().replace(/\s+/g, " ").trim();

/** Split markdown into the text before its first `## `/`### ` line and its blocks. */
function parse(markdown: string): { preamble: string; blocks: Block[] } {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const preamble: string[] = [];
  const blocks: Block[] = [];
  let current: { level: 2 | 3; title: string; lines: string[] } | null = null;
  const close = () => {
    if (current) blocks.push({ level: current.level, title: current.title, text: current.lines.join("\n").trim() });
  };
  for (const line of lines) {
    const m = HEADING.exec(line);
    if (m) {
      close();
      current = { level: m[1].length as 2 | 3, title: m[2], lines: [line.trimEnd()] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  close();
  return { preamble: preamble.join("\n").trim(), blocks };
}

const sectionRank = (title: string): number => {
  const t = norm(title);
  const i = LOCALITY_GUIDE_OUTLINE.findIndex(([s]) => t.startsWith(norm(s)));
  return i < 0 ? Infinity : i;
};

/** The template section a `### ` title belongs under, and its place there. */
function subsectionHome(title: string): { parent: string; rank: number } | null {
  const t = norm(title);
  for (const [section, subs] of LOCALITY_GUIDE_OUTLINE) {
    const i = subs.findIndex((s) => t.startsWith(norm(s)));
    if (i >= 0) return { parent: section, rank: i };
  }
  return null;
}

/** Index of the `## ` block titled `title`, or -1. */
const findSection = (blocks: Block[], title: string): number =>
  blocks.findIndex((b) => b.level === 2 && norm(b.title) === norm(title));

/** One past the last block that belongs to the `## ` block at `at`. */
function sectionEnd(blocks: Block[], at: number): number {
  let end = at + 1;
  while (end < blocks.length && blocks[end].level === 3) end++;
  return end;
}

/** Put a `## ` block in, replacing its heading and intro when the section exists
 *  (its `### ` blocks stay). Returns its index. */
function upsertSection(blocks: Block[], block: Block): number {
  const at = findSection(blocks, block.title);
  if (at >= 0) {
    // A heading sent alone, to carry `### ` blocks, leaves a stored intro as it is.
    if (block.text.includes("\n")) blocks[at] = block;
    return at;
  }
  const rank = sectionRank(block.title);
  let before = blocks.findIndex((b) => b.level === 2 && sectionRank(b.title) > rank);
  if (before < 0) before = blocks.length;
  blocks.splice(before, 0, block);
  return before;
}

/** Put a `### ` block in under `parent`, replacing one with the same heading. */
function upsertSubsection(blocks: Block[], parent: string, block: Block): void {
  const at = upsertSection(blocks, { level: 2, title: parent, text: `## ${parent}` });
  const end = sectionEnd(blocks, at);
  for (let i = at + 1; i < end; i++) {
    if (norm(blocks[i].title) === norm(block.title)) {
      blocks[i] = block;
      return;
    }
  }
  const rank = subsectionHome(block.title)?.rank ?? Infinity;
  let before = at + 1;
  while (before < end && (subsectionHome(blocks[before].title)?.rank ?? Infinity) <= rank) before++;
  blocks.splice(before, 0, block);
}

/**
 * `stored` with the blocks of `sent` placed in it. `titleLine` is the guide's
 * `# ` line, used when neither text has one.
 */
export function mergeGuideSection(
  stored: string | null | undefined,
  sent: string,
  titleLine: string,
): { guide: string } | { error: string } {
  if (sent.length > GUIDE_SECTION_MAX_CHARS) {
    return {
      error:
        `guideSection is ${sent.length} characters; one call carries at most ${GUIDE_SECTION_MAX_CHARS}. ` +
        "Send one '## ' section per call, and each '### ' subsection of a longer section as its own call.",
    };
  }
  const incoming = parse(sent);
  const strayText = incoming.preamble.split("\n").filter((l) => l.trim() !== "" && !/^#[ \t]+\S/.test(l));
  if (incoming.blocks.length === 0 || strayText.length > 0) {
    return {
      error:
        "guideSection must begin with the section's own heading line, '## <title>' or '### <title>', " +
        "with that section's text under it.",
    };
  }
  const current = parse(typeof stored === "string" ? stored : "");
  const blocks = current.blocks;
  let parentInCall: string | null = null;
  for (const block of incoming.blocks) {
    if (block.level === 2) {
      upsertSection(blocks, block);
      parentInCall = block.title;
    } else {
      upsertSubsection(blocks, parentInCall ?? subsectionHome(block.title)?.parent ?? DEFAULT_PARENT, block);
    }
  }
  const preamble = incoming.preamble || current.preamble || titleLine;
  return { guide: [preamble, ...blocks.map((b) => b.text)].filter((t) => t !== "").join("\n\n") };
}
