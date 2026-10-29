/**
 * FamilySearch's own standard_places for a place text on the record personas a
 * fact is about: the first step of the engine's answer (place-verdict.ts).
 *
 * A persona is an assertion's record and record persona. Its values are the
 * `standard_place`s on that persona's facts, and on the facts of the
 * relationships it is a party to, in the sidecar the assertion's log entry
 * names, and only in a sidecar marked as holding FamilySearch's own
 * (`standard_places_from`, which a live `record_read` sets). A `record_search`
 * sidecar mixes in the engine's own lookups, and an assertion's stored value may
 * be an engine lookup or an agent's pick, so neither is read.
 */
import { arkToBareId } from "./ark.js";
import { placeTextKey } from "./place-verdict.js";
import { FAMILYSEARCH_STANDARD_PLACES } from "./results-staging.js";

type Obj = Record<string, any>;
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** The facts of `persona` in a sidecar result: its own, and those of the
 *  relationships it is a party to. */
function personaFacts(result: Obj, persona: string): Obj[] {
  const gx = result.gedcomx;
  const holders = [
    ...list(gx?.persons).filter((p) => p?.id === persona),
    ...list(gx?.relationships).filter((r) => [r?.person1, r?.person2, r?.parent, r?.child].includes(persona)),
  ];
  return holders.flatMap((h) => list(h.facts));
}

/** FamilySearch's own standard_places, read through one call's sidecar reader. */
export class RecordStandards {
  private readonly logRefs = new Map<string, string>();

  /** `hintRefs`: an accepted hint's log id -> the record read staged for it in
   *  this call, which stands in for the sidecar the entry does not keep. */
  constructor(
    research: unknown,
    private readonly read: (ref: string) => Promise<Obj | null>,
    private readonly hintRefs?: ReadonlyMap<string, string>,
  ) {
    for (const e of list((research as Obj | null)?.log)) {
      if (typeof e?.id === "string" && typeof e.results_ref === "string") this.logRefs.set(e.id, e.results_ref);
    }
  }

  /** The distinct standard_places FamilySearch gives `place` on `personas`
   *  (assertions), case, accents and spacing aside. */
  async for(personas: readonly Obj[], place: string): Promise<string[]> {
    const key = placeTextKey(place);
    const found = new Set<string>();
    for (const a of personas) {
      const persona = a.record_persona_id;
      if (typeof persona !== "string") continue;
      const ref = this.hintRefs?.get(a.log_entry_id) ?? this.logRefs.get(a.log_entry_id);
      const sidecar = ref ? await this.read(ref) : null;
      if (sidecar?.standard_places_from !== FAMILYSEARCH_STANDARD_PLACES) continue;
      for (const r of list(sidecar.payload?.results)) {
        if (arkToBareId(r?.recordId) !== arkToBareId(a.record_id)) continue;
        for (const f of personaFacts(r, persona)) {
          if (typeof f.place === "string" && placeTextKey(f.place) === key && typeof f.standard_place === "string") {
            found.add(f.standard_place);
          }
        }
      }
    }
    return [...found];
  }
}

/** The assertions `ids` names. */
export function assertionsNamed(ids: unknown, research: unknown): Obj[] {
  const wanted = new Set(list(ids));
  return list((research as Obj | null)?.assertions).filter((a) => wanted.has(a?.id));
}

/** The assertions a tree fact is about: the one it was minted from, and those
 *  behind its sources (a source ref, its research sources, their assertions)
 *  that a live person_evidence link ties to one of `people`, the persons
 *  holding the fact. */
export function factAssertions(
  fact: { sources?: { ref?: unknown }[]; assertion_id?: unknown },
  people: readonly unknown[],
  research: unknown,
): Obj[] {
  const r = (research ?? {}) as Obj;
  const minted = typeof fact.assertion_id === "string" ? fact.assertion_id : null;
  const refs = new Set(list(fact.sources).map((s) => s?.ref));
  const sources = new Set(list(r.sources).filter((s) => refs.has(s?.gedcomx_source_description_id)).map((s) => s.id));
  const linked = new Set(
    list(r.person_evidence)
      .filter((pe) => people.includes(pe?.person_id) && !pe.superseded_by)
      .map((pe) => pe.assertion_id),
  );
  return list(r.assertions).filter((a) => a?.id === minted || (sources.has(a?.source_id) && linked.has(a?.id)));
}
