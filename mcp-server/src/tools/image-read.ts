import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";

// An imageId is a digitized-image identifier of the form NUMBER_NUMBER
// (an image group number, an underscore, and an image sequence number,
// e.g. "004884748_02613").
const IMAGE_ID_PATTERN = /^\d+_\d+$/;

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
