// matcher: the engine's one matching call. Every score `same_person` and
// ranking compute goes through `matchPairs`; config.json's `matcher` picks the
// backend that answers it:
//   - "familysearch" (the default): FamilySearch's matchTwoExamples through
//     `scorePair`, sent exactly what each call site sent it before the shim;
//   - "service": one POST /v1/score to the matcher service per call.
// Neither falls back to the other. The two scales differ, and each backend's
// floors judge only its own scores, so a service failure is an error and never
// a FamilySearch re-score.
//
// Spec: docs/specs/matcher-shim-spec.md.

import type { Principal } from "../auth/principal.js";
import { getMatcherSettings, isHostedMode } from "../auth/config.js";
import { scorePair } from "./match-engine.js";
import { mapWithConcurrency, withRetry } from "./place-resolver.js";
import { describeFetchError, fetchWithRetry } from "./http.js";
import { Mob } from "./mob.js";
import type { SimplifiedGedcomX } from "../types/gedcomx.js";
import type {
  FamilySearchOptions,
  MatchCall,
  MatchFloors,
  MatchPair,
  PairScore,
} from "../types/matcher.js";

/** FamilySearch's floors: one constant for both of ranking's diagnostics. */
export const FAMILYSEARCH_FLOORS: MatchFloors = { thinSubject: 0.01, realNegative: 0.01 };

/** The service gives a page 10 s; this covers that, Jev's 1.5 s and the
 *  transfer. The budget matches it so that a retry after an immediate `busy`
 *  still has the time a page needs. */
const SERVICE_TIMEOUT_MS = 15_000;

/**
 * Score every pair with the matcher config.json names. The answer keeps the
 * pairs' order; a pair that could not be scored has a null score and its error.
 * The service throws instead when it scores no pair of the call; FamilySearch
 * never does.
 */
export async function matchPairs(
  pairs: MatchPair[],
  principal: Principal,
  fs: FamilySearchOptions,
): Promise<MatchCall> {
  const settings = await getMatcherSettings(principal);
  if (settings.backend === "service") {
    return serviceCall(pairs, principal, settings.url, settings.apiKey);
  }
  return familySearchCall(pairs, principal, fs);
}

// ─── FamilySearch ────────────────────────────────────────────────────────────

async function familySearchCall(
  pairs: MatchPair[],
  principal: Principal,
  fs: FamilySearchOptions,
): Promise<MatchCall> {
  const results = await mapWithConcurrency(pairs, fs.concurrency, async (pair): Promise<PairScore> => {
    const [doc2, id2] =
      pair.kind === "tree_record" ? [pair.familysearchTree, pair.pid] : [pair.rec2, pair.personaId2];
    const call = () => scorePair(pair.rec, pair.personaId, doc2, id2, principal);
    try {
      const m = await (fs.retry ? withRetry(call) : call());
      const { queryArk, candidateArk, apiTitle, updated } = m;
      return { score: m.score, familysearch: { queryArk, candidateArk, apiTitle, updated } };
    } catch (err) {
      return { score: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  });
  return { scorer: "familysearch", model: null, floors: FAMILYSEARCH_FLOORS, results };
}

// ─── The matcher service ─────────────────────────────────────────────────────

const PAIR_ADVICE: Record<string, string> = {
  pid_not_in_tree: "the tree person is not in the tree it was sent with",
  persona_not_in_record: "the persona is not a person of the record it was sent with",
  bad_document: "a document is malformed or past the service's size limits, so this pair cannot be scored",
  deadline: "the service ran out of time on the page; score it again",
  internal: "the service failed on this pair; score it again",
};

/** A pair the service could not score, with the service's code. */
export class MatcherPairError extends Error {
  constructor(readonly code: string) {
    super(
      `The matcher service could not score this pair (${code})` +
        (Object.hasOwn(PAIR_ADVICE, code) ? `: ${PAIR_ADVICE[code]}.` : "."),
    );
  }
}

async function serviceCall(
  pairs: MatchPair[],
  principal: Principal,
  url: string,
  apiKey: string,
): Promise<MatchCall> {
  const results: PairScore[] = new Array(pairs.length);
  const sent: Array<{ index: number; pair: Record<string, unknown> }> = [];
  pairs.forEach((pair, index) => {
    const id = String(index);
    if (pair.kind === "record_record") {
      const { kind, rec, personaId, rec2, personaId2 } = pair;
      sent.push({ index, pair: { id, kind, rec, personaId, rec2, personaId2 } });
      return;
    }
    let tree: SimplifiedGedcomX;
    try {
      tree = new Mob(pair.tree, pair.pid).matchSubset().gedcomx;
    } catch {
      results[index] = { score: null, error: new MatcherPairError("pid_not_in_tree") };
      return;
    }
    const { kind, pid, rec, personaId } = pair;
    sent.push({ index, pair: { id, kind, tree, pid, rec, personaId } });
  });

  if (pairs.length > 0 && sent.length === 0) throw noPairScored(results);

  const body = await postScore(url, apiKey, sent.map((s) => s.pair), principal);
  const answer = readAnswer(body, sent.map((s) => s.pair.id as string));
  sent.forEach((s, i) => {
    const r = answer.results[i];
    results[s.index] =
      typeof r === "number" ? { score: r } : { score: null, error: new MatcherPairError(r.code) };
  });

  if (pairs.length > 0 && results.every((r) => r.score === null)) throw noPairScored(results);
  return { scorer: "service", model: answer.model, floors: answer.floors, results };
}

/** The one error for a call none of whose pairs was scored: a lone pair's own
 *  error, or every distinct code with what to do about it. */
function noPairScored(results: PairScore[]): Error {
  if (results.length === 1 && results[0].error) return results[0].error;
  const codes = [...new Set(results.map((r) => (r.error as MatcherPairError).code))];
  const named = codes.map((c) => (Object.hasOwn(PAIR_ADVICE, c) ? `${c} (${PAIR_ADVICE[c]})` : c));
  return new Error(`The matcher service scored none of the ${results.length} pairs: ${named.join("; ")}.`);
}

async function postScore(
  url: string,
  apiKey: string,
  pairs: Array<Record<string, unknown>>,
  principal: Principal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchWithRetry(
      `${url}/v1/score`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ pairs }),
      },
      SERVICE_TIMEOUT_MS,
      { budgetMs: SERVICE_TIMEOUT_MS },
    );
  } catch (err) {
    throw new Error(
      `Could not reach the matcher service: ${describeFetchError(err)}. No pair was scored; try again in a minute.`,
    );
  }
  if (response.status === 401) throw new Error(await unauthorizedMessage(principal));
  if (!response.ok) throw await statusError(response);
  try {
    return await response.json();
  } catch {
    throw unreadable("it is not JSON");
  }
}

