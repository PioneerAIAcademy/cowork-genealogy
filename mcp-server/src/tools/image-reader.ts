import { getValidToken } from "../auth/refresh.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const ARK_PATTERN =
  /^https:\/\/sg30p0\.familysearch\.org\/.+\/\$dist$/;
const DGS_PATTERN =
  /^https:\/\/(www\.)?familysearch\.org\/das\/v2\/dgs:[^/]+\/dist\.jpg$/;

export interface ImageReaderInput {
  url: string;
}

export interface ImageReaderResult {
  url: string;
  mimeType: string;
  sizeBytes: number;
}

function validateUrl(url: string): void {
  if (!ARK_PATTERN.test(url) && !DGS_PATTERN.test(url)) {
    throw new Error(
      "Unrecognized FamilySearch image URL. Expected an ARK URL " +
        "(ending in /$dist) or a DGS URL (dgs:NUMBER_NUMBER/dist.jpg)."
    );
  }
}

export async function imageReaderTool(input: ImageReaderInput): Promise<{
  imageData: string;
  metadata: ImageReaderResult;
}> {
  validateUrl(input.url);

  const token = await getValidToken();

  const response = await fetch(input.url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "image/*,*/*",
      "User-Agent": USER_AGENT,
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

export const imageReaderToolSchema = {
  name: "image_reader",
  description:
    "Fetch a FamilySearch distribution image by URL and return it as image data. " +
    "Accepts ARK URLs (ending in /$dist) or DGS URLs (dgs:NUMBER_NUMBER/dist.jpg). " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "FamilySearch image URL. Two formats supported:\n" +
          "ARK: https://sg30p0.familysearch.org/service/records/storage/deepzoomcloud/dz/v1/{ARK_ID}/$dist\n" +
          "DGS: https://familysearch.org/das/v2/dgs:{DGS}_{IMAGE}/dist.jpg",
      },
    },
    required: ["url"],
  },
};
