import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";

// An imageId is a digitized-image identifier of the form NUMBER_NUMBER
// (an image group number, an underscore, and an image sequence number,
// e.g. "004884748_02613").
const IMAGE_ID_PATTERN = /^\d+_\d+$/;

// Transport-safety FLOOR on the raw image bytes we base64-encode inline.
// This is NOT the primary defense against overflow — it only stops a
// SINGLE image whose base64 alone would exceed the transport buffer. The
// MCP stdio transport decodes one JSON message at a time behind a hard
// ~1 MiB (1,048,576-byte) buffer; base64 inflates the payload ~33%, so a
// raw image above ~780 KB overflows the buffer on its own and crashes the
// *entire session* — an uncatchable transport error, not a per-tool
// failure. 700 KB raw → ~933 KB base64, under the cap with envelope
// headroom; above this we throw an actionable error instead of the bytes.
//
// The per-image ceiling does NOT prevent the real failure mode:
// *accumulation*. Base64 blobs from successive image_read calls pile up in
// the calling agent's context and are re-sent every turn, and a later
// message overflows the buffer even though every individual image is small
// (observed: an e2e run made 17 image_read calls, each ≤458 KB raw, ~5.4 MB
// of base64 total, then crashed). The fix for accumulation is the
// `image-reader` subagent (packages/engine/plugin/agents/image-reader.md):
// it absorbs the base64 in an isolated context and returns only text, so
// the bytes never accumulate in the main transcript. This ceiling remains
// as a floor protecting any single response — main or subagent.
// (Downscaling to fit so large scans stay readable rather than refused
// would need an image-processing dependency in the shipped .mcpb —
// deferred; see docs/specs/image-read-spec.md.)
const MAX_INLINE_IMAGE_BYTES = 700_000;

export interface ImageReadInput {
  imageId: string;
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

export async function imageReadTool(input: ImageReadInput): Promise<{
  imageData: string;
  metadata: ImageReadResult;
}> {
  const url = imageIdToUrl(input.imageId);

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
      `FamilySearch image ${input.imageId} is ${mb} MB — too large to return inline. ` +
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
    "Fetch a FamilySearch distribution image by imageId and return it as image data. " +
    "Takes an Image Group Number of the form NUMBER_NUMBER (e.g. 004884748_02613), " +
    "such as an imageId returned by image_search, and builds the distribution URL internally. " +
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
    },
    required: ["imageId"],
  },
};
