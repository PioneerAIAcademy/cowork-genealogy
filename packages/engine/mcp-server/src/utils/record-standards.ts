/**
 * The standard_places a project already stores for a place text on the records a
 * written place cites: the first step of the engine's answer (place-verdict.ts).
 * A record's are those on the assertions from it, and on its facts in the
 * sidecars those assertions came from.
 */
import { arkToBareId } from "./ark.js";
import { placeTextKey } from "./place-verdict.js";
import { getProjectStore } from "../store/project-store.js";

type Obj = Record<string, unknown>;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Every fact of a sidecar result's gedcomx, persons' and relationships'. */
function factsOf(record: unknown): Obj[] {
  const gx = (record as { gedcomx?: { persons?: unknown; relationships?: unknown } } | null)?.gedcomx;
  return [...list(gx?.persons), ...list(gx?.relationships)].flatMap((h) => list((h as Obj | null)?.facts)) as Obj[];
}

/** The results a sidecar holds; none when it cannot be read. */
async function readSidecar(projectPath: string, ref: string): Promise<unknown[]> {
  try {
    return list(JSON.parse(await getProjectStore().readText(projectPath, ref))?.payload?.results);
  } catch {
    return [];
  }
}

/** The standard_places a project stores, read by the records they came from. */
export class RecordStandards {
  private readonly logRefs = new Map<string, string>();

  constructor(
    private readonly projectPath: string,
    private readonly research: unknown,
  ) {
    for (const e of list((research as Obj | null)?.log)) {
      const { id, results_ref: ref } = (e ?? {}) as Obj;
      if (typeof id === "string" && typeof ref === "string") this.logRefs.set(id, ref);
    }
  }

  /** The distinct standard_places stored for `place` on `recordIds` (bare ids):
   *  on the assertions from those records, and on those records' facts in the
   *  sidecars the assertions came from and in `inHand`, results already read. */
  async for(recordIds: ReadonlySet<string>, place: string, inHand: unknown[] = []): Promise<string[]> {
    const key = placeTextKey(place);
    const found = new Set<string>();
    const add = (p: unknown, sp: unknown) => {
      if (typeof p === "string" && placeTextKey(p) === key && typeof sp === "string" && sp.trim() !== "") found.add(sp);
    };
    const assertions = list((this.research as Obj | null)?.assertions).filter(
      (a) => typeof (a as Obj | null)?.record_id === "string" && recordIds.has(arkToBareId((a as Obj).record_id as string)),
    ) as Obj[];
    for (const a of assertions) add(a.place, a.standard_place);
    const refs = new Set<string>();
    for (const a of assertions) {
      const ref = typeof a.log_entry_id === "string" ? this.logRefs.get(a.log_entry_id) : undefined;
      if (ref) refs.add(ref);
    }
    const sidecars = await Promise.all([...refs].map((ref) => readSidecar(this.projectPath, ref)));
    for (const results of [inHand, ...sidecars]) {
      for (const r of results) {
        const id = (r as Obj | null)?.recordId;
        if (typeof id !== "string" || !recordIds.has(arkToBareId(id))) continue;
        for (const f of factsOf(r)) add(f.place, f.standard_place);
      }
    }
    return [...found];
  }
}

/** The bare ids of the records behind `assertionIds`. */
export function recordsOfAssertions(assertionIds: unknown, research: unknown): Set<string> {
  const wanted = new Set(list(assertionIds));
  const out = new Set<string>();
  for (const a of list((research as Obj | null)?.assertions)) {
    const { id, record_id: rec } = (a ?? {}) as Obj;
    if (wanted.has(id) && typeof rec === "string") out.add(arkToBareId(rec));
  }
  return out;
}

/** The bare ids of the records a tree fact cites: those of the assertions behind
 *  its sources (a source ref, its research source, that source's assertions)
 *  and of the assertion it was minted from. */
export function recordsCitedBy(
  fact: { sources?: { ref?: unknown }[]; assertion_id?: unknown },
  research: unknown,
): Set<string> {
  const refs = new Set<unknown>(list(fact.sources).map((s) => (s as Obj | null)?.ref).filter((r) => typeof r === "string"));
  const sourceIds = new Set<unknown>();
  for (const s of list((research as Obj | null)?.sources)) {
    const { id, gedcomx_source_description_id: sid } = (s ?? {}) as Obj;
    if (typeof id === "string" && refs.has(sid)) sourceIds.add(id);
  }
  const out = recordsOfAssertions(fact.assertion_id === undefined ? [] : [fact.assertion_id], research);
  for (const a of list((research as Obj | null)?.assertions)) {
    const { source_id: src, record_id: rec } = (a ?? {}) as Obj;
    if (sourceIds.has(src) && typeof rec === "string") out.add(arkToBareId(rec));
  }
  return out;
}
