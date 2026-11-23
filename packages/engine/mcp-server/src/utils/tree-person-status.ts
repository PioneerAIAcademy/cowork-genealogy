// What a GET on the FamilySearch tree-persons endpoint's status code says about
// one person. Shared by `person_read`, which turns each status into an error
// or follows it, and by the match tools' existence check (`match-by-id.ts`),
// which reads only the status. The mapping is kept in one place so the two
// cannot disagree about what a 403 or a 410 means.

export const TREE_PERSONS_BASE =
  "https://api.familysearch.org/platform/tree/persons";

export const TREE_PERSON_ACCEPT = "application/x-fs-v1+json";

export type TreePersonStatus =
  | "found" // a body to read
  | "living" // 204: a living person, no body
  | "merged" // 301: the Location header names the survivor
  | "unauthorized" // 401
  | "restricted" // 403: the person exists but is not viewable
  | "not_found" // 404
  | "deleted" // 410
  | "rate_limited" // 429
  | "error"; // any other non-2xx

/** The order matches the ladder `person_read` always used: 204 and 301 are
 *  answered before the error statuses, and `!ok` is the catch-all. */
export function classifyTreePersonStatus(res: {
  status: number;
  ok: boolean;
}): TreePersonStatus {
  if (res.status === 204) return "living";
  if (res.status === 301) return "merged";
  if (res.status === 401) return "unauthorized";
  if (res.status === 403) return "restricted";
  if (res.status === 404) return "not_found";
  if (res.status === 410) return "deleted";
  if (res.status === 429) return "rate_limited";
  if (!res.ok) return "error";
  return "found";
}

/** The person id in a tree-persons `Location` header, or null. */
export function extractPersonId(locationHeader: string): string | null {
  const match = locationHeader.match(/\/persons\/([^/?#]+)/);
  return match ? match[1] : null;
}
