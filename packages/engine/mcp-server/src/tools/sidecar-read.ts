// sidecar_read — paged read of one project sidecar text file.
//
// Serves the two project-file classes that had no MCP tool: the verdict bodies
// `evaluations[].file_path` names, and text uploads under `<project>/uploads/`.
// Nothing else: `results/` is served by record_read / rank_search_matches,
// images by image_read / image_transcribe, research.json and the tree by
// research_query / project_context. Spec: docs/specs/sidecar-read-tool-spec.md.
//
// The bound that matters is on the SERIALIZED envelope, not on `content`:
// `writerToolResult` JSON.stringifies the result, which escapes every `"`, `\`
// and control character, and the CLI spills any result above 50,000 characters
// to a file the model must Read back (which, on a resumed turn, is deleted at
// turn end). So the page is shrunk until its JSON form fits in 40,000
// characters, whatever the raw text looks like.

import { getProjectStore } from "../store/project-store.js";
import {
  classifyProjectPath,
  MISSING_PROJECT_PATH_MESSAGE,
  missingProjectDirMessage,
  NoProjectError,
  noProjectResult,
} from "../utils/project-io.js";

/** Both the default page size and the hard cap on `maxChars`; also the cap on
 *  the JSON-escaped body of `content` — `JSON.stringify(content).length - 2`
 *  (spec §4). */
export const SIDECAR_READ_MAX_CHARS = 40_000;

/** The only two ref prefixes this tool serves (spec §3). */
export const SIDECAR_READ_PREFIXES = ["evaluations", "uploads"] as const;

/** How much of the decoded text the U+FFFD ratio is measured over (spec §5). */
const NOT_TEXT_SAMPLE_CHARS = 8_192;
const NOT_TEXT_FFFD_RATIO = 0.01;
/** A single U+FFFD never trips the rule, whatever the file's length. */
const NOT_TEXT_FFFD_FLOOR = 1;

export interface SidecarReadInput {
  projectPath: string;
  /** Project-relative POSIX path under `evaluations/` or `uploads/`. */
  ref: string;
  /** UTF-16 code-unit offset of the first character to return. Default 0. */
  offset?: number;
  /** Page size in UTF-16 code units. Default and hard cap SIDECAR_READ_MAX_CHARS
   *  (a larger value is clamped, not rejected). */
  maxChars?: number;
}

export type SidecarReadFailureReason = "no_project" | "invalid_ref" | "not_found" | "not_text";

export type SidecarReadResult =
  | {
      ok: true;
      ref: string;
      /** Length of the decoded file in UTF-16 code units, after the BOM strip. */
      totalChars: number;
      offset: number;
      content: string;
      /** `offset + content.length < totalChars`. */
      truncated: boolean;
      /** `offset + content.length` — present only when `truncated`. */
      nextOffset?: number;
    }
  | { ok: false; reason: SidecarReadFailureReason; errors: string[] };

/** A failure the tool reports by RETURNING (`{ ok: false, reason }`), as
 *  opposed to the thrown argument/path errors the dispatch arm's catch owns. */
class SidecarReadFailure extends Error {
  constructor(
    readonly reason: Exclude<SidecarReadFailureReason, "no_project">,
    message: string,
  ) {
    super(message);
  }
}

const NOT_TEXT_MESSAGE =
  "binary or non-UTF-8 text (a PDF, an image, or UTF-16 — re-save as UTF-8); " +
  "`image_read`/`image_transcribe` read a FamilySearch scan by imageId or ark " +
  "and take no path, so neither can read this file";

/** The tool that serves a rejected ref's class, so the message points somewhere. */
function servedElsewhere(ref: string): string | null {
  const segments = ref.split("/");
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (last === "research.json" || first === "research.json") {
    return "research.json is served by `research_query` (a section at a time) and `project_context`.";
  }
  if (last === "tree.gedcomx.json" || first === "tree.gedcomx.json") {
    return "tree.gedcomx.json is served by `project_context`.";
  }
  if (first === "results") {
    return "results/ sidecars are served by `record_read({recordId, resultsRef})` and `rank_search_matches({resultsRef})`.";
  }
  if (first === "images") {
    return "images/ are served by `image_read` / `image_transcribe`.";
  }
  return null;
}

/**
 * Spec §3, applied positively: a prefix, then one or more segments; every
 * segment non-empty, not `.` or `..`, free of `/`, `\` and NUL. Returns the
 * message for a rejected ref, or null when it passes.
 */
