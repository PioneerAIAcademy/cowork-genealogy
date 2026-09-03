// Converts a FamilySearch ARK identifier to a URL suitable for openExternal.
// Mirrors toArk()/arkToUrl() in packages/engine/mcp-server/src/utils/ark.ts
// (duplicated here rather than imported — viewer-ui cannot depend on the
// engine, see CLAUDE.md "The web side depends on packages/schema, never on
// the engine").
//
// An ark-shaped field reaches the viewer in three forms: a full resolver URL
// (sidecars staged before #272 store it this way and are still on disk), a
// bare `ark:/61903/<n:n>:<id>`, and a type-prefixed `<n>:<n>:<id>`. Only the
// middle two need the host prefix added; the first is already a URL.
const FS_URL_PREFIX_RE = /^https?:\/\/(?:www\.)?familysearch\.org\//i
const BARE_PREFIXED_RE = /^\d:\d:[A-Za-z0-9.-]+$/

export function familySearchUrl(id: string): string {
  const trimmed = id.trim()
  if (FS_URL_PREFIX_RE.test(trimmed)) return trimmed
  const ark = BARE_PREFIXED_RE.test(trimmed) ? `ark:/61903/${trimmed}` : trimmed
  return ark.startsWith('ark:/') ? `https://www.familysearch.org/${ark}` : trimmed
}
