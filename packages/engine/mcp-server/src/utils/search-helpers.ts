// Shared helpers for the FamilySearch search tools (`record_search`,
// `person_search`, `collections_search`, `volume_search`). They wrap FS search
// endpoints and need the same generic input validators, output shaping and
// response helpers — kept here so there is a single copy rather than a
// near-duplicate in each tool.

/** True for a plausible 4-digit calendar year. */
export function isFourDigitYear(value: number): boolean {
  return Number.isInteger(value) && value >= 1000 && value <= 9999;
}

/**
 * True for an absolute `http:`/`https:` URL. The shape check for any
 * caller-composed, URL-typed string on its way into a URL the researcher will
 * click (`build_external_search_url`'s `baseUrl`) or into `research.json`
 * (`research_log_append`'s `externalSite.urlGenerated`) — a plain label, a
 * `javascript:`/`data:` value, or a relative path is a caller error in both.
 * `new URL()` strips leading/trailing whitespace before parsing, so a padded
 * value passes here; callers that go on to use the string trim it first.
 */
export function isHttpUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * True for a non-negative integer no greater than `max` (unbounded by default).
 * The one predicate behind `results_examined` (writer and validator alike) and
 * `build_external_search_url`'s bounded tuning knobs, so the rule cannot drift.
 */
export function isNonNegativeInteger(n: unknown, max = Number.POSITIVE_INFINITY): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
}

/**
 * A display date range from a `startYear`/`endYear` pair.
 *
 * One format for every search tool that shows a span, so two tools cannot
 * describe the same years differently. Equal years are **not** collapsed —
 * `1683-1683`, not `1683` — and a lone `endYear` yields `""`, because only
 * `startYear` is special-cased. Callers whose field is optional treat `""` as
 * "omit"; `collections_search`, whose `dateRange` is a required string, emits it.
 */
export function formatYearRange(
  startYear: number | undefined,
  endYear: number | undefined
): string {
  return startYear != null && endYear != null
    ? `${startYear}-${endYear}`
    : startYear != null
      ? `${startYear}`
      : "";
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
