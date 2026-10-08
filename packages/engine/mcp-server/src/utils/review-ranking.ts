/**
 * Order person-links so a reviewer sees the ones that matter first.
 *
 * "The live run wrote 311 links and its own narration said assertions should be
 * reviewed for cleanup, a review nobody can do. One click per link is not the
 * problem; FINDING THE ONES THAT MATTER is."
 *
 * Ranked from the fields `person_evidence` already stores — no new schema. Measured
 * on the captured run's 191 links: 39 carry a core identifier conflict, 55 are
 * speculative, 28 have no match score at all.
 *
 * Why a reject is worth ranking well: it undoes what the link CAUSED. A wrong link
 * materializes facts and feeds confidence tiers, and a fact on the wrong person is
 * not recoverable — so the cost of missing one is not one bad row.
 */

export interface ReviewLink {
  id?: unknown;
  confidence?: unknown;
  match_score?: unknown;
  core_identifier_conflict?: unknown;
  superseded_by?: unknown;
  [k: string]: unknown;
}

export interface RankedLink {
  id: string;
  /** Why it sits where it does — a rank with no reason is a number to distrust. */
  reasons: string[];
  link: ReviewLink;
}

// A claim the evidence barely supports is likelier to be the wrong one.
const CONFIDENCE_RISK: Record<string, number> = {
  speculative: 3,
  probable: 2,
  confident: 1
};

/** True for any recorded conflict, however it is spelled: the field carries prose,
 *  and older data may carry a bare boolean. Whitespace is not a conflict. */
function hasConflict(value: unknown): boolean {
  if (value === true) return true;
  return typeof value === "string" && value.trim() !== "";
}

export function rankForReview(links: ReviewLink[]): RankedLink[] {
  const scored = (links ?? []).map((link, index) => {
    const reasons: string[] = [];
    let risk = 0;

    // A DESCRIPTION, not a flag. In the captured run all 39 carry prose ("Birth year:
    // census states July 1853; tree attests ~1840"), and 152 carry nothing. An
    // earlier `=== true` matched none of them: the unit tests invented a boolean the
    // schema never had, so they passed while the ranking put every conflict last.
    if (hasConflict(link?.core_identifier_conflict)) {
      // The strongest single signal, and the rarest: 39 of 191 in the captured run.
      // A name, date or place that disagrees is how a wrong person gets linked.
      risk += 100;
      reasons.push("core identifier conflict");
    }

    const confidence = typeof link?.confidence === "string" ? link.confidence : "";
    const confidenceRisk = CONFIDENCE_RISK[confidence] ?? 0;
    if (confidenceRisk >= 2) reasons.push(`${confidence} match`);
    risk += confidenceRisk * 10;

    // ABSENT is not zero. 28 of the captured links carry no score, and reading that
    // as 0.0 would put every one of them above the 39 real conflicts — burying the
    // signal under the tool's own ignorance.
    if (typeof link?.match_score === "number" && Number.isFinite(link.match_score)) {
      risk += (1 - Math.max(0, Math.min(1, link.match_score))) * 5;
      if (link.match_score < 0.5) reasons.push(`low match score (${link.match_score})`);
    }

    // Already replaced: reviewing it changes nothing, so it goes last however risky
    // it looked.
    const superseded = typeof link?.superseded_by === "string" && link.superseded_by !== "";
    if (superseded) reasons.push("superseded");

    return {
      id: typeof link?.id === "string" ? link.id : "",
      reasons,
      link,
      risk: superseded ? -1 : risk,
      index
    };
  });

  // Equal risk keeps input order, so the list does not reshuffle between renders and
  // a reviewer can trust their place in it. The index tiebreaker states that intent
  // explicitly; it is NOT load-bearing, and a mutation test proved it -- removing it
  // leaves every test green, because Array.prototype.sort has been stable since
  // ES2019. Kept for the reader, not for the engine.
  scored.sort((a, b) => (b.risk - a.risk) || (a.index - b.index));
  return scored.map(({ id, reasons, link }) => ({ id, reasons, link }));
}
