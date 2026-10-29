/**
 * The one error type every solution throws. `code` is what a caller branches on
 * (e.g. to pick an HTTP status); `message` is safe to show a user.
 */
export type ErrorCode =
  | "bad_input" // the caller's input is malformed or names the wrong kind of thing
  | "unauthorized" // a token or API key is missing, expired or rejected
  | "forbidden" // the user may not see this (e.g. a rights-restricted image)
  | "not_found"
  | "too_large"
  | "upstream"; // FamilySearch or the LLM failed or answered with something unusable

export class SolutionError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SolutionError";
  }
}
