import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { toArk, arkToUrl } from "../utils/ark.js";

// An imageId is a digitized-image identifier of the form NUMBER_NUMBER
// (an image group number, an underscore, and an image sequence number,
// e.g. "004884748_02613").
const IMAGE_ID_PATTERN = /^\d+_\d+$/;

// `ark` accepts either an already-resolved distribution URL (the pre-#267
// input shapes, restored here for callers that already have one) or a
// FamilySearch document-image ARK (3:1:/3:2:, e.g. fulltext_search's `id`),
// which has no other resolver in this codebase. Verified live
// (2026-07-07): fetching a 3:1:/3:2: ARK's resolver URL redirects straight
// to the image bytes. A 1:2: record ARK (e.g. record_search's `recordArk`)
// does not — its resolver returns an HTML shell, not an image — so that
// shape is deliberately not accepted here; only 3:1:/3:2: are.
const ARK_PATTERN = /^https:\/\/sg30p0\.familysearch\.org\/.+\/\$dist$/;
const DGS_URL_PATTERN =
  /^https:\/\/(www\.)?familysearch\.org\/das\/v2\/dgs:[^/]+\/dist\.jpg$/;
const DOCUMENT_IMAGE_ARK_PATTERN = /^ark:\/61903\/3:[12]:[A-Za-z0-9.-]+$/;

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
// (Downscaling to fit so large scans stay readable rather than refused
// would need an image-processing dependency in the shipped .mcpb —
// deferred; see docs/specs/image-read-spec.md.)
const MAX_INLINE_IMAGE_BYTES = 700_000;

export interface ImageReadInput {
  imageId?: string;
  ark?: string;
}

export interface ImageReadResult {
  url: string;
  mimeType: string;
  sizeBytes: number;
}

function imageIdToUrl(imageId: string): string {
  if (!IMAGE_ID_PATTERN.test(imageId)) {
    throw new Error(
      "Unrecognized imageId. Expected an Image Group Number of the form " +
        "NUMBER_NUMBER (e.g. 004884748_02613)."
    );
  }
  return `https://familysearch.org/das/v2/dgs:${imageId}/dist.jpg`;
}

function arkToImageUrl(ark: string): string {
  if (ARK_PATTERN.test(ark) || DGS_URL_PATTERN.test(ark)) {
    return ark;
  }
  const canonical = toArk(ark);
  if (DOCUMENT_IMAGE_ARK_PATTERN.test(canonical)) {
    return arkToUrl(canonical);
  }
  throw new Error(
    "Unrecognized ark. Expected a FamilySearch document-image ARK " +
      "(ark:/61903/3:1:... or 3:2:..., a bare 3:1:.../3:2:... id, or a " +
      "resolver URL for one), a DeepZoomCloud ARK URL (ending in /$dist), " +
      "or a DGS distribution URL (dgs:.../dist.jpg)."
  );
}

function resolveInput(input: ImageReadInput): { url: string; label: string } {
  if (input.imageId !== undefined && input.ark !== undefined) {
    throw new Error("Provide either imageId or ark, not both.");
  }
  if (input.imageId !== undefined) {
    return { url: imageIdToUrl(input.imageId), label: input.imageId };
  }
  if (input.ark !== undefined) {
    return { url: arkToImageUrl(input.ark), label: input.ark };
  }
  throw new Error("image_read requires either imageId or ark.");
}

export async function imageReadTool(input: ImageReadInput): Promise<{
  imageData: string;
  metadata: ImageReadResult;
}> {
  const { url, label } = resolveInput(input);

  const token = await getValidToken();

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "image/*,*/*",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(
      `FamilySearch image fetch failed: ${response.status} ${response.statusText}`
    );
  }

  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new Error(
      `Expected an image response but got content-type: ${contentType}`
    );
  }

  const buffer = await response.arrayBuffer();

  // Refuse oversized images before encoding — returning them would overflow
  // the MCP transport buffer and crash the session (see MAX_INLINE_IMAGE_BYTES).
  if (buffer.byteLength > MAX_INLINE_IMAGE_BYTES) {
    const mb = (buffer.byteLength / 1_000_000).toFixed(1);
    throw new Error(
      `FamilySearch image ${label} is ${mb} MB — too large to return inline. ` +
        `The MCP transport caps a single response near 1 MB and base64 encoding inflates ` +
        `the image by ~33%, so returning it would crash the session. Read the indexed ` +
        `record for this image with record_read / record_search instead of fetching the ` +
        `page scan, or choose a more specific image.`
    );
  }

  const bytes = new Uint8Array(buffer);

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
      mimeType: contentType.split(";")[0].trim(),
      sizeBytes: buffer.byteLength,
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
