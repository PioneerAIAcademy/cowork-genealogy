// image_transcribe at the MCP boundary: the answer's shape, the tool's own log
// entry for the read, and the schema. Kept apart from the read itself
// (`image-transcribe.ts`) because only this leg writes `research.json`:
// person_read and source_screen call `imageTranscribeTool` for reads of their
// own and must not reach the log writer through their imports.

import type { Principal } from "../auth/principal.js";
import { attachIndexReadings } from "../utils/index-readings.js";
import { compactImageTranscribeAnswer } from "../utils/staged-compaction.js";
import { researchLogAppend } from "./research-log-append.js";
import { imageTranscribeTool } from "./image-transcribe.js";
import type {
  ImageTranscribeInput,
  ImageTranscribeResult,
  ImageTranscribeToolResponse,
} from "../types/image-transcribe.js";

/**
 * The MCP entry point. In a project (issue #2490, lead ruling 2026-10-16) the
 * page is staged and the inline `transcription` dropped, so the caller gets
 * `staged.resultsRef`, `digest` and `found`; the text comes back inline only
 * when staging failed. Every leg goes through `compactImageTranscribeAnswer`.
 *
 * Every read has a project (lead, 2026-11-19): `server.ts`'s gate refuses a call with
 * none before this runs, so there is no unsaved read and no cap for one. A `file`
 * is project-relative.
 *
 * person_read calls `imageTranscribeTool` directly and keeps the text; the
 * strip lives here so it cannot reach that leg.
 */
export async function imageTranscribeMcpTool(
  input: ImageTranscribeInput,
  principal: Principal,
): Promise<ImageTranscribeToolResponse> {
  const out = await imageTranscribeTool(input, principal);
  const logged = await logOwnRead(input, out);
  const answer = await withIndexReadings(input, compactImageTranscribeAnswer(out));
  return { ...answer, ...logged };
}

/**
 * The read's outcome for its log entry. Only a check that ran can say FOUND or
 * NOT FOUND: a `lookingFor` with no `found` (a truncated read, or a found check
 * that failed) is `partial`, never a hit nobody checked.
 */
export function readOutcome(
  out: Pick<ImageTranscribeResult, "found" | "truncated">,
  lookingFor: string | undefined,
): "positive" | "negative" | "partial" {
  if (out.found === "NOT FOUND") return "negative";
  if (out.found === "FOUND") return "positive";
  if (out.truncated) return "partial";
  return lookingFor !== undefined && lookingFor.trim() !== "" ? "partial" : "positive";
}

/**
 * Issue #4721: every staged read in a project is logged by the tool itself, so a
 * page the main thread reads is on record without a second call. Here, at the
 * MCP boundary only: person_read and source_screen call `imageTranscribeTool`
 * for reads of their own that are not research-log events. Outside any held
 * lock, as record_search's nil write (`withProjectLock` is not re-entrant). A
 * read whose staging failed has no ref to log, and an entry without one is
 * refused (`imageToolEntryRefusal`), so it logs nothing.
 */
async function logOwnRead(
  input: ImageTranscribeInput,
  out: ImageTranscribeResult,
): Promise<{ logId?: string; logRefused?: string[] }> {
  if (typeof input.projectPath !== "string" || !out.staged) return {};
  const logged = await researchLogAppend({
    projectPath: input.projectPath,
    tool: "image_transcribe",
    stagedResultsRef: out.staged.resultsRef,
    planItemId: input.planItemId ?? null,
    outcome: readOutcome(out, input.lookingFor),
    resultsExamined: 1,
    writtenBy: "image_transcribe",
  });
  if (logged.ok && "logId" in logged) return { logId: logged.logId };
  if (!logged.ok) return { logRefused: logged.errors };
  return {};
}

/** The project leg's index beside the reading (issue #4578). */
async function withIndexReadings(
  input: ImageTranscribeInput,
  out: ImageTranscribeToolResponse,
): Promise<ImageTranscribeToolResponse> {
  if (typeof input.projectPath !== "string") return out;
  if (input.file !== undefined) return attachIndexReadings(input.projectPath, out, undefined);
  // The ark that was read: a blank `ark` counts as absent, as foldImageArkInput folds it.
  const ark = typeof input.ark === "string" && input.ark.trim() !== "" ? input.ark : input.imageArk;
  return attachIndexReadings(input.projectPath, out, ark);
}

