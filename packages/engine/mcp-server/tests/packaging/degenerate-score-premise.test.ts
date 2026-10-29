import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Refuted-premise lint (issue #1529, folded into issue #2486 item C).
 *
 * The premise: a tree person with no FamilySearch ARK (a locally-minted stub,
 * an id `same_person` cannot resolve) returns a degenerate near-zero
 * `same_person` score that the skill must treat as "no score available". It was
 * refuted by probing the live API (`dev/probe-same-person-local-id.ts`: the
 * ARK-less focus person scores 0.9999484 against a 0.999967 control, after the
 * 2026-07-07 match-engine mint-hardening). It spread across skill bodies,
 * fixtures, specs and an ADR for five weeks with `make engine-test` green, and
 * every instance was found by reading.
 *
 * Keyed on the PROPOSITION, not the word: `degenerate` is the ranker's own
 * vocabulary (its score floor) and a plain usage elsewhere. A sentence fails
 * only when it joins a cause (no/missing ARK, ark-less, unresolvable id,
 * locally-minted or local stub) to a conclusion (a degenerate or near-zero
 * score, "no score available", unscorable). Each paragraph is whitespace-joined
 * before it is split into sentences, so a reflowed sentence is still one
 * sentence, and fenced blocks are scanned like prose.
 *
 * Allow-list entries quote the claim in order to refute it. They are keyed on
 * the sentence TEXT, never a line number, because these are actively edited
 * specs whose line numbers drift within days; and every entry must still match
 * something, so a reword fails loudly instead of silently widening the list.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");

/** Surfaces a model reads, or that a person would copy the claim out of. */
const GATED_ROOTS = [
  "packages/engine/plugin",
  "eval/tests",
  "eval/fixtures",
  "docs/specs",
  "docs/adrs",
];
const EXTENSIONS = [".md", ".json"];

const CAUSE =
  /\b(ark-?less|(no|missing|without|lacking|lacks)\s+(an?\s+)?(full\s+)?(familysearch\s+)?ark\b|ark:\s*null|unresolvable\s+(tree\s+)?id|locally[-\s]minted|local\s+stubs?\b|minted\s+stubs?\b)/i;
const CONCLUSION =
  /\b(degenerate\s+(`?same_person`?\s+)?(near-zero\s+)?(score|band)|scores?\s+(would|will|must)?\s*(be|is|are)\s+degenerate|near-zero\s+score|no\s+score\s+available|treat\w*\s+(that|it|this)?\s*as\s+\**no\s+score|unscor(e)?able|cannot\s+be\s+scored)/i;

interface Hit {
  relPath: string;
  lineNo: number;
  sentence: string;
}

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTENSIONS.some((e) => name.endsWith(e))) out.push(p);
  }
}

function discover(): string[] {
  const files: string[] = [];
  for (const root of GATED_ROOTS) walk(join(repoRoot, root), files);
  return files;
}

/** Sentences of one file, each with the line its paragraph starts on. */
export function sentencesOf(text: string): { lineNo: number; sentence: string }[] {
  const lines = text.split(/\r?\n/);
  const out: { lineNo: number; sentence: string }[] = [];
  let start = -1;
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    const para = buf.join(" ").replace(/\s+/g, " ").trim();
    for (const s of para.split(/(?<=[.!?])\s+/)) {
      if (s) out.push({ lineNo: start + 1, sentence: s });
    }
    buf = [];
    start = -1;
  };
  lines.forEach((line, i) => {
    if (line.trim() === "") {
      flush();
      return;
    }
    if (start < 0) start = i;
    buf.push(line);
  });
  flush();
  return out;
}

export function premiseHits(text: string, relPath: string): Hit[] {
  return sentencesOf(text)
    .filter(({ sentence }) => CAUSE.test(sentence) && CONCLUSION.test(sentence))
    .map(({ lineNo, sentence }) => ({ relPath, lineNo, sentence }));
}