export function invalidRefMessage(ref: unknown): string | null {
  const rule =
    `ref must be a project-relative POSIX path under ${SIDECAR_READ_PREFIXES.map((p) => `${p}/`).join(" or ")} ` +
    `(e.g. evaluations/proof-critique-ps_001-2026-09-14.json, uploads/notes.txt): no leading slash, ` +
    `no drive letter, no backslashes, no '.' or '..' segments, no empty segments.`;
  if (typeof ref !== "string" || ref === "") {
    return `ref is required. ${rule}`;
  }
  if (ref.includes("\\")) {
    return `ref '${ref}' contains a backslash — use '/' as the separator. ${rule}`;
  }
  if (ref.includes("\u0000")) {
    return `ref contains a NUL character. ${rule}`;
  }
  if (ref.startsWith("/") || /^[A-Za-z]:/.test(ref)) {
    return `ref '${ref}' is an absolute path — refs are relative to projectPath. ${rule}`;
  }
  const segments = ref.split("/");
  const prefix = segments[0];
  if (!(SIDECAR_READ_PREFIXES as readonly string[]).includes(prefix)) {
    const pointer = servedElsewhere(ref);
    return (
      `ref '${ref}' is not under ${SIDECAR_READ_PREFIXES.map((p) => `${p}/`).join(" or ")}.` +
      (pointer ? ` ${pointer}` : "") +
      ` ${rule}`
    );
  }
  if (segments.length < 2) {
    return `ref '${ref}' names the ${prefix}/ directory itself, not a file in it. ${rule}`;
  }
  for (const seg of segments) {
    if (seg === "") return `ref '${ref}' has an empty path segment. ${rule}`;
    if (seg === "." || seg === "..") {
      return `ref '${ref}' has a '${seg}' segment. ${rule}`;
    }
  }
  return null;
}

/** Reject-not-coerce, the same posture as research_query's `offset`: a
 *  stringified "50" reaches the tool as a string (index.ts passes arguments
 *  through untouched) and would otherwise be silently coerced by `slice`. */
function requireWholeNumber(name: string, value: unknown, min: number): number {
  if (!Number.isInteger(value) || (value as number) < min) {
    const got =
      typeof value === "number" && !Number.isFinite(value) ? String(value) : JSON.stringify(value);
    throw new Error(
      `${name} must be a whole number ≥ ${min} (got ${got}). Send it as a number, not a string.`,
    );
  }
  return value as number;
}

/** Spec §5: any NUL, or U+FFFD in more than max(1, 1%) of the first 8,192
 *  characters. The floor of one is what keeps the rule from being
 *  zero-tolerance on a short file: below 100 characters, 1% is under one, so
 *  without it a single U+FFFD — a damaged byte, or the literal character in
 *  valid UTF-8 — would refuse the file. */
function looksBinary(text: string): boolean {
  if (text.includes("\u0000")) return true;
  const sample = text.slice(0, NOT_TEXT_SAMPLE_CHARS);
  let fffd = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0xfffd) fffd++;
  }
  return fffd > Math.max(NOT_TEXT_FFFD_FLOOR, sample.length * NOT_TEXT_FFFD_RATIO);
}

/**
 * Spec §4: the page after the serialized-envelope shrink and the surrogate
 * step. Exported so the test can pin the bound on the function itself as
 * well as on the wrapped envelope. Invariant: for `offset < text.length` the
 * page is never empty, so `nextOffset` always advances and a caller paging
 * "until truncated is false" terminates.
 */
