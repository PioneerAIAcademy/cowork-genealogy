import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// GENEALOGY_MAX_TRANSCRIPTIONS (self-hosted beta E4) is applied by wrapping two
// named tool functions in `withTranscriptionSlot`, not by a property of the OCR
// path itself. So a THIRD tool that calls runOcr/runFoundCheck directly would
// escape the cap entirely, and every suite would stay green: the cap is off by
// default, so no integration test would notice, and nothing else enumerates
// runOcr's callers.
//
// This is the guard for that. It is the same shape as no-bare-fetch.test.ts:
// name the files allowed to reach the primitive, and fail on a new one.
//
// Registered under CLAUDE.md's "what nothing checks" reasoning: without it, the
// failure is silent and only visible on a rate-limited production host.

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");

/** Files that may call runOcr / runFoundCheck. Each must hold a transcription
 *  slot for the whole call. `utils/ocr.ts` is where they are defined. */
const ALLOWED = new Set(["utils/ocr.ts", "tools/image-transcribe.ts", "tools/volume-bisect.ts"]);

/** Every file in ALLOWED that is a TOOL must take the slot on its exported
 *  entry point. Keyed by file, valued by the wrapped export. */
const WRAPPED: Record<string, string> = {
  "tools/image-transcribe.ts": "imageTranscribeTool",
  "tools/volume-bisect.ts": "volumeBisectTool",
};

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Comments removed, so a call written in prose never counts as a call. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** A CALL to runOcr/runFoundCheck -- not an import, not a mention. */
function callsOcr(src: string): boolean {
  return /\b(?:runOcr|runFoundCheck)\s*\(/.test(stripComments(src));
}

describe("every OCR caller holds a transcription slot", () => {
  it("only the allow-listed files call runOcr or runFoundCheck", () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(srcRoot)) {
      const rel = relative(srcRoot, file).split("\\").join("/");
      if (ALLOWED.has(rel)) continue;
      const src = readFileSync(file, "utf-8");
      if (callsOcr(src)) offenders.push(rel);
    }
    expect(
      offenders,
      `These files call runOcr/runFoundCheck but are not allow-listed, so they ` +
        `escape GENEALOGY_MAX_TRANSCRIPTIONS. Wrap the tool's exported entry ` +
        `point in withTranscriptionSlot and add it to ALLOWED and WRAPPED here.`,
    ).toEqual([]);
  });

  it("each allow-listed tool takes the slot on its exported entry point", () => {
    for (const [rel, exportName] of Object.entries(WRAPPED)) {
      const src = readFileSync(join(srcRoot, rel), "utf-8");
      // The exported function must hand straight to withTranscriptionSlot.
      const wrapper = new RegExp(
        `export async function ${exportName}\\b[\\s\\S]{0,600}?withTranscriptionSlot\\(`,
      );
      expect(wrapper.test(src), `${rel}: ${exportName} no longer wraps its body in ` +
        `withTranscriptionSlot, so ${exportName} is uncapped.`).toBe(true);
    }
  });

  it("the allow-list names only files that exist and still call OCR", () => {
    // The other direction: a stale entry here would silently widen the guard.
    for (const rel of ALLOWED) {
      const src = readFileSync(join(srcRoot, rel), "utf-8");
      expect(
        // The SAME matcher as the forward direction. It used to accept
        // `[(,)]`, which a bare `import { runOcr, ... }` satisfies -- so a
        // file that had lost every real call stayed allow-listed and this
        // assertion, the one meant to catch exactly that, could not fire.
        callsOcr(src) || rel === "utils/ocr.ts",
        `${rel} is allow-listed but no longer calls runOcr/runFoundCheck — drop it.`,
      ).toBe(true);
    }
  });
});
