// The persona a record_read caller asked for. One spelling, shared by
// record_read's page-image choice and the answer compactor. Imports only
// ./ark.js: staged-compaction.ts uses it, and the eval harness imports that
// module's compiled output in a bare node process, so nothing here may have a
// side effect at import.

import type { SimplifiedGedcomX, SimplifiedPerson } from "../types/gedcomx.js";
import { arkToBareId } from "./ark.js";

/** The persona whose `id`, or `ark` reduced to its bare id, equals the bare id
 *  of `requestedId`. Undefined when none does. */
export function findRequestedPersona(
  doc: Pick<SimplifiedGedcomX, "persons">,
  requestedId: string | undefined,
): SimplifiedPerson | undefined {
  if (typeof requestedId !== "string" || requestedId === "") return undefined;
  if (!Array.isArray(doc.persons)) return undefined;
  const wanted = arkToBareId(requestedId);
  return doc.persons.find(
    (pp) =>
      pp?.id === wanted ||
      (typeof pp?.ark === "string" && arkToBareId(pp.ark) === wanted),
  );
}