/**
 * Sentences that state the premise in order to refute or retire it. `phrase`
 * must appear in the matched sentence; each entry needs a reason.
 */
const ALLOWLIST: Array<{ relPath: string; phrase: string; reason: string }> = [
  {
    relPath: "docs/specs/guardrail-enforcement-spec.md",
    phrase: "I2 are local stubs with no FamilySearch ARK, so any score would be degenerate",
    reason: "quotes a failed run's stated reason as the evidence the claim was acted on",
  },
  {
    relPath: "docs/specs/guardrail-enforcement-spec.md",
    phrase: "The same skill also says a locally-minted stub returns a degenerate score",
    reason: "dates the stale guidance and records that it was superseded",
  },
  {
    relPath: "docs/specs/guardrail-enforcement-spec.md",
    phrase: "that a locally-minted stub returns a degenerate score — was **refuted by probing the live API**",
    reason: "labels the claim refuted by live probing",
  },
];

const files = discover();
const hits: Hit[] = files.flatMap((abs) =>
  premiseHits(readFileSync(abs, "utf8"), relative(repoRoot, abs).split("\\").join("/")),
);
const allowedBy = (h: Hit) =>
  ALLOWLIST.find((a) => a.relPath === h.relPath && h.sentence.includes(a.phrase));

describe("refuted premise: a missing ARK yields a degenerate same_person score", () => {
  it("scans every gated root", () => {
    for (const root of GATED_ROOTS) {
      expect(
        files.some((f) => relative(repoRoot, f).split("\\").join("/").startsWith(root + "/")),
        root,
      ).toBe(true);
    }
  });

  it("no gated surface states the premise", () => {
    const offenders = hits
      .filter((h) => !allowedBy(h))
      .map((h) => `${h.relPath}:${h.lineNo}: ${h.sentence}`);
    expect(
      offenders,
      "An ARK-less tree person is scored on document content (dev/probe-same-person-local-id.ts: " +
        "0.9999484 vs a 0.999967 control). Correct the sentence; allow-list it only if it quotes the " +
        "claim in order to refute it.",
    ).toEqual([]);
  });

  it("every allow-list entry still matches a sentence", () => {
    const stale = ALLOWLIST.filter(
      (a) => !hits.some((h) => h.relPath === a.relPath && h.sentence.includes(a.phrase)),
    ).map((a) => `${a.relPath}: ${a.phrase}`);
    expect(stale, "reworded or removed: delete the entry").toEqual([]);
  });

  it("catches the deleted person-evidence bullet in every shape", () => {
    const bullet =
      "- **Degenerate `same_person` score on an unresolvable id:** When the tree\n" +
      "  candidate is a local stub, or a tree id `same_person` cannot resolve to a\n" +
      "  full FamilySearch ARK, the tool may return a near-zero score (e.g. `0.005`)\n" +
      "  that reflects the missing ARK, not a real mismatch. Treat that as **no\n" +
      "  score available** — fall back to qualitative correlation (Step 3).\n";
    const shapes = {
      original: bullet,
      reflowed: bullet.replace(/\n\s*/g, " ").replace("unresolvable id:**", "unresolvable\nid:**"),
      fenced: "```\n" + bullet + "```\n",
      lowercaseArk: bullet.replace(/ARK/g, "ark"),
    };
    for (const [name, text] of Object.entries(shapes)) {
      expect(premiseHits(text, name).length, name).toBeGreaterThan(0);
    }
  });

  it("accepts the ranker's floor and a refutation that names no cause", () => {
    const fine = [
      "`matchScore` is null or below a degenerate floor (≈0.01), set `subjectResolvable: false`.",
      "The degenerate score floor means your person is not in this pool.",
      "That guidance said an id with no ARK was a problem.\n\nIt is now scored on document content.",
      "Don't send `includeFlags=true` — it returns a degenerate empty feed on this token.",
    ];
    for (const text of fine) expect(premiseHits(text, "fine"), text).toEqual([]);
  });
});
