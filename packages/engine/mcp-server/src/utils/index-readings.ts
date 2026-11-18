// index-readings — the index beside a machine reading of a page (issue #4578).
//
// A transcription the caller reads alone gets taken for the page itself, and the
// index gets called wrong on its strength. So an `image_transcribe` answer in a
// project carries the indexed names of every held record on that page, and a
// note saying what the transcription is. Joined the way `waiting-pages` joins a
// source to a read: by the source's `image_ark` page key.
// Spec: docs/specs/image-transcribe-tool-spec.md, "Index readings".

import type { ImageTranscribeToolResponse, IndexReading } from "../types/image-transcribe.js";
import { readProjectJson } from "./project-io.js";
import { pageKey, sourceIndex } from "./waiting-pages.js";

export const READING_NOTE =
  "The transcription is one machine reading of the page, not a sight of it: never say the " +
  "image or page shows, reads or is clear, and never call its text the name as written. " +
  "`indexReadings` are the held records' indexed names for " +
  "this page; a given name the index left blank is absent from them. Where they and the " +
  "transcription differ, show both side by side, say they differ, name the line, and give " +
  "`viewerUrl` to check it. Call neither reading the answer or the likelier one, never call the " +
  "index wrong or a misread, and never state a correction. A second transcription of the same page, " +
  "or one made after declining to read it, confirms nothing; only a different record or a " +
  "different person's reading does. Report each other record's name as that record writes " +
  "it: it challenges this reading, so never call it a rendering, variant or split of another " +
  "name, never call a disagreeing spelling consistent, and never drop a reading on a premise " +
  "the project's own files contradict.";

/** The held records' indexed names for the page an ARK names. */
export function indexReadingsForPage(research: any, ark: string): IndexReading[] {
  const key = pageKey(ark);
  if (key === null) return [];
  const sources = (Array.isArray(research?.sources) ? research.sources : []).filter(
    (s: any) =>
      typeof s?.id === "string" &&
      typeof s?.image_ark === "string" &&
      s.image_ark !== "" &&
      pageKey(s.image_ark) === key,
  );
  return sources.flatMap((s: any) =>
    sourceIndex(research, s.id)
      .filter((e) => e.factType === "name")
      .map((e) => ({ sourceId: s.id as string, recordId: e.recordId, role: e.role, name: e.value })),
  );
}

/**
 * Add `readingNote`, and `indexReadings` when a held source names the page, to an
 * answer from a project. Never throws: an unreadable project leaves the note
 * alone, since the note is what matters and the read already succeeded.
 *
 * Mutates and returns `out`.
 */
export async function attachIndexReadings(
  projectPath: string,
  out: ImageTranscribeToolResponse,
  ark: string | undefined,
): Promise<ImageTranscribeToolResponse> {
  out.readingNote = READING_NOTE;
  if (typeof ark !== "string" || ark === "") return out;
  try {
    const readings = indexReadingsForPage(await readProjectJson(projectPath, "research.json"), ark);
    if (readings.length > 0) out.indexReadings = readings;
  } catch {
    // An unreadable research.json cannot give an index; the note stands.
  }
  return out;
}
