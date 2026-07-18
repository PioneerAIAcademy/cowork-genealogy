import {
  resolveFsImageInput,
  fetchFsImageBytes,
  type FsImageInput,
} from "../utils/fs-image-fetch.js";

// FLOOR on the raw image bytes we base64-encode inline. This is NOT the
// primary defense against overflow — it only stops a SINGLE image whose
// base64 alone is so large it can't fit in one message. 700 KB raw →
// ~933 KB base64; above this we throw an actionable error instead of the
// bytes.
//
// The real failure mode is *accumulation*, and it is NOT a single MCP
// response frame overflowing. Each image_read response adds a base64
// content block to the calling agent's conversation, and the WHOLE
// conversation is re-serialized and re-sent every turn. So the per-turn
// payload grows with each image read, and eventually one re-serialized
// message carrying all the accumulated blobs exceeds the ~1 MiB
// (1,048,576-byte) buffer and crashes the *entire session* — an
// uncatchable error — even when every individual image is well under this
// ceiling. (Observed: an e2e run made 17 image_read calls, each ≤458 KB
// raw, then crashed on the accumulated pile, not on any one response.)
//
// This is why the fix is the `image-reader` subagent
// (packages/engine/plugin/agents/image-reader.md): it absorbs the base64
// in an isolated context and returns only text, so the bytes never enter
// the main conversation to accumulate. It is also why that agent reads
// exactly ONE image per invocation — two large scans (~458 KB raw →
// ~610 KB base64 each) already sum past the buffer inside the subagent's
// own re-serialized conversation. This per-image ceiling is only a floor
// protecting a single response — main or subagent.
//
// For scans OVER this floor the transcription path is `image_transcribe`,
// which OCRs the image host-side and returns text (the bytes never cross
// the MCP transport, so no cap applies) — see
// docs/specs/image-transcribe-tool-spec.md.
const MAX_INLINE_IMAGE_BYTES = 700_000;

export type ImageReadInput = FsImageInput;

export interface ImageReadResult {
  url: string;
  mimeType: string;
  sizeBytes: number;
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

  return {
    imageData,
    metadata: {
      url,
      mimeType: contentType,
      sizeBytes,
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
          "(dgs:.../dist.jpg) distribution URL.",
      },
    },
  },
};
