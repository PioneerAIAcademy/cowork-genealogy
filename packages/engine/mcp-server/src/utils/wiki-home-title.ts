/**
 * Decide whether a FamilySearch Research Wiki page title is the HOME page of a
 * given standard place (issue #2486 item B, absorbed from issue #2078).
 *
 * The wiki names a sub-state page with its parent and usually a type word —
 * `Schuylkill County, Pennsylvania Genealogy`, `East Baton Rouge Parish,
 * Louisiana Genealogy`, `Barsebäck Parish, Malmöhus, Sweden Genealogy` — which
 * no slug grammar built from the standardPlace's leaf can produce. The title
 * comes from the wiki's own search ranking instead, and this module rejects the
 * ranked titles that are not this place's page.
 *
 * Two traps decide the rules, both measured against the live wiki 2026-10-12:
 *  - A near-tie between legally separate places: "St. Louis, Missouri" ranks
 *    `St. Louis City, Missouri Genealogy` and `St. Louis County, Missouri
 *    Genealogy` together, and both contain the leaf and the parent. Only the
 *    Places API `type` (Independent City) separates them, so a title whose
 *    leaf carries a type word is accepted only when that word fits the type.
 *  - The Places API type is not the wiki's word: East Baton Rouge is typed
 *    `County` but the wiki says `Parish` (Louisiana), and Alaska's equivalents
 *    are boroughs. `County` therefore also admits Parish and Borough.
 */

export type HomeTitleShape =
  | { ok: false }
  | { ok: true; typeWord: string | null; head: string };

/** Titles arrive percent-encoded for non-ASCII names (`Barseb%C3%A4ck`). */
export function decodeWikiTitle(title: string): string {
  try {
    return decodeURIComponent(title).normalize("NFC");
  } catch {
    return title.normalize("NFC");
  }
}

/**
 * The shape check, before any type lookup. `parts` is the standardPlace split
 * on commas. Accepted only when the title:
 *  - is a home page (`... Genealogy`);
 *  - starts with the leaf at a word boundary (`Gloucester` must not match
 *    `Gloucestershire`), with at most a type phrase after it;
 *  - names the place's DIRECT PARENT as its first container, with at most a
 *    type word after it (`Ulster County`). Any intermediate jurisdiction is not
 *    enough: `Los Angeles, Los Angeles County, California Genealogy` is the
 *    city's page and names the state, but its parent is the county, so it is
 *    never taken for Los Angeles County. Nor is `Washington, United States
 *    Genealogy`, the state's page, taken for a Washington County.
 */
export function homeTitleShape(title: string, parts: string[]): HomeTitleShape {
  const t = decodeWikiTitle(title).trim();
  const SUFFIX = " Genealogy";
  if (!t.endsWith(SUFFIX)) return { ok: false };
  const head = t.slice(0, -SUFFIX.length);
  const [first, ...rest] = head.split(",").map((s) => s.trim());
  const leaf = (parts[0] ?? "").trim().normalize("NFC");
  if (!leaf || !first) return { ok: false };
  if (!first.toLowerCase().startsWith(leaf.toLowerCase())) return { ok: false };
  const after = first.slice(leaf.length);
  if (after && !/^[\s(]/.test(after)) return { ok: false };
  const remainder = after.trim();
  if (remainder && !/^\(?[A-Za-z ]+\)?$/.test(remainder)) return { ok: false };

  const parent = (parts[1] ?? "").trim().normalize("NFC").toLowerCase();
  const container = (rest[0] ?? "").normalize("NFC");
  if (!parent || !container.toLowerCase().startsWith(parent)) return { ok: false };
  const tail = container.slice(parent.length);
  if (tail && !/^\s+\(?[A-Za-z ]+\)?$/.test(tail)) return { ok: false };

  const typeWord = remainder
    ? remainder.replace(/[()]/g, " ").trim().split(/\s+/).pop()!.toLowerCase()
    : null;
  return { ok: true, typeWord, head };
}

/** Whether a title's type word fits the Places API `type` for the place. */
export function typeWordFits(typeWord: string, placeType: string | null): boolean {
  if (!placeType) return false;
  const ty = placeType.toLowerCase();
  if (ty.includes(typeWord)) return true;
  return ty.includes("county") && (typeWord === "parish" || typeWord === "borough");
}