export const MATCHER_UNAUTHORIZED_DESKTOP =
  "The matcher service rejected this caller's key (401). Set \"matcherApiKey\" in " +
  "~/.familysearch-mcp/config.json to this caller's key, or set \"matcher\" to " +
  "\"familysearch\" to score with FamilySearch's matcher. Do not ask the user to paste a key into the chat.";

export const MATCHER_UNAUTHORIZED_HOSTED =
  "The matcher service rejected this server's key (401), so match scoring is unavailable " +
  "until an operator fixes it. Tell the user, and do not retry.";

async function unauthorizedMessage(principal: Principal): Promise<string> {
  return (await isHostedMode(principal)) ? MATCHER_UNAUTHORIZED_HOSTED : MATCHER_UNAUTHORIZED_DESKTOP;
}

/** A non-200 the retries did not clear, named by its status and the service's
 *  code (and, for a 400, the field it names; the service never echoes a value). */
async function statusError(response: Response): Promise<Error> {
  let code = "";
  let field = "";
  try {
    const err = ((await response.json()) as { error?: { code?: unknown; field?: unknown } })?.error;
    if (typeof err?.code === "string") code = err.code;
    if (typeof err?.field === "string") field = err.field;
  } catch {
    // No readable body: the status alone names the failure.
  }
  const what = [response.status, code].filter(Boolean).join(" ") + (field ? `, field ${field}` : "");
  const advice =
    response.status === 413
      ? "Score fewer pairs at a time."
      : response.status >= 500
        ? "Try again in a minute."
        : "Tell the user match scoring is unavailable.";
  return new Error(`The matcher service did not score the pairs (${what}). ${advice}`);
}

function unreadable(why: string): Error {
  return new Error(
    `The matcher service's response could not be read (${why}), so no pair was scored. ` +
      "Tell the user match scoring is unavailable.",
  );
}

const isUnit = (x: unknown): x is number => typeof x === "number" && x >= 0 && x <= 1;

/** The model, floors and per-pair outcomes of a 200, each checked: any one
 *  that does not hold fails the whole call. */
function readAnswer(
  body: unknown,
  ids: string[],
): { model: string; floors: MatchFloors; results: Array<number | { code: string }> } {
  const b = body as {
    model?: { version?: unknown; cutoffs?: { floors?: { thin_subject?: unknown; real_negative?: unknown } } };
    results?: unknown;
  } | null;
  const version = b?.model?.version;
  if (typeof version !== "string") throw unreadable("no model version");
  const thinSubject = b?.model?.cutoffs?.floors?.thin_subject;
  const realNegative = b?.model?.cutoffs?.floors?.real_negative;
  if (!isUnit(thinSubject) || !isUnit(realNegative)) throw unreadable("no floors from 0 to 1");
  const raw = b?.results;
  if (!Array.isArray(raw) || raw.length !== ids.length) throw unreadable("not one result a pair");
  const results = raw.map((r: { id?: unknown; score?: unknown; error?: { code?: unknown } }, i) => {
    if (r?.id !== ids[i]) throw unreadable("results out of order");
    if (isUnit(r.score)) return r.score;
    if (typeof r?.error?.code === "string") return { code: r.error.code };
    throw unreadable("a result with neither a score from 0 to 1 nor an error code");
  });
  return { model: version, floors: { thinSubject, realNegative }, results };
}
