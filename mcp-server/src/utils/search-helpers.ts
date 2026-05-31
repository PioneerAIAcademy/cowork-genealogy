// Shared helpers for the FamilySearch search tools (`record_search`,
// `person_search`). Both wrap FS search endpoints and need the same generic
// input validators and response helpers — kept here so there is a single
// copy rather than a near-duplicate in each tool.

/** True for a plausible 4-digit calendar year. */
export function isFourDigitYear(value: number): boolean {
  return Number.isInteger(value) && value >= 1000 && value <= 9999;
}

/**
 * Normalize a sex string to the GedcomX canonical form, case-insensitively.
 * Returns null for unrecognized values so callers can raise a validation
 * error.
 */
export function normalizeSex(value: string): string | null {
  const lookup: Record<string, string> = {
    male: "Male",
    female: "Female",
    unknown: "Unknown",
  };
  return lookup[value.toLowerCase()] ?? null;
}

/**
 * Pull a human-readable detail out of an FS search 400 error body
 * (shape: `{ errors: [{ message }] }` or `{ errors: ["..."] }`). Returns
 * null when nothing usable is present, so callers can fall back to a
 * generic message.
 */
export function parseUpstreamErrorBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const detail = errors
    .map((e) => {
      if (typeof e === "string") return e;
      if (e && typeof e === "object") {
        const msg = (e as { message?: unknown }).message;
        if (typeof msg === "string") return msg;
      }
      return null;
    })
    .filter((s): s is string => s !== null)
    .join("; ");
  return detail || null;
}

/**
 * Echo back only the input fields the caller actually supplied (drops
 * `undefined`), preserving the input's shape. Used to mirror the query in
 * a tool's response.
 */
export function echoQuery<T extends object>(input: T): Partial<T> {
  const echo: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) echo[key] = value;
  }
  return echo as Partial<T>;
}
