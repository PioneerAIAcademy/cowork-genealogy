import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";

const ARK_PATTERN =
  /^https:\/\/sg30p0\.familysearch\.org\/.+\/\$dist$/;
// The das/v2 endpoint path still uses the literal "dgs:" token; the number
// it carries is what FamilySearch now calls the Image Group Number.
const IMAGE_GROUP_PATTERN =
  /^https:\/\/(www\.)?familysearch\.org\/das\/v2\/dgs:[^/]+\/dist\.jpg$/;

export interface ImageReadInput {
  url: string;
}

export interface ImageReadResult {
  url: string;
  mimeType: string;
  sizeBytes: number;
}

function validateUrl(url: string): void {
  if (!ARK_PATTERN.test(url) && !IMAGE_GROUP_PATTERN.test(url)) {
    throw new Error(
      "Unrecognized FamilySearch image URL. Expected an ARK URL " +
        "(ending in /$dist) or an Image Group Number URL " +
        "(das/v2/dgs:{imageGroupNumber}_{image}/dist.jpg)."
    );
  }
}

export async function imageReadTool(input: ImageReadInput): Promise<{
  imageData: string;
  metadata: ImageReadResult;
}> {
  validateUrl(input.url);

  const token = await getValidToken();

  const response = await fetch(input.url, {
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
      url: input.url,
      mimeType: contentType.split(";")[0].trim(),
      sizeBytes: buffer.byteLength,
    },
  };
}

export const imageReadToolSchema = {
  name: "image_read",
  description:
    "Fetch a FamilySearch distribution image by URL and return it as image data. " +
    "Accepts ARK URLs (ending in /$dist) or Image Group Number URLs (das/v2/dgs:{imageGroupNumber}_{image}/dist.jpg). " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "FamilySearch image URL. Two formats supported:\n" +
          "ARK: https://sg30p0.familysearch.org/service/records/storage/deepzoomcloud/dz/v1/{ARK_ID}/$dist\n" +
          "Image Group Number: https://familysearch.org/das/v2/dgs:{IMAGE_GROUP_NUMBER}_{IMAGE}/dist.jpg",
      },
    },
    required: ["url"],
  },
};
