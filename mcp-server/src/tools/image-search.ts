import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import type {
  ImageSearchInput,
  ImageSearchResult,
  ChildrenNamesResponse,
} from "../types/image-search.js";

const GROUP_SERVICE_BASE =
  "https://sg30p0.familysearch.org/service/records/rms/group-service";
const ARTIFACT_BASE =
  "https://sg30p0.familysearch.org/service/records/rms";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": BROWSER_USER_AGENT,
    "FS-User-Agent-Chain": "chesworth",
  };
}

async function resolveGroupId(
  imageGroupNumber: string,
  token: string
): Promise<string> {
  if (imageGroupNumber.includes("_")) {
    const parts = imageGroupNumber.split("_");
    return parts[parts.length - 1];
  }

  let response: Response;
  try {
    response = await fetch(
      `${GROUP_SERVICE_BASE}/group/${encodeURIComponent(imageGroupNumber)}/apid`,
      { headers: headers(token) }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(
      `Could not reach FamilySearch image search API: ${message}.`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Could not resolve image group number ${imageGroupNumber} to an image group.`
    );
  }

  return (await response.text()).trim();
}

async function fetchChildren(
  groupId: string,
  token: string
): Promise<ChildrenNamesResponse> {
  let response: Response;
  try {
    response = await fetch(
      `${ARTIFACT_BASE}/artifact/group/${encodeURIComponent(groupId)}/children/names`,
      { headers: headers(token) }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(
      `Could not reach FamilySearch image search API: ${message}.`
    );
  }

  if (response.status === 401) {
    throw new Error(
      "FamilySearch session not accepted; call the login tool to re-authenticate."
    );
  }
  if (response.status === 403) {
    throw new Error("FamilySearch image search API error: 403 Forbidden.");
  }
  if (!response.ok) {
    throw new Error(
      `FamilySearch image search API error: ${response.status} ${response.statusText}.`
    );
  }

  return (await response.json()) as ChildrenNamesResponse;
}

export async function imageSearchTool(
  input: ImageSearchInput
): Promise<ImageSearchResult> {
  if (!input.imageGroupNumber) {
    throw new Error("image_search requires an imageGroupNumber.");
  }

  const token = await getValidToken();
  const groupId = await resolveGroupId(input.imageGroupNumber, token);
  const data = await fetchChildren(groupId, token);
  const imageIds = Object.values(data).sort();
  return { imageIds };
}

export const imageSearchSchema = {
  name: "image_search",
  description:
    "List the images in a single FamilySearch image group (a digitized " +
    "volume — one microfilm roll or book scan). Provide an imageGroupNumber " +
    "(from metadata_search) and get back the sorted list of image IDs in that " +
    "volume, each of the form '004884748_02613'. To view an image, pass its ID " +
    "to image_read. Use metadata_search " +
    "first to find which image groups cover a place and date range. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      imageGroupNumber: {
        type: "string",
        description:
          "The image group number to list, from metadata_search — either a " +
          "split Natural Group name like '007621224_005_M99P-2TQ' or a bare " +
          "number like '007621224'.",
      },
    },
    required: ["imageGroupNumber"],
  },
};
