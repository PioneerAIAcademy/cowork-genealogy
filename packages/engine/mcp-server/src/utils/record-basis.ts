/**
 * Read an assertion's `record_basis`, understanding documents written before
 * the rename (#2524).
 *
 * `evidence_type` (`direct` | `indirect` | `negative`) became `record_basis`
 * (`stated` | `inferred` | `absent`) on 2026-09-18. The schema change is
 * handled for legacy documents by `validation/introduced-errors.ts` (#1572),
 * which demotes pre-existing validation errors to warnings so a drifted project
 * is not frozen. That tolerance says nothing about code that reads a VALUE, and
 * three such readers gate user-visible behaviour:
 *
 *   - `tools/materialize-facts.ts` — four gates deciding what is written into
 *     the user's family tree. Reading only the new key on a legacy document
 *     yields `undefined`, so an "expected but ABSENT from this record"
 *     assertion would materialize as though the record had stated the value.
 *   - `utils/source-ref-resolver.ts` — GEDCOM source ref quality.
 *   - `tools/research-append.ts` — the hypothesis-promotion evidence floor.
 *
 * Project folders persist across sessions and the `.mcpb` is installed on
 * users' machines, so legacy documents are live input, not a migration
 * hypothetical.
 *
 * Read-only by design: nothing here rewrites the document. That matches how
 * #1572 treats the other legacy drift keys — tolerate and warn, never silently
 * rewrite the researcher's file.
 */

/** The three values `record_basis` may hold. */
export type RecordBasis = "stated" | "inferred" | "absent";

/**
 * The retired `evidence_type` value set and what each became.
 *
 * `direct`/`indirect` were mechanical all along — "the record stated it" versus
 * "we inferred it" — and the new names say so. `negative` -> `absent` keeps the
 * same meaning: the value was expected and the record did not carry it.
 */
export const LEGACY_RECORD_BASIS: Readonly<Record<string, RecordBasis>> = {
  direct: "stated",
  indirect: "inferred",
  negative: "absent",
};

const CURRENT = new Set<string>(["stated", "inferred", "absent"]);

/**
 * The assertion's `record_basis`, or `undefined` when it carries no usable
 * classification in either spelling.
 *
 * `undefined` rather than a default: every caller compares against a literal,
 * so `undefined` reads as "not an absence" — the same answer they gave for an
 * unclassified assertion before this module existed. Defaulting would invent a
 * classification the document never made.
 *
 * An unrecognized value in either field also yields `undefined`. It is a
 * document defect the validator already reports, and passing it through would
 * let it reach a `===` compare in one of the gates above.
 */
export function recordBasisOf(assertion: unknown): RecordBasis | undefined {
  if (assertion === null || typeof assertion !== "object") return undefined;
  const a = assertion as Record<string, unknown>;

  // The new field wins on a half-migrated document: it is the one the
  // validator and every writer tool enforce.
  const current = a.record_basis;
  if (typeof current === "string" && CURRENT.has(current)) {
    return current as RecordBasis;
  }

  const legacy = a.evidence_type;
  if (typeof legacy === "string") {
    return LEGACY_RECORD_BASIS[legacy];
  }
  return undefined;
}
