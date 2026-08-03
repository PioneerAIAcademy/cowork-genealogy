import {
  resolveFsImageInput,
  fetchFsImageBytes,
  type FsImageInput,
} from "../utils/fs-image-fetch.js";
import { saveSourceImage } from "../utils/image-store.js";

// The MCP transport between this server and the calling agent caps a single
// response near 1 MiB. Base64 inflates raw bytes by ~33%, so this floor on
// the RAW bytes (700 KB raw → ~933 KB base64) keeps one image_read response
// under that ceiling. Scans over this floor should use image_transcribe
// instead, which OCRs host-side and returns text — no bytes cross the
// transport, so no cap applies.
const MAX_INLINE_IMAGE_BYTES = 700_000;

export interface ImageReadInput extends FsImageInput {
  /** Absolute project-folder path. When given, the fetched JPEG is saved
   *  under images/<key>.jpg and its project-relative path returned as
   *  `imageRef`, mirroring image_transcribe's save behavior. */
  projectPath?: string;
}

export interface ImageReadResult {
  url: string;
  mimeType: string;
  sizeBytes: number;
  /** Project-relative path of the saved scan (images/<key>.jpg), present only
   *  when projectPath was supplied and the save succeeded. */
  imageRef?: string;
}

export async function imageReadTool(input: ImageReadInput): Promise<{
  imageData: string;
  metadata: ImageReadResult;
}> {
  const { url, label } = resolveFsImageInput(input, "image_read");

  const { bytes, contentType, sizeBytes } = await fetchFsImageBytes(url);

  // Refuse oversized images before encoding — returning them would overflow
  // the MCP transport buffer and crash the session (see MAX_INLINE_IMAGE_BYTES).
  if (sizeBytes > MAX_INLINE_IMAGE_BYTES) {
    const mb = (sizeBytes / 1_000_000).toFixed(1);
    throw new Error(
      `FamilySearch image ${label} is ${mb} MB — too large to return inline. ` +
        `The MCP transport caps a single response near 1 MB and base64 encoding inflates ` +
        `the image by ~33%, so returning it would crash the session. OCR it with ` +
        `image_transcribe instead (it reads the scan host-side and returns text, with no ` +
        `size limit), or read the indexed record with record_read / record_search.`
    );
  }

  // Convert binary buffer to base64
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const imageData = btoa(binary);

  // Persist the scan for a retained source, mirroring image_transcribe's save
  // (best-effort: a save failure omits imageRef rather than losing the read).
  let imageRef: string | undefined;
  if (input.projectPath) {
    try {
      imageRef = await saveSourceImage({
        projectPath: input.projectPath,
        imageKey: label,
        bytes,
      });
    } catch {
      imageRef = undefined;
    }
  }

  return {
    imageData,
    metadata: {
      url,
      mimeType: contentType,
      sizeBytes,
      ...(imageRef ? { imageRef } : {}),
    },
  };
}

export const imageReadToolSchema = {
  name: "image_read",
  description:
    "Fetch a FamilySearch distribution image and return it as image data. " +
    "Provide exactly one of imageId or ark. Use imageId (from image_search) " +
    "when you have one; use ark when you only have a document-image ARK " +
    "(e.g. from fulltext_search's id field), a resolver URL for one, or an " +
    "already-resolved distribution URL. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      imageId: {
        type: "string",
        description:
          "FamilySearch Image Group Number of the form NUMBER_NUMBER " +
          "(an image group number, an underscore, and an image sequence " +
          "number), e.g. 004884748_02613. Feed an imageId from image_search directly.",
      },
      ark: {
        type: "string",
        description:
          "A FamilySearch document-image ARK, when no imageId is available " +
          "— ark:/61903/3:1:... or 3:2:... (e.g. from fulltext_search's " +
          "`id`), a bare 3:1:.../3:2:... id, a full resolver URL for one, " +
          "or an already-resolved DeepZoomCloud (ending in /$dist) or DGS " +
          "(dgs:.../dist.jpg) distribution URL. " +
          "IMPORTANT: some document-image ARKs are waypoints into a multi-image " +
          "film/register — the bare ARK can silently resolve to the WRONG image " +
          "within that group. If the record was reached via a FamilySearch page " +
          "URL carrying i=/cc=/groupId= query parameters (e.g. from the browser or " +
          "a citation), pass the FULL URL including them, not just the bare ARK — " +
          "those parameters are preserved and select the correct image.",
      },
      projectPath: {
        type: "string",
        description:
          "Optional absolute path to the project folder. When set, the fetched " +
          "page scan is saved under images/ and its project-relative path is " +
          "returned as imageRef, so a retained source can cite it (image_filename) " +
          "for viewer display.",
      },
    },
  },
};
