/**
 * What stops a re-extraction from retiring a record's assertions (#3678).
 *
 * An assertion is retired only while nothing rests on it: a retirement that
 * left a live link, a tree fact, a proof or a conflict citing it would leave
 * that entry standing on evidence the project no longer believes. One function
 * answers it, so `extraction_append`'s early check and `research_append`'s
 * check under the lock cannot disagree.
 */
import { isLiveAssertion } from "./assertion-liveness.js";
import { isRelationshipEstablishing } from "./source-ref-resolver.js";

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const bareRef = (ref: unknown): string | undefined =>
  typeof ref === "string" && ref !== "" ? ref.replace(/^#/, "") : undefined;

/** The tree `S` ids of the research sources these assertions cite. */
function sourceDescriptionIds(research: any, assertions: any[]): Set<string> {
  const srcIds = new Set(assertions.map((a) => a?.source_id).filter((s) => typeof s === "string"));
  const out = new Set<string>();
  for (const s of arr(research?.sources)) {
    if (srcIds.has(s?.id) && typeof s?.gedcomx_source_description_id === "string") {
      out.add(s.gedcomx_source_description_id);
    }
  }
  return out;
}

/**
 * One line per entry that still rests on any of `ids`, each naming the entry and
 * what to do. Empty when the assertions may be retired.
 */
export function assertionReferrers(research: any, tree: any, ids: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const hit = (v: unknown) => typeof v === "string" && ids.has(v);
  const hits = (v: unknown) => arr(v).filter(hit);

  for (const pe of arr(research?.person_evidence)) {
    if (pe?.superseded_by == null && hit(pe?.assertion_id)) {
      out.push(`person_evidence ${pe.id} links ${pe.assertion_id} to ${pe.person_id}; supersede that link first.`);
    }
  }
  for (const rj of arr(research?.rejected_links)) {
    if (hit(rj?.assertion_id)) {
      out.push(
        `rejected_links ${rj.id}: a researcher ruled ${rj.assertion_id} is not ${rj.person_id}. Re-extraction ` +
          "would void that ruling, and a rejection is never removed, so this record cannot be re-extracted. " +
          "Ask the researcher.",
      );
    }
  }
  for (const ps of arr(research?.proof_summaries)) {
    const cited = [...hits(ps?.supporting_assertion_ids), ...arr(ps?.claims).flatMap((c: any) => hits(c?.supporting_assertion_ids))];
    if (cited.length > 0) out.push(`proof_summaries ${ps.id} cites ${[...new Set(cited)].join(", ")}.`);
  }
  for (const c of arr(research?.conflicts)) {
    const cited = [...hits(c?.competing_assertion_ids), ...(hit(c?.preferred_assertion_id) ? [c.preferred_assertion_id] : [])];
    if (cited.length > 0) out.push(`conflicts ${c.id} cites ${[...new Set(cited)].join(", ")}.`);
  }
  for (const h of arr(research?.hypotheses)) {
    const cited = [...hits(h?.supporting_assertion_ids), ...hits(h?.contradicting_assertion_ids)];
    if (cited.length > 0) out.push(`hypotheses ${h.id} cites ${[...new Set(cited)].join(", ")}.`);
  }
  for (const t of arr(research?.timelines)) {
    const cited = arr(t?.events).flatMap((e: any) => hits(e?.assertion_ids));
    if (cited.length > 0) out.push(`timelines ${t.id} cites ${[...new Set(cited)].join(", ")}.`);
  }
  for (const q of arr(research?.questions)) {
    const cited = hits(q?.resolution_assertion_ids);
    if (cited.length > 0) out.push(`questions ${q.id} names ${cited.join(", ")} as its resolution.`);
  }

  const holders = [
    ...arr(tree?.persons).map((p: any) => ({ id: p?.id, facts: p?.facts })),
    ...arr(tree?.relationships).map((r: any) => ({ id: r?.id, facts: r?.facts })),
  ];
  for (const h of holders) {
    for (const f of arr(h.facts)) {
      if (hit(f?.assertion_id)) {
        out.push(`tree fact ${f.id ?? f.type} on ${h.id} was written from ${f.assertion_id}; correct it with tree_correct first.`);
      }
    }
  }

  // A tree edge keeps only its source's S, never the assertion (tree_edit
  // add_relationship), so an edge built from this record's relationship claim is
  // found by its S.
  const targets = arr(research?.assertions).filter((a) => ids.has(a?.id));
  if (targets.some((a) => isRelationshipEstablishing(a?.fact_type))) {
    const sIds = sourceDescriptionIds(research, targets);
    for (const rel of arr(tree?.relationships)) {
      const refs = arr(rel?.sources).map((s: any) => bareRef(s?.ref)).filter((r): r is string => r !== undefined);
      const mine = refs.filter((r) => sIds.has(r));
      if (mine.length === 0) continue;
      const others = [...new Set(refs.filter((r) => !sIds.has(r)))];
      out.push(
        others.length === 0
          ? `tree relationship ${rel.id} rests on this record alone (${mine.join(", ")}). If the record is wrong, ` +
              `remove the edge with tree_correct first.`
          : `tree relationship ${rel.id} cites this record (${mine.join(", ")}) and also ${others.join(", ")}. It ` +
              "stands on that other evidence too: leave it in place and ask the researcher.",
      );
    }
  }
  return out;
}

/**
 * Tree persons whose names cite the S of a retracted relationship claim: a
 * person `materialize_facts` minted as that claim's other party, which carries
 * no assertion id to find it by. Reported, not refused.
 */
export function personsNamedFromRetracted(research: any, tree: any, retracted: ReadonlySet<string>): string[] {
  const claims = arr(research?.assertions).filter((a) => retracted.has(a?.id) && isRelationshipEstablishing(a?.fact_type));
  if (claims.length === 0) return [];
  const sIds = sourceDescriptionIds(research, claims);
  return arr(tree?.persons)
    .filter((p: any) => arr(p?.names).some((n: any) => arr(n?.sources).some((s: any) => sIds.has(bareRef(s?.ref) ?? ""))))
    .map((p: any) => p.id);
}

/** The live assertions extracted under exactly this record id. */
export function liveAssertionsOfRecord(research: any, bareRecordId: string, toBare: (id: string) => string): any[] {
  return arr(research?.assertions).filter(
    (a) => isLiveAssertion(a) && typeof a.record_id === "string" && toBare(a.record_id) === bareRecordId,
  );
}
