import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { fetchWithTimeout } from "../utils/http.js";
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
    response = await fetchWithTimeout(
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
    response = await fetchWithTimeout(
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

/**
 * Keep only the values that are actually image IDs.
 *
 * `ChildrenNamesResponse` is asserted from `response.json()`, not checked, and
 * the endpoint does not always honour it: observed live 2026-08-25 on group
 * `M9SW-1CG` returning its full 164 keys with `null` as the value of one of
 * them (image `004514823_00672`). Unfiltered, that null reached the caller as
 * an image ID *and* took the real image off the list, so the page could not be
 * browsed at all. `dropped` is what tells the caller the response was defective
 * — it is the retry trigger below, since a defective value is not recoverable
 * from the response itself.
 */
function usableImageIds(data: ChildrenNamesResponse): {
  imageIds: string[];
  dropped: number;
} {
  const values = Object.values(data as Record<string, unknown>);
  const imageIds = values.filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  return { imageIds, dropped: values.length - imageIds.length };
}

export async function imageSearchTool(
  input: ImageSearchInput
): Promise<ImageSearchResult> {
  if (!input.imageGroupNumber) {
    throw new Error("image_search requires an imageGroupNumber.");
  }

  const token = await getValidToken();
  const groupId = await resolveGroupId(input.imageGroupNumber, token);

  let best = usableImageIds(await fetchChildren(groupId, token));

  // One re-request when the response was defective. The same group returned a
  // complete set on every other call, so a retry is what recovers the lost
  // image rather than silently serving a list one page short. Bounded to a
  // single extra call, and it can only ever improve the result: a retry that
  // is defective too, or that fails outright with a 500/401/timeout, leaves
  // `best` standing rather than failing a browse the caller can still mostly
  // use. Usable IDs are the primary comparison and `dropped` only breaks a
  // tie, so a clean-but-shorter retry can never displace a longer one.
  if (best.dropped > 0) {
    try {
      const retry = usableImageIds(await fetchChildren(groupId, token));
      if (
        retry.imageIds.length > best.imageIds.length ||
        (retry.imageIds.length === best.imageIds.length &&
          retry.dropped < best.dropped)
      ) {
        best = retry;
      }
    } catch {
      // Keep `best` — a failed retry must not lose a usable browse list.
    }
  }

  return { imageIds: best.imageIds.sort() };
}

export const imageSearchSchema = {
  name: "image_search",
  description:
    "List the images in a single FamilySearch image group (a digitized " +
    "volume — one microfilm roll or book scan). Provide an imageGroupNumber " +
    "(from volume_search) and get back the sorted list of image IDs in that " +
    "volume, each of the form '004884748_02613'. To view an image, pass its ID " +
    "to image_read. Use volume_search " +
    "first to find which image groups cover a place and year range. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      imageGroupNumber: {
        type: "string",
        description:
          "The image group number to list, from volume_search — either a " +
          "split Natural Group name like '007621224_005_M99P-2TQ' or a bare " +
          "number like '007621224'.",
      },
    },
    required: ["imageGroupNumber"],
  },
};
