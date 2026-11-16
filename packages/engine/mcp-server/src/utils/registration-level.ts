/**
 * A locality's `registration_start[].level` as the model writes it, read into the
 * closed `registration_level` list (research-append-tool-spec.md, "A locality's
 * registration levels").
 *
 * The model writes a level with a note in brackets (`national (GRO)`), two levels
 * joined (`county/town`), or a `-wide` form (`statewide`). Each was a refused entry
 * append, and the entry is 6,000 characters to send again.
 */

const WIDE: Record<string, string> = { nation: "national" };
/** Words that say nothing beyond the level itself, so they earn no note. */
const FILLER = new Set(["level", "and", "or", "the"]);

/** The list word a word stands for (`statewide` is `state`), or null. */
function levelWord(word: string, allowed: ReadonlySet<string>): string | null {
  if (allowed.has(word)) return word;
  const wide = /^([a-z]+)wide$/.exec(word);
  if (!wide) return null;
  const stem = WIDE[wide[1]] ?? wide[1];
  return allowed.has(stem) ? stem : null;
}

/**
 * `rows` with each rewritable row replaced by one row per level it names.
 *
 * A level is every list word in the text OUTSIDE brackets: a level word inside a
 * note (`non-Catholic civil registry (parallel to parish)`) names no level, and
 * that row is left for the validator to refuse. The text as written is kept in
 * `note` when it said more than the levels, unless the row already has a note.
 * Rows already valid come back unchanged (the same objects), and the input array
 * itself is returned when nothing changed.
 */
export function normalizeRegistrationStart(rows: unknown, allowed: ReadonlySet<string>): unknown {
  if (!Array.isArray(rows)) return rows;
  let changed = false;
  const out: unknown[] = [];
  for (const row of rows) {
    const level = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>).level : undefined;
    if (typeof level !== "string" || allowed.has(level)) {
      out.push(row);
      continue;
    }
    const outside = level.replace(/\([^()]*\)/g, " ");
    const words = outside.toLowerCase().split(/[^a-z]+/).filter((w) => w !== "");
    const levels = [...new Set(words.flatMap((w) => levelWord(w, allowed) ?? []))];
    if (levels.length === 0) {
      out.push(row);
      continue;
    }
    const saidMore = outside !== level || words.some((w) => levelWord(w, allowed) === null && !FILLER.has(w));
    const existing = (row as Record<string, unknown>).note;
    const note = typeof existing === "string" && existing.trim() !== "" ? existing : saidMore ? level.trim() : "";
    for (const l of levels) {
      const next: Record<string, unknown> = { ...(row as Record<string, unknown>), level: l };
      if (note !== "") next.note = note;
      out.push(next);
    }
    changed = true;
  }
  return changed ? out : rows;
}
