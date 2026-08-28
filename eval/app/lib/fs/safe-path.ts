import path from 'path'

/**
 * Join untrusted segments onto a base directory and prove the result stayed
 * inside it.
 *
 * Every filesystem path in this app is built from a value that arrives over
 * HTTP — a request body field, a URL segment, or a key read out of a JSON file
 * a contributor committed. Each sink was written to its own standard, so the
 * containment question was answered differently, or not at all, in each one.
 * This is the single answer they all route through.
 *
 * **Resolve first, then compare.** Scanning the input for `..` before joining
 * does not work: `path.join` normalises, so a pre-check inspects a different
 * string than the one that gets opened, and misses anything that only becomes a
 * traversal after normalisation. The check has to be on the resolved result.
 *
 * **The separator matters.** `base` gets a trailing separator before the
 * `startsWith` test, so a sibling directory whose name merely begins with the
 * base name — `/tests/unit-backup` against a base of `/tests/unit` — is not
 * accepted as being inside it.
 *
 * Throws rather than returning null: a caller that forgets to check a null is
 * back where it started, whereas an unhandled throw fails the request loudly.
 */
export class PathEscapeError extends Error {
  constructor(
    readonly attempted: string,
    readonly base: string,
  ) {
    // Deliberately does not echo the resolved absolute path back to the caller.
    // The message reaches an HTTP response, and the resolved path would confirm
    // the layout of the operator's disk to whoever sent the request.
    super('path resolves outside its permitted directory')
    this.name = 'PathEscapeError'
  }
}

export function resolveWithin(base: string, ...segments: string[]): string {
  const resolvedBase = path.resolve(base)

  // No explicit absolute-segment branch. `path.resolve` discards everything
  // before an absolute segment, so the result lands outside the base and the
  // containment check below already rejects it — verified by mutation: deleting
  // such a branch failed nothing. The only case it would have changed is an
  // absolute path that resolves INSIDE the base, which is not an escape. A
  // guard that cannot fail reads as coverage, so it is not here.
  for (const segment of segments) {
    if (typeof segment !== 'string' || segment.length === 0) {
      throw new PathEscapeError(String(segment), resolvedBase)
    }
    // A NUL truncates the path at the syscall boundary, so a value that passes
    // this check can still open a different file than the one inspected.
    if (segment.includes('\0')) {
      throw new PathEscapeError(segment, resolvedBase)
    }
  }

  const resolved = path.resolve(resolvedBase, ...segments)

  if (resolved === resolvedBase) return resolved
  if (!resolved.startsWith(resolvedBase + path.sep)) {
    throw new PathEscapeError(segments.join('/'), resolvedBase)
  }
  return resolved
}

/**
 * True when `segments` resolve inside `base`, without throwing.
 *
 * For the callers that legitimately need to skip a bad entry rather than fail
 * the whole request — iterating a directory listing, or filtering a snapshot's
 * keys — where one unusable name should not discard the rest.
 */
export function isWithin(base: string, ...segments: string[]): boolean {
  try {
    resolveWithin(base, ...segments)
    return true
  } catch {
    return false
  }
}
