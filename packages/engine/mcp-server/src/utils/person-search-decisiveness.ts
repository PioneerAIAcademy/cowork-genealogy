/**
 * Whether a `person_search` result picks one person, or needs a human to.
 *
 * `init-project` currently says "in single-turn mode, select the top candidate". When
 * the evidence is decisive that is right and saves a turn. When it is not, a wrong
 * pick spends a whole job — and a run on this branch did exactly that: 35,921 matches
 * for "Mary Hales", no way to tell them apart, and the turn stalled.
 *
 * DERIVED from a live probe of eight queries, not guessed
 * (`dev/probe-person-search-decisiveness.json`), and the probe refuted two rules
 * before this one:
 *
 *  - **Not the first-second GAP.** `flynn-qualified` — the case the init-project eval
 *    is right to auto-pick — has a gap of 0.01. Any threshold above that
 *    misclassifies it.
 *  - **Not `totalMatches`.** Flynn is decisive at 1,281 while Broyles is not at
 *    1,508, so no count separates them.
 *
 * What does separate all eight is TIES AT THE TOP SCORE. An under-specified query
 * returns a flat run of identical scores — 3.6236 five times for both Mary Hales and
 * John Smith — because the same few fields matched for every one of them, so the tool
 * has no basis to prefer any. A query with enough to work on returns a strictly
 * descending list.
 */

export interface ScoredCandidate {
  score?: number;
}

export interface Decisiveness {
  /** True iff exactly one candidate holds the top score. */
  decisive: boolean;
  /** How many share it — 1 when decisive, 0 when there is nothing to pick from. */
  tiedAtTop: number;
  /** Why, in terms a reader can act on. */
  reason: string;
}

function scoreOf(c: ScoredCandidate | null | undefined): number | null {
  const v = c?.score;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function decisiveness(candidates: ScoredCandidate[]): Decisiveness {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) {
    return { decisive: false, tiedAtTop: 0, reason: "No candidates to choose from." };
  }

  const top = scoreOf(list[0]);
  if (top === null) {
    // A pick the tool cannot justify is exactly the one a person should make.
    return {
      decisive: false,
      tiedAtTop: 0,
      reason: "The top candidate has no score, so there is no basis to prefer it."
    };
  }

  const tiedAtTop = list.filter((c) => scoreOf(c) === top).length;
  if (tiedAtTop > 1) {
    return {
      decisive: false,
      tiedAtTop,
      reason:
        `${tiedAtTop} candidates share the top score (${top}) — the same fields matched ` +
        `for all of them, so choosing between them needs a person.`
    };
  }

  return {
    decisive: true,
    tiedAtTop: 1,
    reason: `One candidate leads on score (${top}).`
  };
}
