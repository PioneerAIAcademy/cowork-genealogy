/**
 * Derive the collection-title search term from a place. FamilySearch organizes
 * record collections at the state/province level for the United States, Canada,
 * and Mexico, and at the country level everywhere else. Given a `standardPlace`
 * (the fully-qualified name from place_search, e.g.
 * "Schuylkill, Pennsylvania, United States"), return the right title-match term:
 *   - United States   -> the state            ("Pennsylvania")
 *   - Canada / Mexico  -> "Country, State"      ("Canada, Ontario")
 *   - everywhere else  -> the country          ("France")
 *
 * The standardPlace format is comma-separated with the country last and the
 * state/province second-to-last. A free-text query that isn't a standardPlace
 * (no recognized country tail, e.g. "Census" or "Schuylkill County Pennsylvania")
 * passes through unchanged, so the tool still accepts an arbitrary place query.
 */
export function standardPlaceToCollectionsQuery(value: string): string {
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return value.trim();

  const country = parts[parts.length - 1];
  const state = parts.length >= 2 ? parts[parts.length - 2] : undefined;

  if (country === "United States") return state ?? country;
  if (country === "Canada" || country === "Mexico") {
    return state ? `${country}, ${state}` : country;
  }
  return country;
}
