/**
 * Reading a FamilySearch 403 (issue #4707).
 *
 * Its own module, importing nothing, so an unauthenticated tool can use it
 * without importing `fs-fetch.ts` and the token code behind it — the control
 * plane's reauth hook finds the tools that reach the token by their imports.
 */
/** What a FamilySearch 403 says about itself (issue #4707). */
export interface ForbiddenBody {
  /** The Imperva firewall's own refusal: a JSON body with `errorCode: "15"`. */
  firewall: boolean;
  /** The body's first 120 characters, whitespace collapsed; "" when it has none. */
  snippet: string;
}

/** Reads a 403's body once. Only a body carrying the firewall's
 *  `errorCode: "15"` is a firewall block; any other 403 is FamilySearch refusing
 *  the request, which says nothing about the User-Agent. Never throws: an
 *  unreadable body is an empty, non-firewall one. */
export async function readForbidden(response: Response): Promise<ForbiddenBody> {
  let text = "";
  try {
    text = await response.text();
  } catch {
    text = "";
  }
  let firewall = false;
  try {
    const body: unknown = JSON.parse(text);
    firewall =
      body !== null &&
      typeof body === "object" &&
      (body as { errorCode?: unknown }).errorCode === "15";
  } catch {
    firewall = false;
  }
  return { firewall, snippet: text.replace(/\s+/g, " ").trim().slice(0, 120) };
}