export function fitPage(text: string, offset: number, maxChars: number): string {
  let page = text.slice(offset, offset + maxChars);
  // The bound is on the ESCAPED BODY — JSON.stringify's two wrapping quotes
  // excluded — so a plain-text page is exactly maxChars. A raw character
  // serializes to between 1 (plain) and 6 (`\u0001`) characters, so cutting
  // `ceil(over / 6)` always makes progress and can never overshoot to an empty
  // page (a single character always fits): with `"` at 2 each, the excess
  // shrinks by about a third per step and the loop settles in ~25 rounds of a
  // 40k stringify — microseconds.
  for (;;) {
    const over = JSON.stringify(page).length - 2 - SIDECAR_READ_MAX_CHARS;
    if (over <= 0 || page.length === 0) break;
    page = page.slice(0, Math.max(0, page.length - Math.max(1, Math.ceil(over / 6))));
  }
  // Never split a surrogate PAIR across two pages: when the page ends on a
  // high surrogate and the very next unit of the text is its low surrogate,
  // move the boundary. Backwards by one unit normally; forwards by one unit
  // when the page is that single high surrogate (maxChars: 1, or an offset
  // landing on the pair), because backing off would leave an empty page with
  // nextOffset === offset — a paging loop that never terminates. A lone high
  // surrogate with no low surrogate after it is not a pair and stays put.
  const lastCode = page.charCodeAt(page.length - 1);
  const nextCode = text.charCodeAt(offset + page.length);
  if (isHighSurrogate(lastCode) && isLowSurrogate(nextCode)) {
    page = page.length > 1 ? page.slice(0, -1) : text.slice(offset, offset + 2);
  }
  return page;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export async function sidecarRead(input: SidecarReadInput): Promise<SidecarReadResult> {
  const { projectPath, ref } = input;

  const offset = input.offset === undefined ? 0 : requireWholeNumber("offset", input.offset, 0);
  const maxChars = Math.min(
    SIDECAR_READ_MAX_CHARS,
    input.maxChars === undefined ? SIDECAR_READ_MAX_CHARS : requireWholeNumber("maxChars", input.maxChars, 1),
  );

  try {
    const refError = invalidRefMessage(ref);
    if (refError) throw new SidecarReadFailure("invalid_ref", refError);

    // Same classification as readProjectJson, and the same two thrown
    // messages: single-project-read.test.ts pins them to project-io.ts.
    switch (await classifyProjectPath(projectPath)) {
      case "missing_arg":
        throw new Error(MISSING_PROJECT_PATH_MESSAGE);
      case "missing_dir":
        throw new Error(missingProjectDirMessage(projectPath));
      case "no_project":
        throw new NoProjectError();
    }

    // NOT `store.exists`: it swallows every access() failure as "absent", so an
    // unreadable verdict would read as missing and the mentor would re-evaluate
    // over a live one. Read, and classify what the read throws.
    let raw: string;
    try {
      raw = await getProjectStore().readText(projectPath, ref);
    } catch (e: any) {
      // ENOTDIR: an intermediate segment is a regular file — the ref is absent
      // by any reading, not an unreadable file.
      if (e?.code === "ENOENT" || e?.code === "ENOTDIR") {
        throw new SidecarReadFailure(
          "not_found",
          `${ref} does not exist in this project. A verdict's path comes from ` +
            `research_query({ section: "evaluations", targetId, focus })'s file_path; an upload ` +
            `is named in the conversation by the researcher. This tool does not list directories.`,
        );
      }
      if (e?.code === "EISDIR") {
        throw new SidecarReadFailure("invalid_ref", `ref '${ref}' names a directory, not a file.`);
      }
      if (e?.code === "ENAMETOOLONG") {
        // A segment over NAME_MAX or a whole path over PATH_MAX: no file can
        // have this name, so it is a ref problem, not an unreadable file.
        throw new SidecarReadFailure(
          "invalid_ref",
          `ref '${ref}' is longer than the filesystem allows (a single segment over 255 bytes, ` +
            `or the whole path over the platform limit). No file can have this name.`,
        );
      }
      throw e; // EACCES and friends stay loud
    }

    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    if (looksBinary(text)) throw new SidecarReadFailure("not_text", `${ref}: ${NOT_TEXT_MESSAGE}`);

    const totalChars = text.length;
    const start = Math.min(offset, totalChars);
    const content = fitPage(text, start, maxChars);
    const end = start + content.length;
    const truncated = end < totalChars;
    return {
      ok: true,
      ref,
      totalChars,
      offset: start,
      content,
      truncated,
      ...(truncated ? { nextOffset: end } : {}),
    };
  } catch (e) {
    if (e instanceof NoProjectError) return noProjectResult("read");
    if (e instanceof SidecarReadFailure) return { ok: false, reason: e.reason, errors: [e.message] };
    throw e;
  }
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const sidecarReadSchema = {
  name: "sidecar_read",
  description:
    "Read a project sidecar text file a page at a time — a gps-mentor verdict body under " +
    "`evaluations/` (the `file_path` on an entry from " +
    "`research_query({ section: \"evaluations\", targetId, focus })`) or a text upload the " +
    "researcher placed under `uploads/` (a transcription, a CSV, a note). Read-only; writes " +
    "nothing. `ref` is project-relative and must start with `evaluations/` or `uploads/`: " +
    "research.json and the tree are served by `research_query`/`project_context`, `results/` " +
    "sidecars by `record_read`/`rank_search_matches`, and images by " +
    "`image_read`/`image_transcribe`, so those refs are rejected with a pointer. Returns " +
    "`{ ref, totalChars, offset, content, truncated, nextOffset? }`: `content` is at most " +
    "40,000 characters (less when the text is heavy with quotes or backslashes, so the " +
    "result never overflows the tool-result limit); when `truncated` is true, call again " +
    "with `offset: nextOffset` until it is false. A missing file is `reason: \"not_found\"` " +
    "(this tool does not list directories — a ref is something you already hold); a " +
    "binary or UTF-16 file is `reason: \"not_text\"`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory holding research.json.",
      },
      ref: {
        type: "string",
        description:
          "Project-relative POSIX path of the file, under `evaluations/` or `uploads/` " +
          "(e.g. `evaluations/proof-critique-ps_001-2026-09-14.json`, `uploads/notes.txt`). " +
          "Forward slashes only; no leading slash, no `..`.",
      },
      offset: {
        type: "number",
        description:
          "0-based character offset to start reading from. Default 0. When a result says " +
          "`truncated: true`, pass its `nextOffset` here to read the next page. Must be a " +
          "non-negative whole number.",
      },
      maxChars: {
        type: "number",
        description:
          "Page size in characters. Default and maximum 40,000 (a larger value is clamped). " +
          "The returned `content` may be shorter than this when the text needs heavy JSON " +
          "escaping; `truncated`/`nextOffset` are always right regardless.",
      },
    },
    required: ["projectPath", "ref"],
  },
};