export const imageTranscribeToolSchema = {
  name: "image_transcribe",
  description:
    "OCR a FamilySearch page scan host-side. In a project it STAGES the " +
    "transcription and returns `staged.resultsRef`, a `digest` (length, a " +
    "300-character excerpt) and, with lookingFor, `found` — not the page text. " +
    "Triage on `found`/`digest`; read the page with sidecar_read({ projectPath, " +
    "ref: staged.resultsRef }) only when you need it, and hand " +
    "`staged.resultsRef` to the record-structurer agent to extract it; the text " +
    "comes back inline only when staging failed (`stagingError`). In a project " +
    "it also returns `readingNote`, and `indexReadings`, the held records' " +
    "indexed names for that page: follow the note. Use this for large scans that " +
    "image_read refuses (over its inline size cap): the image never enters the " +
    "conversation, so there is no size limit. Also transcribes a FamilySearch MEMORY artifact " +
    "(memoryArtifactUrl) — its direct artifact URL or its page URL " +
    "(familysearch.org/photos/artifacts/<id> or /memories/<id>) — " +
    "including a PDF, and an UPLOADED image or PDF already " +
    "inside a project folder (file, e.g. uploads/scan.jpg, with projectPath). " +
    "Provide exactly one of imageId, ark, memoryArtifactUrl, or file. Requires " +
    "FamilySearch auth (call login) for imageId/ark only; memoryArtifactUrl and " +
    "file need none. Needs an OpenRouter API key (set in " +
    "~/.familysearch-mcp/config.json if it reports no key). Inputs over 14 MiB " +
    "are refused with the remedy.",
  inputSchema: {
    type: "object" as const,
    properties: {
      imageId: {
        type: "string",
        description:
          "FamilySearch Image Group Number NUMBER_NUMBER (e.g. 004884748_02613), " +
          "as returned by image_search.",
      },
      ark: {
        type: "string",
        description:
          "A FamilySearch document-image ARK when no imageId is available — " +
          "ark:/61903/3:1:... or 3:2:... (e.g. fulltext_search's `id`), a bare " +
          "3:1:.../3:2:... id, an unprefixed XXXX-XXXX-XXXX-X id (treated as 3:1:), " +
          "a resolver URL for one, or a resolved distribution URL. " +
          "IMPORTANT: some document-image ARKs are waypoints into a multi-image " +
          "film/register — the bare ARK can silently resolve to the WRONG image " +
          "within that group. If the record was reached via a FamilySearch page " +
          "URL carrying i=/cc=/groupId= query parameters (e.g. from the browser or " +
          "a citation), pass the FULL URL including them, not just the bare ARK — " +
          "those parameters are preserved and select the correct image.",
      },
      memoryArtifactUrl: {
        type: "string",
        description:
          "A FamilySearch memory: a scanned will, certificate, obituary " +
          "clipping or compiled history uploaded by a relative. Either form " +
          "works — the direct artifact URL (a person_read source's " +
          "artifact_url) or the page URL a person sees " +
          "(familysearch.org/photos/artifacts/<id>, or /memories/<id>, which " +
          "is that source's url); a page URL is resolved first. PDFs are " +
          "supported as well as images. Needs no FamilySearch login.",
      },
      file: {
        type: "string",
        description:
          "A project-relative POSIX path to an uploaded image or PDF inside the " +
          "project folder — the hosted upload endpoint writes uploads/<name>. " +
          "Requires projectPath. JPEG, PNG, GIF, WEBP or PDF, decided by the " +
          "file's bytes, not its name. No FamilySearch login needed.",
      },
      lookingFor: {
        type: "string",
        description:
          "Optional: who or what to locate on the page. A search key only — on a " +
          "complete read it sets a FOUND/NOT FOUND pointer, but it never shortens " +
          "or slants the full transcription. The pointer is withheld on a " +
          "truncated read (`truncated: true`): a half-read page cannot support a " +
          "clean NOT FOUND, so `found` is absent there — judge from the returned " +
          "lines and treat the rest of the page as unread. On a FOUND, " +
          "`matchedForms` lists the other forms of a sought given name that the " +
          "page carries (`{ Eliza: [\"Elizabeth\"] }`): an entry under one of " +
          "them carries the name sought, not a different name.",
      },
      projectPath: {
        type: "string",
        description:
          "Absolute path to the project folder. In a project the transcription " +
          "is staged under it (`staged`, `digest`), and a fetched FamilySearch scan " +
          "is saved under images/ with its project-relative path returned as " +
          "imageRef, so a retained source can cite it (image_filename) for viewer " +
          "display. Omit it, or pass a folder that is not a project, to get the " +
          "text inline with nothing saved. Required with `file`.",
      },
      planItemId: {
        type: ["string", "null"],
        description:
          "The `pli_` plan item this read serves, or null for an ad-hoc read. In a " +
          "project this tool logs the read itself (`logId` in the answer) under this " +
          "plan item, so you never call `research_log_append` for the page.",
      },
    },
  },
};
