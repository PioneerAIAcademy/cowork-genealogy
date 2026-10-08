# Conclusion tree — one evidence/conclusion model for facts and relationships

**Status:** Draft; `/critique-plan` closed after 17 rounds (2026-10-07); nothing built.

**Decision record:** issue #3032. Its body is rewritten from this plan.

**Throughout, `main` means `origin/main` (f73a26962).** Engine paths are relative to
`packages/engine/mcp-server/` where they start with `src/`, `tests/` or `dev/`.

**Follow-on work** — routing to owed findings, researcher statements, the
hosted delivery check — is in [`conclusion-tree-later.md`](conclusion-tree-later.md), at intent
only.

## The model

- `tree.gedcomx.json` holds three things only:
  - **imports:** FamilySearch starting-tree data;
  - **conclusions:** values and pairs covered by an affirmed claim at `probable` or better;
  - **minted persons:** persons created from records, carrying a name and gender only.
- `research.json` holds everything records say (assertions plus `pe_` links) and every
  conclusion (proof summaries and their claims).
- "Found in records" is computed from `research.json` on read, by one engine module. It is
  never stored.
- Every conclusion is a claim. proof-conclusion states it; `research_append` checks it against
  the documents. The engine drafts nothing and projects nothing, except that `research_append`
  clears `primary` on a fact when its write removes the claim behind it (Decision 34).
- The status of every tree object comes from claims. No tree object carries a status field.

## Decisions

| # | Decision | Reason |
|---|---|---|
| 1 | One model for facts and relationships | No genealogical or data-model reason separates them; today's split is PR #730 and the person-evidence defer rule, never reconciled |
| 2 | Conclusion tree, as above | A reader that ignores status sees imports and conclusions, never raw single-record evidence; no stored evidence to keep in sync |
| 3 | A vital fact may carry alternate values, but at most one at `probable` or better per person for Birth, Christening, Death and Burial. Values where one's unfudged day range contains the other's count as one. Couple events are exempt | Two incompatible values cannot both be more likely than not (Standard 50); a couple can marry or divorce more than once |
| 4 | Status lives in `proof_summaries[].claims[]`, never in a tree field | An older engine strips an unknown tree field on its first write; a copied tier drifts |
| 5 | Claim kinds: `relationship` (ParentChild `{parent, child, subtype?}` or Couple `{person1, person2}`); `fact` (`{subject, fact_type, date?, place?, value?}`, subject a person id or a `{person1, person2}` pair, a range one value); `identity` (`{record_id, party, person}`, where `party` is the engine's party key, `record_persona_id` else `record_role`; or `{person, same_as}` between two tree persons); `name` (`{person, given?, surname?}`); `finding` (`{finding_type, statement}`, `finding_type` one of `absence`, `completeness`, `record_content`, `rejected_candidate`). Each claim carries its own tier, shortfall, cited assertions and `polarity`: `affirmed` (default) or `denied`, denied only at `probable` or `possible`. A `disproved` claim carries no polarity | Every tree object, every record-to-person link and every conclusion that is not a tree object needs its own claim; a marriage date needs a pair as its subject; without a denial below the proof bar, "probably not" is written as a positive claim on the rejected candidate |
| 6 | Display statuses: the proof-tier labels (well established / likely / tentative / not established / ruled out), plus "from your starting tree, not yet checked", "set aside in favour of X", "doubted" (a grounded denial at `probable` with no winner in its slot), "tentative, not yet confirmed to be <name>" (a claim held at `possible` by grounding), "found in a record, not yet checked", "from an earlier finding, no claim recorded" | Every tree object reads with a qualifier |
| 7 | An import is anything in `starting-tree.gedcomx.json`. With no baseline (55 of 72 production projects), or when a merge removed the baseline person, it is anything that carries the FamilySearch-tree source at quality 1 among its refs (`src/utils/person-read-tree.ts` puts one on every imported fact and relationship), or that has no refs; corroboration adds record refs to imports, so "only refs" would not do | Imports are other researchers' conclusions |
| 8 | A parent shows as likely only after every rival parent in that slot has a verdict, at any tier or polarity | Competing hypotheses must be tested |
| 9 | "Ruled out" is a `disproved` claim that meets the proof bar. A same-slot rival beside a winner at `probable` or better reads "set aside in favour of X" when its best claim is `possible` or lower, or it carries a denial below the proof bar | Most losers are never disproved; without this, issue #2511 keeps both parent sets indefinitely |
| 10 | An import leaves the tree only after a disproof, or, when set aside, with the user's approval. Disproved pairs persist and cannot be re-added, through `add_relationship` or its corroborate path | A disproof must persist; the user decides what leaves their tree |
| 11 | Relationship type is part of the claim; untyped is never shown as biological; edges can be retyped | The type is its own claim; censuses and imports list stepchildren as "son" |
| 12 | No record-own-events rule: residences, occupations and census entries stay in the found-in-records view unless a claim covers them | Upload is out of scope, so the tree holds only what research concluded |
| 13 | Merges never set `primary`. A merge needs a recorded identity decision: an `identity` claim at `probable` or better (a record identity whose persona is linked to the absorbed person, or a `same_as` citing an assertion linked to both profiles), or the user's instruction cited in the merge's `warningJustifications`. A merge that would create a ruled-out pair, a second likely parent, affirmed-and-denied claims on one object, or two incompatible likely vitals needs a justification. A merge of two persons an edge joins is refused outright | A merge is an identity conclusion; this replaces the 2026-09-11 ruling. Merging two persons an edge joins turns the edge into a self-relationship, an impossibility like an ancestry cycle |
| 14 | `same_person` sends the tree plus the found-in-records view, minus anything sourced to the record being scored, and refuses to score a person minted from that record | Keeps mid-research context and removes circular corroboration |
| 15 | Issue #2943 is independent of this plan. Its blocker, issue #1689, closed when PR #3077 merged (2026-10-06), and it awaits the lead's refs decision. It and Stage 1b both edit `research-append.ts`, `research-append-tool-spec.md`, `guardrail-enforcement-spec.md` and `research-schema-spec.md`, so whichever lands second rebases | Its circularity refusal and this plan's claim rules are separate guards on the same writer tool |
| 16 | FamilySearch upload is out of scope. The specs' upload language goes, and the harness's "content that uploads" becomes "concluded content" | No upload code exists or is planned here |
| 17 | Inferred relationships: the census wife-to-child link shows as implied; co-parents are view-only, never a Couple; pre-1880 co-residence never creates a relationship; the `_inferred` convention is retired | Inference belongs in a proof |
| 18 | Marriage stage: the `marriagelicense` → `marriage` fold ends, and extraction labels intent records (licence, banns, bond, intention) | An intent record does not prove a marriage |
| 19 | Evidence resting only on a speculative identity link, or on a persona a live denied identity claim covers, is hidden from the view unless asked for | Stops wrong-candidate evidence surfacing as "found" |
| 20 | The e2e judge grades recall from the final tree plus the saved view, and reports found beside concluded (claimed); the verdict switches to concluded in Stage 4; the avoid guard keys on edges and claims, not names | Measures the new promise without a score cliff |
| 21 | The viewer shows status chips, a found-in-records list, and rival parent sets side by side | Status is useless unless users see it |
| 22 | project-status, question-selection and hypothesis-tracking read status through `project_context`, not the tree file | Issue #2943: imports narrated as fact |
| 23 | Link-time fact and edge writes retire only after the view exists (Stage 3) | Readers need the view before the tree thins |
| 24 | Legacy documents are read, never repaired; they get the legacy labels in row 6 | Readers tolerate old shapes |
| 25 | A new rule lands in warn mode in one module, `src/validation/rule-modes.ts`, and refuses only from its flip stage (1c, 2b or 3b), a separate PR. The engine accepts a claim kind before any body writes it: Stage 1b merges after Stage 1a, and the prototype deploys `eb-tools.zip` before `eb-worker.zip`. `project_context.claimKinds` lists what the running engine accepts, and each changed body that holds `project_context` keeps today's behaviour when it lacks `claimKinds` or `owedFindings` | There are no releases or tags. A Cowork tester builds both artifacts from one commit and may install either alone; the hosted image ships both at each `make deploy`; the prototype's engine and plugin are separate Beanstalk environments |
| 26 | A second untyped or Biological parent of one sex is refused by `findCompetingParentage` (PR #3207, issue #2525), which reads the trees. Stage 1b makes it skip a parent whose edge reads set aside or ruled out, decided from claims, so the winner's edge lands with no justification; with no live summary the refusal still routes to conflict-resolution. `tooManyFathers2` and `tooManyMothers2` skip the same parents. Whether the warning gate sees ParentChild edges at all, and which types it then exempts, is issue #2840's: a replay refuses 416 of 2,242 committed edges, and only 22 of its 483 warnings are parent counts | One biological father and one mother per child is a real constraint, and the statuses that resolve it are decided from the documents |
| 27 | Claims are mandatory on every proof summary at `possible` or better and on every denial and disproof. The agent states them and `research_append` checks them. A `not_proved` decline may carry none | Optional claims appeared on 1 of 32 eligible proofs; a deterministic drafter scores 0.41 precision and 0.64 recall on relationships; only the agent's stated answer is exact |
| 28 | Grounding is per object. An affirmed tree-object claim at `probable` or better stands only if each person it names is linked (live, `confident` or `probable`) from an assertion it cites, and the persona of at least one cited value assertion of a fact is tied to its subject (for a couple fact, each spouse to at least one such persona); rule 7 defines the terms. Otherwise it stands at `possible`. A denial at `probable` is grounded through its anchor, the person whose slot it contests, and through any contrary value assertion it cites (rule 7). Absence-only citations never ground `probable` | proof-conclusion's identity gate, made decidable. Over the 45 labelled proofs it holds 8 of 89 relationships, each for an unlinked person, 0 of 25 facts and 1 of 11 couple facts. No rule asks that a record stating a relationship be tied to both people: replayed over every eligible edge in the 202 committed runs, that check fires once, on a correct proof |
| 29 | The scalar `tier` states the answer to the question as a whole and may not exceed the strongest claim. It ships with the conflict gate run per claim, and a refusal of a tier-only update on a summary that holds claims | "Equals the strongest claim" forced "proved as bookkeeping" headlines; the bound alone would let a downgrade leave a claim standing on disputed evidence |
| 30 | A `proved` claim needs each person it names linked at `confident`, or covered by a `proved` identity claim whose own persona link is `confident` and whose persona the checked claim cites. Otherwise it caps at `probable` | A relationship is no better established than its people; 7 of 30 proved objects in the labelled sample rest on `probable` links |
| 31 | One join decides which tree object a claim covers, for every rule and the status lookup: dates by exact standardized equality (ISO forms normalized; normalized text when the standardizer returns nothing); places most-specific-first (a claim may omit higher jurisdictions, never cover a finer place); value text for value-bearing types; a name by normalized given name and surname. A near miss is reported naming both values and never counts as cover | The duplicate-detection helpers `compatibleDate` and `compatiblePlace` treated 5 of 10 labelled affirmed-and-ruled-out pairs as one object, and missed 15 of 25 concluded facts already in the tree |
| 32 | An untyped claim or denial covers its pair for status, rival verdicts and encoding. A typed edge's subtype reads "from your starting tree, not yet checked" unless a claim names it | About 40% of imported parent edges are typed, and issue #2511's rival sets mix typed and untyped edges |
| 33 | The engine computes owed findings and serves them as `project_context.owedFindings`. Completion warns while a blocking item is owed; it refuses only after Stage 1c measures the fire rate, and the 2026-08-24 no-override ruling stands until then | Decided from the documents; under the corrected join, 11 of 25 concluded facts still miss, so refusing now would repeat the old check's false denies |
| 34 | `primary` marks the preferred display value among claimed values. Setting it needs an affirmed claim at `probable` or better covering the fact; `research_append` clears it in the write that leaves no such claim covering the fact | `primary` is today's de facto status marker (192 primary facts in 118 of 202 final trees); status now lives in claims |
| 35 | Typed question targets are deferred to issue #3213, unblocked when the Stage 2 check shows more than 5% of narrative-concluded relationship objects unclaimed over 10 consecutive runs | Targets close slot completeness by rule, at about double the claims build |
| 36 | gps-mentor is unchanged by this plan, and a claim's status ignores its reviews | Issue #2951 takes it off the default research path, so it cannot guard claims by default and most proofs are never reviewed; the viewer already shows a review's verdict in its own section |
| 37 | An `add_relationship` on a pair that already has a matching edge corroborates it: the tool adds the new sources, and any Couple facts, to that edge and returns its id | A refusal leaves the writer to re-route the same evidence by hand (`add_fact` with `relationshipId`) and drops the new edge's sources; corroborating keeps them on one edge, survives a retried call, and covers ParentChild, which a Couple-only refusal leaves out. 6 of 202 final trees carry a duplicate Couple |

## Superseded

- **Issue #3032's options M, R and D.**
  - M's goal, two layers like facts, is met by computing the evidence layer for both.
  - R is the end state, for both.
  - D is withdrawn.
- **Issue #3032's review-ready decision (2026-10-06) that `add_relationship` refuses a second Couple on a pair and names the existing id.** A matching edge is corroborated instead (Decision 37).
- **Issue #1711's ruling that claims are optional**, used only for unequal paternity and maternity.
- **person-evidence's "Relationship edges — write vs. defer" rule**, including its household exception (`packages/engine/plugin/agents/person-evidence.md`).
- **The 2026-09-11 "a merge concludes" ruling** (`docs/specs/simplified-gedcomx-spec.md`, the "Ruled intended 2026-09-11" paragraph).
- **The bounded carve-out's form** (PR #1819, the 2026-08-21 ruling that a bounded conclusion encodes at `possible`). Its outcome stands: a bracket claim is tiered on the bracket's own support and encoded at `probable` or better.
- **The two-layer working-tree doctrine written by PR #730**:
  - `docs/specs/tree-materialization-spec.md`;
  - `docs/specs/research-schema-spec.md`, "tree.gedcomx.json update timing";
  - the overview in `docs/specs/simplified-gedcomx-spec.md`;
  - "Relationships follow the same two layers as facts" in `packages/engine/plugin/agents/tree-edit.md`.
- **"Why the scalar `tier` carries the stronger claim"** in `docs/specs/research-schema-spec.md`.
- **The identity precondition's "stop. Do not proceed to Step 1"** in `packages/engine/plugin/agents/proof-conclusion.md`.
- **The assignment of `_inferred` relationships to "downstream correlation skills"** (`docs/specs/research-schema-spec.md`).

## Stages

Order: 1a, 1b, 1c, 2, 2b, 3, 3b, 4.
- Every stage that changes a tool description, input schema or agent body regenerates `tests/packaging/prompt-sizes.json` with `UPDATE_PROMPT_SIZES=1 npx vitest run tests/packaging/prompt-budget.test.ts`, or "matches the sizes computed at HEAD" fails.
- Stage 1b may be built while 1a is in review, but merges after it (Decision 25) and rebases onto its `src/tools/tree-edit.ts` changes.
- Stage 1a and PR #3207 both edit `tree-edit.ts`, `materialize-facts.ts`, `mob.ts`, `person-warnings.ts` and `introduced-warnings.ts`, so whichever lands second rebases.
- Stage 1b starts after PR #3207, PR #3131 and PR #3040 merge. It changes PR #3207's check; it pays the proof-conclusion, research and tree-edit slots those PRs commit run logs for; and PR #3040 rewrites the completion gate in `research-append.ts` and `nextStep` in `question-state.ts`, both of which Stage 1b extends. PR #3131 also makes `computeTouchedPersonIds` read ParentChild endpoints through `relationshipEndpoints`; until it does, the write gate sees no person touched by a ParentChild retype or removal, so Stage 1b's `update_relationship` and import-removal warnings depend on it.

### Stage 1a — fixes and the claims expand (0 paid slots)

**What changes**
- **Fixes that hold under any model.**
  - `src/tools/tree-edit.ts`:
    - `add_relationship` on a pair that already has a matching edge adds the new sources (and any Couple facts) to that edge and returns its id, instead of creating a second edge (Decision 37). An edge matches when it has the same `type` and endpoints (a Couple's two persons in either order, as `relationshipKey` in `src/utils/merge-gedcomx.ts` already compares them) and its subtype equals the new one's or either is absent; the first match in tree order wins. Each inline Couple fact is applied to the matched edge as `add_fact` would apply it, primary swap included, except that a fact equal to one already on the edge in type, date, place and value is not added and its sources are merged into that fact. The existing edge's subtype never changes: when the new edge's subtype is not applied, the result says so and names `update_relationship`. A Step edge added beside a Biological one is a second edge.
    - It refuses a self-Couple.
    - `remove {factId}` removes only one holder's fact. Today it filters the id out of every person and every relationship, and FamilySearch imports reuse fact ids, so removing one person's disproved imported Birth would delete the Birth of everyone sharing the id.
      - It refuses an id that more than one person or relationship carries, naming them, unless `personId` or `relationshipId` scopes it, and refuses a remove carrying both.
      - Today's two guards narrow to fit: `personId` is refused only without a `factId` ("remove does not delete persons"), and `factId` with `relationshipId` is no longer refused as two targets. `{relationshipId}` alone still removes the edge. "remove (tree_correct): deletes a fact by id; refuses to remove a person" (`tests/tools/tree-edit.test.ts`) passes as written in this stage: its fact id is unshared, and its `{personId}` carries no `factId`. Stage 1b gives it a justification.
      - Agents already send the scoped form: 4 of the 14 committed `remove {factId}` ops passed `personId`, were refused, and were retried unscoped.
      - These change with it: in `docs/specs/tree-edit-tool-spec.md`, the **`remove`** entry, the `personId` and `relationshipId` comments in the op shape, the error-table row "`remove` with a `personId`" and the test-plan line "`remove` with `personId` rejected"; in `src/tools/tree-correct.ts`'s schema, the tool description ("remove takes exactly one of factId or relationshipId") and the `personId`, `factId` and `relationshipId` descriptions.
    - `add_fact` and `add_person`'s inline facts refuse a couple-event type on a person (`COUPLE_EVENT_TYPES` from `src/utils/record-persona.ts`, plus the licence and intention spellings), and so does an `update_fact` that sets that type; the message names the Couple route. Edits to an existing person-level couple-event fact (13 in 8 e2e starting trees) are admitted (Decision 24).
  - A new correction op, `update_relationship {relationshipId, subtype}`. In `src/tools/tree-edit.ts`: `TreeEditOperation`, `CORRECT_OPERATIONS`, a `subtype` field on `TreeEditOp`, an arm in `applyOperation`, and the schema description's list of the correction ops that live in `tree_correct`. In `src/tools/tree-correct.ts`: both `operation` enums, a `subtype` property in its schema, and the tool and `relationshipId` descriptions.
  - `src/tools/materialize-facts.ts` and `src/utils/record-persona.ts`: every couple-event `fact_type` (divorce, banns, licence and intention spellings) is skipped, not only `marriage`. Its Python mirror, `_UNMATERIALIZABLE` in `eval/harness/validators/test_person_evidence.py`, gains the same types.
  - `src/tools/research-append.ts`: `marriagelicense: "marriage"` is dropped from `FACT_TYPE_ALIASES`.
  - `src/utils/merge-gedcomx.ts`:
    - `relationshipKey` gains the subtype, so `src/tools/tree-diff.ts`, which maps relationships by it, keeps a Step and a Biological edge on one pair apart;
    - `dedupRelationships` folds by the same match as `add_relationship`: an untyped edge folds into a typed one (the first in tree order when two match), two different explicit subtypes stay separate, and notes are unioned.
  - `src/utils/mob.ts` and `src/tools/person-warnings.ts`:
    - `tooManyFathers2` and `tooManyMothers2` count only edges `isQualifyingParentChildEdge` (`src/tools/person-warnings.ts`) accepts;
    - `hasEarlyMarriage14` and `hasLateMarriage90` also read the anchor's Couple facts.
  - **Write lockdown**, in all three copies (`packages/engine/plugin/hooks/guard_project_files.py`, `apps/server/app/agent/real_agent.py`, `eval/harness/e2e/orchestrator.py`):
    - protected basenames match case-insensitively;
    - `guard_project_files.py`'s `_ops` parses a JSON-string `ops`.
  - `eval/harness/e2e/judge.py`, `apply_avoid_guard`:
    - the relationship branch fails only when an edge joins the subject, the PID in `details.subject_person` (a "Name (PID X)" string or `{pid}`), and the avoided candidate in the role `details.relation` gives the candidate relative to the subject: `child` (the subject's child), `spouse` (a Couple), `parent`, `parents`, `mother` or `father` (the subject's parent), or `spouse and child` (either). All 30 relationship avoid findings carry it. katalin-horak-son's `f2` names the subject's own role ("mother of child (unconfirmed)") and is retagged `child`, its candidate named "János Banyári" in place of "Katalin Horák as János Banyári's mother". vasily-romanov-spouse's, patrick-hoban-spouse's and matilde-cavagnaro-spouse's `f1` each forbid a spouse and a child and are retagged `spouse and child`;
    - `finding_shape_errors` (`eval/harness/e2e/validate_fixture.py`), which today checks only top-level keys, makes a relationship `avoid` finding with a missing or unmapped `relation`, or a `subject_person` that yields no PID, an error, since the branch would otherwise disarm silently, and does the same for a fact `avoid` finding with no avoided value. `eval/harness/tests/unit/test_e2e_validate_fixture.py` gains both cases, and the avoid findings in `test_finding_shape_accepts_all_known_fields` and in `_genre_fixture`, which `test_cli_wires_the_fixture_genre_into_the_advice_it_prints` and `test_cli_still_prints_strip_advice_for_a_strip_fixture` build, gain a `relation`, and `_avoid_pair_findings`' `f1`, a fact avoid finding with no `details`, gains `subject_person`, `fact_type` and `wrong_value`, which `test_lint_fixture_passes_a_resolved_record_hint_fixture_with_an_ark` and `test_lint_fixture_passes_image_basis_true_with_an_image_ark` need;
    - `f2` in `eval/tests/e2e/hinrich-burmeister-spouse/expected-findings.json`, the only `person`-type avoid finding, is retyped `relationship` with `details.subject_person` and `details.relation: "spouse"`: it forbids making Elsch Burmeister a spouse of G8CJ-7VL, and a record-minted Elsch with no Couple edge is not that, though today's presence check fails it;
    - the fact branch fails only when the avoided value is present on a non-subject person, reading it where the three fact avoid findings keep it: `details.date` and `details.place`, `details.wrong_candidate`'s `date` and `place`, or `details.wrong_value`. The subject stays exempt, so an avoided value on the subject waits for Stage 4's claims-aware guard;
    - in `eval/harness/tests/unit/test_e2e_judge.py`, `_avoid_findings()` gains `details.subject_person` and `relation: "father"`, and `_tree_with_robert_smith()` itself gains the subject and a ParentChild edge from Robert Smith to it, so every test built on it keeps a hit: the three that force false, `test_avoid_guard_forces_false_when_the_avoided_claim_is_in_the_final_tree`, `test_avoid_guard_still_catches_a_non_subject_over_claim` and `test_avoid_guard_grades_a_finding_the_judge_never_graded` (the only test of the branch for a finding the judge never graded), and `test_avoid_guard_exempts_the_fixture_subject_from_the_match`, `test_avoid_guard_ignores_recover_findings` and `test_avoid_guard_never_upgrades_the_verdict`, which without a hit would pass without reaching what they test;
    - `format_suspect` in `eval/harness/e2e/validate_fixture.py`, which tells fixture authors the same name matcher runs against the agent's final tree, is rewritten to the edge and value checks;
    - the judge reads finding descriptions, and five still say the guard "force-fails on presence in the final tree however the person is annotated": hinrich-burmeister-spouse `f1` and `f2`, kierstin-jonsdotter-daughter `f1`, patrick-hoban-spouse `f1` and vasily-romanov-spouse `f1`. Each is reworded to the edge rule, as are jacob-klatkiewicz-spouse `f2`'s description ("matches on names alone") and its `wrong_candidate.note`, with the annotator notes that state the old matcher: hinrich-burmeister-spouse's README (the `f1` note naming P9PK-53N, which the edge check no longer catches, and the `f2` paragraph on name tokens alone) and `fixture.json` `notes`, marie-badoux-daughter's README and `fixture.json` `notes` ("relationship-blind"), william-mcallister-son's README ("How f1 is enforced"), the READMEs of jacob-klatkiewicz-spouse, matilde-cavagnaro-spouse and domingo-olivera-parents, which describe the name-only matcher, and stribling-father-1821's README, whose reason for carrying no avoid finding (it would force-fail a run adding Gideon as the mother's second husband) no longer holds. `.claude/skills/author-e2e-fixture/SKILL.md`'s `polarity` bullet ("a matching person in the final tree forces the finding to fail") changes to the edge rule and gains: a relationship avoid finding sets `details.relation` to the candidate's relation to the subject. No fixture whose `expected-findings.json` changes has an annotation carrying a `findings_hash`, and no edited fixture's annotation carries a `blind_bundle_digest`. georg-gajdosch-spouse `f1`'s note, which also states the old matcher, stays as written: its annotation carries a `findings_hash`, which `check_e2e_fixtures.py` enforces;
    - `test_no_new_fixture_becomes_unpassable_via_the_avoid_guard` (`eval/harness/tests/unit/test_e2e_fixture_corpus.py`) calls `check_stripping` directly, so it would keep pinning the retired matcher. It runs the new edge and value checks over each starting tree instead, and `_KNOWN_UNPASSABLE_AVOID_FIXTURES` empties: antonio-lucas-spouse's collisions are joined to the subject only as parent and children, heinrich-zinsmeister-death's colliding Death carries no date, and thomas-seaver-other-wife's `f1` moves "married after Rachel Wilkins and before his 1837 death" from `wrong_candidate.name` into its `note`, since that name otherwise matches the real wife, Couple-joined to the subject by R1; its README's "Expect WARNs" note changes with it. `docs/specs/e2e-test-spec.md`'s "Open doctrine call: guards that can never go green" paragraph closes, decided by Decision 20.
- **The claims expand** (new shapes become acceptable; nothing becomes required).
  - `src/validation/validator.ts`, the claims loop:
    - accepts every claim kind, `polarity` and `finding_type` (Decision 5), and on a `finding` claim a `log_entry_ids` array of `log_` ids, checked to exist (the name `exhaustive_declaration` already uses). `tests/validation/validator.test.ts`'s "rejects a claims[].relationship.type other than 'ParentChild'", whose `Couple` becomes valid, asserts instead that a type other than ParentChild and Couple is rejected;
    - rejects a claim that names no object or two objects, cites an assertion that does not exist, is denied at `proved`, or carries `polarity` while `disproved`;
    - "tier equals the strongest claim" becomes "tier does not exceed the strongest claim at `possible` or better" (Decision 29). In `tests/validation/validator.test.ts`, "rejects a scalar tier that doesn't match the stronger per-claim tier", whose `possible` scalar over a `probable` claim becomes valid, inverts; "rejects a scalar tier stronger than every per-claim tier" asserts the bound's message; and "a prototype key cannot pose as a tier rank" raises its scalar to `proved`, so the bound must still run past the poisoned rank;
    - `RESEARCH_SHAPES.proof_claim` and `proof_claim_relationship` gain the new fields, and each new claim object (fact, identity, name, finding) gets its own closed shape set and `$def`.
  - `src/tools/research-append.ts`, shipped with the bound and refusing at once:
    - `conflictedSourceInvariants` runs per claim, over each claim's `supporting_assertion_ids`;
    - an update that changes `tier` on a summary holding claims must pass `claims` in the same op;
    - a `proved` or `disproved` claim meets `proofSummaryInvariants`' conclusive floor on its own. The bound would otherwise accept a lone `disproved` claim under a `not_proved` scalar, which main refuses.
  - New closed enums `claim_polarity` and `finding_type`, in `docs/specs/schemas/enums.schema.json`, `packages/schema/schemas/enums.schema.json` and `CLOSED_ENUMS`. The TS unions are generated.
  - Both `research.schema.json` trees; `ProofClaim`, the `ProofClaimRelationship` union and the per-kind interfaces in `packages/schema/src/index.ts`; the claims and enum tables in `docs/specs/research-schema-spec.md`.
  - `src/validation/person-id-refs.ts` yields and remaps every claim person: the Couple pair, the fact subject, the identity person, `same_as`, and the name's person.
  - `src/tools/project-context.ts`: `claimKinds`. `tests/tools/project-context.test.ts`'s "returns empty arrays for an empty project" compares the whole projection, so it gains `claimKinds`.
  - `src/validation/rule-modes.ts` (new): the mode of every rule that warns before it refuses. A rule in warn mode returns its message prefixed "Will be refused:" and names what it concerns, since `research_append`, `tree_edit` and `tree_correct` each return one flat warning list per call: the summary id for `research_append`; for the tree tools, the object's holder and id (`personId` or `relationshipId` plus `factId` for a fact, `personId` plus `nameId` for a name, an edge's `relationshipId`). A fact id alone is ambiguous: 65 of the 136 e2e starting trees put one fact id on two or more persons, up to 15.
  - `src/tools/research-append-examples.ts`: the claims example gains `shortfall`, so it validates verbatim.
  - `packages/viewer-ui/src/components/sections/ProofSummariesSection.tsx` renders every claim kind without assuming `relationship`.
- **Specs:**
  - Delete the claims that `proof_tier` marks tree objects, and all upload language, from:
    - `docs/specs/research-schema-spec.md`, `docs/specs/simplified-gedcomx-spec.md`, `docs/specs/tree-materialization-spec.md` and `docs/specs/match-merge-workflow-spec.md` (its §5.6, "gates upload to concluded facts");
    - `docs/specs/schemas/ownership.json`: the `failure` lines of the tree `persons`, `relationships` and `sources` rows ("the upload target", "uploads a claimed relationship", "dangles at upload time");
    - the `description` of `tree-gedcomx.schema.json` in both schema trees, which `eval/harness/tests/unit/test_schema_mirrors.py` holds byte-identical.

    Everything else waits for Stage 3.
  - Also update `docs/specs/tree-diff-tool-spec.md` (identity rule 2, "Relationships key on their ENDPOINTS", and the `RelationshipDelta` line, since the subtype joins the key and a retype reads as one removed and one added), `docs/specs/tree-edit-tool-spec.md`, `docs/specs/merge-gedcomx-spec.md`, `docs/specs/person-warnings-tool-spec.md`, `docs/specs/research-append-tool-spec.md` (the alias table, the per-claim conflict gate, the disproof floor and the tier-only update refusal), `docs/specs/e2e-test-spec.md` (the avoid rule), `docs/specs/project-context-tool-spec.md` (`claimKinds` in the return value) and `docs/specs/research-schema-spec.md` ("Why the scalar `tier` carries the stronger claim" rewritten to the bound, which ships here).

**What does not change.** No agent body, rubric, `eval/tests/unit` case or scenario is edited, so no eval snapshot moves. The research.json schema change is the claims expand; nothing becomes required. There is no tree field. The warning gate's reading of ParentChild endpoints is issue #2840's, not this stage's. Facts still materialize at link time, and person-evidence keeps its defer rule until Stage 3.

**Acceptance check.** Each refusal or rejection case asserts its rule's own message, so it fails on main today even where main refuses the same input for another reason: tier equality, or a claim shape main does not accept. Every other must-fire case fails on main too, except three that main already satisfies and the change must keep: "a Step edge added beside a Biological edge creates a second edge", and the avoid guard's "the relationship branch fails when an edge joins the subject and the avoided candidate in the avoided role" and "the fact branch fails when a non-subject person carries the avoided value". A must-not-fire case passes on main and must keep passing.
- `tests/tools/tree-edit.test.ts`:
  - "add_relationship refuses a Couple whose two persons are the same";
  - "an untyped add_relationship on a pair with a Biological edge corroborates into that edge, which stays Biological";
  - "a Biological add_relationship on an untyped edge corroborates into it, leaves it untyped and says so";
  - "a Step edge added beside a Biological edge creates a second edge";
  - "update_relationship retypes an edge";
  - "add_fact, add_person's inline facts and an update_fact setting the type each refuse a Marriage on a person";
  - must not fire: "an update_fact correcting the date of an imported person-level Marriage fact passes";
  - "remove of a fact id two persons share is refused unscoped, and removes only the scoped person's fact";
  - "remove with a factId and a relationshipId removes that relationship's fact and keeps the edge";
  - must not fire: "remove of an unshared fact id needs no scope";
  - "a second Couple on a pair that already has one, given in either order, corroborates into it and returns its id";
  - must not fire: "a Couple on a different pair creates a new edge";
  - "a retried add_relationship carrying the same Marriage fact leaves one edge and one Marriage fact";
  - "a remove carrying both personId and relationshipId is refused".
- `dev/replay-tree-refusals.ts` (new, developer-only) replays the refusals this stage adds over the committed e2e `tree_edit` and `tree_correct` calls, and the PR reads every fire (ADR-0011 limit 2): the couple-event refusal fires on 6 `add_fact` Marriage-on-person ops in 4 runs, all dated 2026-07-05 to 07-10, the self-Couple refusal on none, and the shared-id `remove` refusal on none of the 14 committed `remove {factId}` ops, each of which removed an id at most one person held. The claim rules have no population to replay (claims on 1 of 32 eligible proofs, Decision 27).
- `tests/tools/tree-diff.test.ts`: "a Step edge added beside a Biological edge reads as added".
- `tests/tools/materialize-facts.test.ts`: "a divorce assertion is not written onto either spouse".
- `tests/tools/research-append.test.ts`:
  - "marriagelicense keeps its own fact_type";
  - "a tier-only downgrade of a summary holding a probable claim is refused";
  - "a probable claim citing a source an open conflict disputes is refused, while a sibling claim on undisputed sources passes";
  - "a proved claim under a probable scalar without an exhaustive declaration is refused";
  - "a claims-only update adding a disproved claim below the proof bar is refused";
  - "a disproved claim under a not_proved scalar without an exhaustive declaration is refused";
  - must not fire: "a disproved claim on a question declared exhaustive before the call passes".
- `tests/validation/validator.test.ts`:
  - "accepts Couple, person-fact, couple-fact, record-identity, same_as, name and finding claims, and a finding citing a log entry";
  - "rejects a finding citing a log entry that does not exist";
  - "rejects a claim naming two objects";
  - "rejects a claim citing an assertion that does not exist";
  - "accepts scalar probable over claims proved and probable";
  - "rejects a denied claim at proved, and polarity on a disproved claim";
  - "RESEARCH_SHAPES mirrors research.schema.json exactly (drift guard)" passes with the new fields, its `defFor` map gaining each new `$def`;
  - "rejects a claim that names no object".
- `tests/validation/person-id-refs.test.ts`: "a merge remaps Couple, fact-subject, identity, same_as and name persons in claims".
- `tests/tools/project-context.test.ts`: "claimKinds lists every kind the engine accepts".
- `tests/validation/rule-modes.test.ts` (new): "a rule in warn mode writes and warns; in refuse mode it refuses".
- `tests/packaging/research-append-examples.test.ts`: "the claims example validates".
- `packages/viewer-ui/src/components/sections/__tests__/ProofSummariesSection.test.tsx`: "renders fact, identity and finding claims".
- `tests/utils/merge-gedcomx.test.ts`:
  - "a Step and a Biological edge on one pair both survive dedup";
  - "an untyped edge folds into a typed edge on the same pair, whichever comes first, and keeps the subtype";
  - "notes survive dedup".
- `tests/tools/person-warnings.test.ts`:
  - "a Step father beside a Biological father raises no tooManyFathers2";
  - "a Couple's Marriage fact feeds hasEarlyMarriage14 and hasLateMarriage90".
- `tests/packaging/plugin-hooks.test.ts`: "a stringified ops batch to proof_summaries from a non-owner is denied".
- `eval/harness/tests/unit/test_write_lockdown_parity.py`: a new vector, "a case-variant `Research.JSON` write is denied", checked in all three copies. Then run `make hook-smoke` (live and billed).
- `eval/harness/tests/unit/test_e2e_judge.py`:
  - "the avoid guard passes when the avoided person is present but unlinked";
  - "the relationship branch fails when an edge joins the subject and the avoided candidate in the avoided role"; "an edge joining them in another role passes";
  - "the fact branch passes when a person sharing name tokens carries the fact type with another value";
  - "the fact branch fails when a non-subject person carries the avoided value".

**Deferred**
- **The warning gate reading ParentChild endpoints** → issue #2840, which owns the fix and its exempt list.
- **Editing `ut_person_evidence_021` and `ut_person_evidence_022` → Stage 3.** They sit in the person-evidence eval snapshot. Editing them buys a paid run, and under rule 10 (`eval/harness/scripts/check_runlogs.py`) that run must also clear whatever person-evidence xfail markers remain (see Stage 3's rule-10 paragraph).
- **Extraction labelling intent records** → record-extraction's next paid slot.
- **A claims-aware avoid guard** → Stage 4.

### Stage 1b — claims and status (paid slots: proof-conclusion, research, tree-edit)

**What changes**
- **`src/tools/research-append.ts` preconditions.** Each is decided from the documents. It runs whenever an op appends a summary or changes its `tier`, `claims` or `supporting_assertion_ids`, and reads the resulting summary; a narrative-only edit of a legacy summary never refuses (Decision 24). Each lands in warn mode and refuses from Stage 1c (Decision 25).
  1. **Rival verdicts.** A parent claim at `probable` or better needs a claim, at any tier or polarity, on every live untyped or Biological same-gender rival parent of that child (Decision 32 decides what covers a rival).
  2. **One answer per slot.** At most one affirmed claim at `probable` or better per biological parent slot, and per vital fact under Decision 3, compared by unfudged day ranges.
  3. **Disproof floor.** Ships refusing in Stage 1a, with the bound.
  4. **No empty escape on rivals.** A summary at `possible` or better, or `disproved`, with no tree-object claim is refused when a cited child has two or more live same-slot parents. A `not_proved` decline is exempt (Decision 27).
  5. **Claims present.** A summary at `possible` or better, or `disproved`, carries at least one claim.
  6. **Claims cite.** Every claim at `possible` or better, every denial and every `disproved` claim cites at least one assertion. An `absence` or `completeness` finding may instead cite absence assertions or `log_entry_ids`.
  7. **Grounding** (Decision 28). It binds the tree-object kinds only (`relationship`, `fact`, `identity`, `name`). The message names the person or the value assertion.
     - A persona is an assertion's `record_id` (else `source_id`) plus the engine's party key. A persona is tied to a person when any of its assertions, cited or not, has a live `confident` or `probable` link to that person. A link from a persona that a live denied identity claim covers does not count. Absence evidence is an assertion that `recordBasisOf` (`src/utils/record-basis.ts`) reads as `absent`, which includes the legacy negative-evidence spelling.
     - Person: each person the claim names is linked from an assertion it cites.
     - Fact: when it cites a non-absence assertion whose type maps to its `fact_type` by `toTreeFactType`, at least one such assertion's persona is tied to its subject. For a couple fact, each spouse is tied to the persona of at least one such assertion; no one persona need be tied to both, since a marriage record gives the groom and the bride a persona each.
     - Denial: a denial at `probable` needs only its anchor linked from an assertion it cites, never the person or value it denies: the child of a denied ParentChild, either person of a denied Couple or `same_as`, the subject of a denied fact (for a couple fact, either spouse, as for a denied Couple), and the person of a denied name or record identity. A cited contrary value assertion of a fact follows the Fact bullet against that subject.
  8. **Absence never grounds** an affirmed tree-object claim.
  9. **Polarity holds**, across every live summary: no object is both affirmed and denied; an object a live `disproved` claim covers is not affirmed again unless the same batch revises that claim; one record persona is not affirmed at `probable` or better as two persons.
  10. **Couple first.** An affirmed Marriage or Divorce claim at `probable` or better needs an affirmed Couple claim on the pair, at the same tier or better, in this summary or another live one.
  11. **Capped claims keep the question open.** A question cannot be set `resolved` while its summary holds an affirmed claim that rule 7 holds at `possible`, except a rival set aside beside a winner (`questionResolvedInvariants`).
  12. **Proved needs confident identity** (Decision 30).
- **`primary` follows its claim** (Decision 34). After the ops apply, `research_append` clears `primary` on each tree fact that a live affirmed claim at `probable` or better covered before the call (Decision 31's join) and none covers after it, whether the claim was lowered, denied, disproved or removed. It rides `rewriteLinkedFacts`' tree write and rollback, and the response names each cleared fact. A `primary` that no claim covered before the call (legacy or imported) is untouched (Decision 24).
  - `docs/specs/schemas/ownership.json`: the tree `persons` row's `requires` sentence that research_append writes persons "ONLY through the assertion-`update` rewrite" names this clear as its second route.
  - `eval/harness/validators/test_universal.py`: `_explained_by_fact_rewrite` (with `_fact_identity`) explains a `primary` this rule cleared, so `test_tree_ownership_table` stays green on a run that downgrades a claim. The table's tool-identity path, offered today only when `section == "persons"`, extends to `relationships` when the change is only cleared `primary` flags.
  - The clear also writes tree `relationships`, because Couple facts carry `primary` under the same rule. `docs/specs/schemas/ownership.json`'s tree `relationships` row adds `research_append` to `writerTools` and `toolAuthorized`, as the `persons` row already has it, with a `requires` limiting it to clearing `primary` on a Couple fact whose covering claim the same call removed. Tool identity authorizes it, so `hookRouting` is unchanged (its `treeRowsVia` holds one section per row). `docs/skill-dataflow.md` names the route in its tree `persons` and `relationships` ownership rows, and every statement that the assertion rewrite is `research_append`'s only tree route names the `primary` clear as the second:
    - `docs/specs/research-schema-spec.md`: the per-row check paragraph ("a tree row only through the one section that writes it"), its first per-row bullet ("on tree `persons`, which they reach only through the assertion-backlink fact rewrite"), and the "one derived exception" sentence under "Ownership for `tree.gedcomx.json`";
    - `docs/specs/guardrail-enforcement-spec.md`: the "Fact rewrite authorized by tool identity" row ("only when the whole persons delta is mirrored attributes on facts that already carried the same backlink"), which describes the check this stage widens;
    - `docs/specs/schemas/ownership.json`: the top-level `$comment` ("a tree row only through the one section that writes it — tree `persons` via `assertions`") and `hookRouting`'s `$comment` ("maps each tree.gedcomx.json row that tool writes").
- **Owed findings: `src/utils/owed-findings.ts` (new)**, served as `project_context.owedFindings`; "returns empty arrays for an empty project" (`tests/tools/project-context.test.ts`) gains it.
  - Each item is `{kind, ref, personIds, nextStep, blocksCompletion}`, in this order:
    - `extract`: a positive log entry on a question's plan item while that question has no assertion;
    - `conclude`: a question with an assertion tied to it (the per-question filter in `questionStatus`, `src/utils/question-state.ts`) and no proof summary;
    - `hypothesis`: a `supported` hypothesis with no proof summary on a related question;
    - `encode`: an affirmed tree-object claim at `probable` or better that no tree object matches by Decision 31's join. It replaces `treeEncodingCompletionWarnings`' shape match;
    - advisory, never blocking: `raise` (an affirmed claim at `possible` that is not a set-aside rival), `claims` (a legacy summary at `possible` or better with none), `frame` (a project where no assertion is tied to any question).
  - `blocksCompletion` is true for `conclude` and `hypothesis`. Completion with a blocking item, or with an `encode` item, warns (Decision 33).
  - `src/utils/question-state.ts`: `nextStep` gains the matching arms.
  - `docs/specs/schemas/owed-findings-vectors.json` (new) pins the list. Spec: `docs/specs/project-context-tool-spec.md`.
- **`src/utils/conclusion-status.ts` (new)** joins every tree fact and edge to claims and the import baseline by Decisions 31 and 32, and returns its Decision 6 status.
  - `src/tools/project-context.ts` returns it only under `include: ["status"]`, a closed enum; the default projection gains only `claimKinds` and `owedFindings`.
  - The parent-count warnings skip a parent whose edge reads set aside or ruled out (Decision 26) on all three paths that compute them:
    - the `person_warnings` tool (`src/tools/person-warnings.ts`), which reads research.json for it;
    - the write gate: `checkWarningGate` (`src/tools/tree-edit.ts`) passes the research.json it already holds through `introducedWarnings` and `warningsForPerson` (`src/validation/introduced-warnings.ts`), which covers `tree_edit`, `tree_correct`, `materialize_facts` and `merge_tree_persons`;
    - the `src/tools/merge-warnings.ts` dry run, from the research.json it already reads.

    Spec: `docs/specs/person-warnings-tool-spec.md`.
  - `findCompetingParentage` (PR #3207, `src/validation/introduced-warnings.ts`) skips the same parents, read from claims, so the winner's edge lands while a set-aside import stays; with no live summary it still refuses and routes to conflict-resolution (Decision 26). The merge warning for "a second likely parent" reuses it. Spec: `docs/specs/tree-edit-tool-spec.md`.
  - `docs/specs/schemas/conclusion-status-vectors.json` (new) pins it for the viewer port in Stage 2.
- **Writer tools:** `src/tools/tree-edit.ts` (whose applier also serves `tree_correct`), `src/tools/merge-tree-persons.ts`, and `mergeFacts` in `src/utils/merge-gedcomx.ts`. `merge_warnings` previews folding a record's candidate persona into a tree person, before any identity claim can exist, and a survivor may appear in only one of its pairs, so no edge can collapse there; it gains only the parent-count skip above.
  - **`primary`** (Decision 34): `add_fact`, `add_person`'s inline facts, `add_relationship`'s inline Couple facts and `update_fact` set `primary: true` only on a fact an affirmed claim at `probable` or better covers. Warns until Stage 1c.
  - `add_relationship`, and its corroborate path, refuse a pair a `disproved` claim covers. This refuses at once: no `disproved` claim exists before this stage, so there is nothing to measure.
  - `merge_tree_persons` refuses a merge of two persons an edge joins, naming the edge (Decision 13). It refuses at once, with no warn mode: the merge would turn the edge into a self-relationship that `dedupRelationships` (`src/utils/merge-gedcomx.ts`) drops silently, an impossibility like an ancestry cycle, so there is no false positive to measure.
  - Each of these raises a synthetic introduced warning, which a persisted `warningJustifications` entry must cover:
    - `remove` of an import with no disproof;
    - `update_relationship` when no claim names that subtype;
    - a merge that leaves one object affirmed and denied, a ruled-out pair, a second likely parent, two incompatible likely vitals, or a merged pair no identity claim covers (Decision 13). Rules 2, 9 and 12 re-run on the post-merge documents to find these.
  - The existing tests these warnings reach gain a justification, so each still tests what it did: "writes both files, repoints research person-id refs collapsed→survivor, and reports counts" and "merges an initial-form name into the survivor's fuller name" (`tests/tools/merge-tree-persons.test.ts`); the merge case in `tests/tools/introduced-clone-contract.test.ts`, so it still reaches the clone check (an identity claim would put I1 in research.json before the merge and trip its stub); and "remove (tree_correct): deletes a fact by id; refuses to remove a person" (`tests/tools/tree-edit.test.ts`), whose ref-less F1, with no baseline, reads as an import (Decision 7).
  - Merges stop marking `primary`: a merge keeps each input `primary`, except that when two facts of one vital type would both carry it, the survivor's keeps it. "never leaves two primaries of the same vital type, even when both inputs were primary" (`tests/utils/merge-gedcomx.test.ts`) also asserts that the survivor's 1900 Birth is the one kept.
  - `dev/smoke-calls.ts`'s `merge_tree_persons` row merges P2 into P1 (`merges: [["P1","P2"]]`, unchanged, survivor first), which no edge joins and no identity claim covers. It now expects the refusal (`reason: "unjustified_warnings"`). A following row repeats the call with the returned `warningId` justified, captured through the row's `after` hook into `ctx.values`. So `make engine-smoke-stdio` and `make engine-smoke-http` smoke the new rule and the merge's write over both transports.
  - Specs:
    - `docs/specs/tree-edit-tool-spec.md`, `docs/specs/merge-gedcomx-spec.md`, `docs/specs/simplified-gedcomx-spec.md` (retire the "Ruled intended 2026-09-11" paragraph) and `docs/specs/guardrail-enforcement-spec.md` (new rows);
    - `docs/specs/schemas/ownership.json`: the tree `persons` row's "Only proof-conclusion sets `primary`/`proof_tier` … it may not set one" becomes Decision 34 (any writer sets `primary` only on a fact an affirmed claim at `probable` or better covers; a merge never sets it);
    - `docs/skill-dataflow.md`: the proof-conclusion row ("hard-blocks before Step 1") and the tree-edit row (the merge precondition);
    - the worked example in `docs/specs/research-schema-spec.md` §9 gives `ps_001` the claims its `primary` facts now need.
- **Agent and skill bodies.** Each changed body that holds `project_context` gets one skew line: when `project_context` lacks `claimKinds` or `owedFindings`, fall back to today's behaviour, spelled out in the line because this stage deletes it from the body: proof-conclusion omits `claims` and marks the concluded value `primary` as today; the research skill treats a summary at `probable` or better whose concluded object is not in the tree as unencoded. tree-edit holds no `project_context`, so it takes none; on an engine older than Stage 1a its one new call, `update_relationship`, is refused as an unknown operation.
  - `packages/engine/plugin/agents/proof-conclusion.md`:
    - write a claim for every object concluded, every rival set aside (a denial, or an affirmed claim at `possible`) and every object ruled out (`disproved`), using only the kinds and polarity `claimKinds` lists;
    - write a fact claim from the values of the tree fact it concludes, when one exists;
    - the scalar `tier` states the whole answer and never exceeds the strongest claim;
    - a record that would only narrow a date range caps the scalar `tier`, not the claim: a bracket claim is tiered on the bracket's own support, and encoded at `probable` or better;
    - the identity precondition no longer stops the proof: an unlinked person's claim is written at `possible` with `shortfall: gap`, the question stays open, and the return routes to person-evidence;
    - a downgrade removes a tree object whose covering claim falls below `probable`, except an import, which is relabelled, and unless another live claim covers it;
    - delete the "Optional `claims` field" paragraph, the multi-claim exception, the bounded carve-out (replaced by the bracket rule above), "Per-claim downgrade", and every `primary` instruction the `primary` rule replaces.
  - `packages/engine/plugin/agents/tree-edit.md`:
    - `primary` only on a claimed value; a retype names the covering claim; import removal with a justification;
    - a merge rests on Decision 13's identity decision, not "a `probable` or higher proof_summary", and the duplicates line's "merge decisions still require proof-conclusion" changes to the same rule. A merge the user instructs proceeds, its justification quoting the user, unless an edge joins the pair, which the tool refuses.

    The `primary` and merge clauses of `eval/tests/unit/tree-edit/rubric.md` ("Evidence grounding") change with it.
  - `packages/engine/plugin/skills/research/SKILL.md`: the tree-encoding gate reads `encode` items from `project_context`, not the scalar; the completion row treats a question held open only by claims rule 7 caps (an advisory `raise` item) as not blocking.
- `src/tools/research-append-examples.ts`: the base `proof_summaries` example carries claims.
- **Eval-only**, in `eval/harness/harness/mock_mcp.py`: `merge_tree_persons` becomes live in the unit harness, as production grants it to tree-edit. It joins `LIVE_TOOLS`, `_COMPILED_TOOLS` as `("merge-tree-persons.js", "mergeTreePersons")`, and `OK_FALSE_IS_FAILURE_LIVE`, which `test_ok_false_gate_set_has_not_drifted_from_the_typescript_source` in `eval/harness/tests/unit/test_mock_mcp.py` checks. Without it the new merge-on-instruction case cannot merge, and `_007`/`_015`'s refusal never runs. `_005` and `_006` gain a merge tool they never had; both judge contexts already forbid merging.
- **Eval-only**, in `eval/harness/validators/test_proof_conclusion.py`:
  - a run fails when the last `research_append` response to an op that appended a summary, or changed its `tier`, `claims` or `supporting_assertion_ids`, carries "Will be refused:", keyed on that summary's id; or when the last `tree_edit` or `tree_correct` response touching a given fact (its holder and fact id, or the id an add returns) does, since the `primary` rule's warnings come back there. A later clean write to a different fact or summary does not clear it. That matches refuse mode: a warned write the agent then corrects passes, as a refused one it then corrects would, and a later narrative-only edit does not clear the warning. It is stricter in one case: a `primary` warning clears only on a later clean tree write to that fact, even when a `research_append` claim has since covered it;
  - the new "Will be refused:" check is itself tested in `eval/harness/tests/unit/test_proof_conclusion_validator.py`. Must fire: "a warning naming F2 with no later clean write to F2 fails"; "a later clean write to F3 does not clear F2"; "a clean write to F2 on I2 does not clear a warning naming F2 on I1"; "a narrative-only edit does not clear a warned summary". Must not fire: "a warning naming F2 in a batch that also wrote F1, followed by a clean write to F2 alone, passes";
  - `test_bounded_conclusion_is_tiered_and_encoded` requires a Death `fact` claim on I1 carrying the bracket, and a Death fact on I1 exactly when that claim is affirmed at `probable` or better. Today it requires the fact at `possible` too (lead ruling, 2026-08-21). `test_accepts_possible_with_an_encoded_bracket` and `test_rejects_possible_that_never_reached_the_tree` in `eval/harness/tests/unit/test_proof_conclusion_validator.py` change with it: the first gains the bracket claim, and the second rejects a `probable` bracket claim that never reached the tree.
- **Specs:**
  - `docs/specs/research-append-tool-spec.md` (the rules) and `docs/specs/guardrail-enforcement-spec.md` (new rows);
  - `docs/specs/project-context-tool-spec.md`: the `include` parameter; §3's "no field selectors" rewritten, its one-consumer premise gone; "a few hundred tokens" replaced by the measured median of 3,571 and maximum of 14,636 characters over the 202 committed final projects.

**What does not change**
- There is no tree field, no new research.json section and no question field.
- Nothing is drafted or projected beyond that `primary` clear; proof-conclusion writes the tree with `tree_edit` after the summary lands, as now.
- The hook is unchanged, and no agent gains or loses a tool.
- gps-mentor is unchanged (Decision 36).
- Facts and household edges still land at link time until Stage 3. The status lookup labels any claim-less, non-import tree object "found in a record, not yet checked".
- There is no evidence view yet, so rival detection reads tree edges only.
- A bounded request still ends at its deliverable (PR #3147, PR #3187).

**Acceptance check.** Each warning or refusal case asserts its rule's own message, so it fails on main today. A must-not-fire case passes on Stage 1a, whose claims expand accepts the claim shapes most of them use, and must keep passing.
- `tests/tools/research-append.test.ts`. Each rule, and each clause of a rule with several, has must-fire cases in at least two distinct shapes plus must-not-fire cases (ADR-0011, limit 2). These rules live only in the writer tool, so the guard-case registry cannot see them and this list is their only check.
  - Must fire:
    - rule 1: "a likely parent claim beside an unverdicted rival warns"; "a likely mother claim beside an unverdicted Biological rival mother warns";
    - rule 2: "probable Birth claims of 25 Nov 1879 and 1880 for one person warn"; "probable Death claims of 1901 and 1903 in one summary warn"; "two probable father claims for one child in two live summaries warn"; "two probable mother claims for one child in one summary warn";
    - rule 4: "a probable summary whose only claim is a finding, citing a child with two live fathers, warns"; "a possible summary whose only claim is a rejected_candidate finding, citing a child with two live mothers, warns";
    - rule 5: "a probable proof appended with no claims warns"; "an update raising a summary to probable with no claims warns";
    - rule 6: "a disproved claim citing no assertion warns"; "a probable denial citing no assertion warns";
    - rule 7: "a probable ParentChild claim whose parent no cited assertion links warns, and the same claim at possible passes"; "a probable fact claim whose value record is linked to nobody warns"; "a probable Birth claim whose only birth persona is tied to a sibling, while a census links the subject, warns"; "a probable Marriage claim whose only marriage persona is tied to the groom, the bride linked only through another record, warns"; "a probable denial whose contrary record is linked to nobody warns"; "a probable denial whose only linked cited assertion links the denied father, not the child, warns"; "a probable denial of a Birth whose only cited contrary birth persona is tied to a sibling, while a census links the subject, warns"; "a probable claim whose only link runs through a persona a live denied identity claim covers warns";
    - rule 8: "an affirmed fact claim citing only absence evidence warns"; "an affirmed ParentChild claim citing only absence evidence warns";
    - rule 9: "affirming a Couple that another live summary rules out warns; revising that summary in the same batch passes"; "two live summaries affirming and denying one edge warn"; "one summary affirming and denying one fact warns"; "affirming a fact a live disproved claim covers warns"; "one record persona affirmed at probable as two persons in one summary warns"; "the same across two live summaries warns";
    - rule 10: "a probable Marriage claim with no Couple claim warns"; "a probable Divorce claim beside only a possible Couple claim warns";
    - rule 11: "resolving a question whose summary holds a claim held at possible by grounding warns"; "resolving a question whose summary holds a fact claim held at possible by grounding warns";
    - rule 12: "a proved claim on a probable-only link warns, and a proved identity claim on a probable link does not cover it";
    - `primary`: "lowering the covering claim to possible clears primary in the same write"; "removing the covering claim from claims clears primary";
    - owed findings: "completion with a question that has tied assertions and no summary warns";
    - "a rule in refuse mode refuses", for one representative rule.
  - Must not fire:
    - "a not_proved decline with no claims passes";
    - "a narrative-only edit of a legacy probable summary passes";
    - rule 1: "a likely parent claim beside a rival carrying a possible denial passes"; "a Step rival needs no verdict";
    - rule 2: "two probable Marriage claims with different years on one Couple pass"; "probable Birth claims of 1879 and 25 Nov 1879 for one person pass";
    - rule 4: "a not_proved decline with no claims on a child with two live fathers passes"; "a probable summary with only a finding, on a child with one father, passes";
    - rule 7: "a parent claim whose two people are linked from different cited assertions passes"; "a probable denial of an import father no cited assertion links, whose contrary baptism is linked to the child, passes"; "a probable parent claim whose baptism is linked to the child alone, beside the father's own linked census, passes";
    - rule 8: "an absence finding citing only negative evidence passes";
    - rule 9: "one persona affirmed at probable as I1 and at possible as I2 passes";
    - rule 10: "a probable Marriage claim beside a probable Couple claim in another live summary passes";
    - rule 11: "resolving a parentage question whose unlinked import rival is set aside at possible passes";
    - rule 12: "a proved claim covered by a proved identity claim whose own persona link is confident passes";
    - `primary`: "primary stays when another live probable claim covers the fact"; "a legacy primary no claim covered is untouched".
- `tests/tools/research-append-claim-grounding.test.ts` (new) reads `tests/fixtures/claim-grounding-vectors.json` (new, about 0.5 MB). The vectors are built from the hand labels committed with this plan at `tests/fixtures/claim-grounding-labels/` (7 files, 45 entries: the claims study's 44 hand-labelled e2e proofs and its one disproved proof; the 10 labels drawn from production feedback bundles are deliberately not committed), joined to the committed runs they name. Each vector is one concluded object and its expected tier, citing its proof's full supporting set; it copies in those assertions, the rest of their records and their live links, keeping only the fields rule 7 reads, so CI never reads `eval/runlogs`. Rule 7 holds at `possible` exactly 8 of 89 relationships, each for an unlinked person, 0 of 25 facts and 1 of 11 couple facts, whose spouse is unlinked. `georg-gajdosch-spouse`'s proved Marriage of 24 January 1714 stands at `proved` though no one persona is tied to both spouses: the groom's `a_063` is tied to K69J-F7Y and the bride's `a_070` to I2.
- `tests/utils/conclusion-status.test.ts` (new), over `conclusion-status-vectors.json`:
  - issue #2511's shape: two FamilySearch parent sets, `Biological` imports against untyped rivals, one set concluded `probable` by untyped claims, no exhaustive declaration. The concluded set reads likely; the other reads "set aside in favour of" it, and its removal is offered, not performed;
  - "a claim of 25 Nov 1879 does not cover a fact of 1880, and the near miss names both";
  - "a place-only claim matches its fact";
  - "a probable denial with no winner reads doubted";
  - "an imported edge corroborated by a census still reads as an import with no baseline".
- `tests/utils/owed-findings.test.ts` (new), over `owed-findings-vectors.json`.
- `tests/utils/question-state.test.ts`: "an unencoded claim reports the encode step"; "a supported hypothesis with no summary routes to proof-conclusion".
- `tests/tools/project-context.test.ts`:
  - "include: ['status'] returns a status for every tree object";
  - "the default projection has the same length before and after adding 50 facts and 20 edges that cite existing sources";
  - "owedFindings lists an unextracted log entry before a question with tied assertions and no summary".
- `tests/tools/tree-clear-primary.test.ts`: "primary on a fact no claim covers warns"; "an add_relationship Couple Marriage marked primary with no covering claim warns"; "an update_fact setting primary on a fact whose id two persons share warns, naming that person's id and the fact id"; "primary on a fact a probable claim covers passes".
- `eval/harness/tests/unit/test_universal_validators.py`: "a `primary` cleared by research_append's claim rule is explained, on a person fact and on a Couple fact".
- `tests/tools/merge-tree-persons.test.ts`:
  - "a merge sets no primary". This inverts the tests in `tests/utils/merge-gedcomx.test.ts` that pin today's behaviour, including "marks a lone vital fact primary even when nothing was merged into it";
  - "a merge that re-creates a ruled-out pair needs a justification";
  - "a merge that leaves one summary affirming and denying an edge needs a justification";
  - "a merge leaving a second likely parent needs a justification";
  - "a merge leaving two incompatible likely vitals needs a justification";
  - "a merge no identity claim covers needs a justification, and one a probable identity claim covers does not";
  - "a merge of a parent into its own child is refused and names the edge".
- `tests/tools/tree-edit.test.ts`:
  - "removing an imported ParentChild edge with no disproof needs a justification"; "removing an import a disproved claim covers needs no justification";
  - "add_relationship refuses a ruled-out pair, through its corroborate path too";
  - "update_relationship to a subtype no claim names needs a justification, and to one a claim names needs none";
  - "adding the concluded father beside a father that reads set aside needs no justification";
  - "a winner's edge beside an import its live summary sets aside lands with no justification; with no summary it is refused and routed".
- `tests/tools/person-warnings.test.ts`: "a second father that reads set aside raises no tooManyFathers2".
- `dev/replay-owed-findings.ts` (new, developer-only): over the committed e2e runs, the blocking kinds fire on 0 of 158 completed runs. `encode`'s fire rate is measured in Stage 1c, since no committed run carries claims.
- **Paid runs:** `make eval-skill SKILL="proof-conclusion research tree-edit"`, each with a genealogist annotation.
  - proof-conclusion, new: "a parent proof beside an import rival writes a denial that sets it aside" (issue #2511's shape); "an answer whose subject is unlinked is written at possible, writes no tree object, and leaves the question open"; "a marriage proof writes Couple and Marriage claims".
  - proof-conclusion, changed:
    - `not-found-state-explicit-negative.json` expects an `absence` finding;
    - `bounded-death-encoded-not-collapsed.json` (`ut_proof_conclusion_018`) expects a `probable` Death claim carrying the bracket under a `possible` scalar, encoded as now; its judge-context ENCODING line cites the claim, not a carve-out;
    - `split-parentage-per-claim-tier.json` rewords the judge-context line that cites the stronger-claim rule;
    - `rubric.md` grades claims, not `primary`.
  - research, new: "a likely claim with no tree object routes back to proof-conclusion"; and the must-not case "a live job with plan items left keeps searching".
  - tree-edit, new:
    - "a retype names the claim that covers the subtype";
    - `merge-on-user-instruction-no-identity-claim.json` (new), on `mid-research-flynn-merge-pending`: the user tells the agent to merge stub I3 (James Flynn) into I4 (James Patrick Flynn). No edge joins them and no identity claim covers them (`ps_002` carries no claims), so the merge proceeds with the user's instruction quoted as its justification (Decision 13). `eval/fixtures/scenarios/mid-research-flynn-merge-pending/README.md`, which the judge reads, changes with it: it calls `ps_002` "the proof gate that authorizes the merge", but `ps_002` carries no claims and authorizes nothing under Decision 13; the new test is listed under its tests, and its `ut_tree_edit_006` line ("merge I3 into I4 (full reference rewrite…)") becomes "consolidates I3's names and facts onto I4 without deleting I3". Only tree-edit tests use this scenario.
  - tree-edit, changed: `refuse-merge-without-proof.json` (`ut_tree_edit_007`) and `refuse-merge-pre-stated-identity-direct.json` (`ut_tree_edit_015`) keep expecting a refusal. Their judge context's reason becomes the tool's: in `mid-research-flynn`, edge R1 joins I2 (Thomas, the father) and I1 (Patrick, the son), so `merge_tree_persons` refuses the merge and the agent explains that, in place of the retired "proof-conclusion at `probable` or higher" threshold. `person-merge-stub-into-fs-person.json` (`ut_tree_edit_006`) is unchanged in this stage: it copies I3's facts onto I4 with `add_fact` and does not merge (its judge context says not to delete I3), and rule T reaches its add in Stage 3b.

**Deferred**
- **Rivals found only in records** → Stage 2.
- **A conclude-time projection**, where `research_append` writes standing claims into the tree → Stage 3, if `encode` fires often before Stage 1c.
- **Whether completion refuses on owed findings** → the lead re-rules the 2026-08-24 call on Stage 1c's measured fire rate.
- **Routing to owed findings, researcher statements, the hosted delivery check** → `conclusion-tree-later.md`.
- **Typed question targets** → issue #3213.

None of the three suites carries an xfail marker, so `rule10_no_xfail_markers` adds no work.

### Stage 1c — the flip to refuse (0 paid slots)

**What changes.** `src/validation/rule-modes.ts` moves Stage 1b's rules 1, 2 and 4–12 and the `primary` rule from warn to refuse. Completion on owed findings stays a warning until the lead re-rules (Decision 33).

**When.** After at least 10 e2e runs made on or after Stage 1b's merge.

**What changes, besides the modes.** Existing engine tests that write a summary at `possible` or better, or set `primary`, with no claim are given grounded claims, since the flipped rules would refuse them: the success-path summaries in `tests/tools/research-append.test.ts` (no test there writes `claims` today), in `tests/tools/tree-edit.test.ts`, "add_fact: relationshipId appends to the Couple's own facts with an F id and the primary swap", "add_fact: assigns the next F id, resolves standard_place, swaps the primary, writes only the tree and no .bak", the two "add_fact: nulls an … standard_place" cases (auto-resolved and explicitly supplied), and "KEEPS the backlink when the op re-states a field at the value it already holds" where it restates `primary`; and "primary: true still moves the flag, as before" in `tests/tools/tree-clear-primary.test.ts`.

**What does not change.** No agent body, schema or rule text.

**Acceptance check**
- `dev/replay-rule-modes.ts` (new, developer-only) runs every warn-mode rule over those runs' final `research.json` and tree and lists each fire. Fires are recomputed, not grepped: a run log keeps only a truncated `response_summary`, stripped after 14 days. Every fire is read (ADR-0011 limit 2): each is a true positive, or the PR names the false one and that rule stays in warn mode.
- The same report gives `encode`'s fire rate for Decision 33.
- Each Stage 1b must-fire case for rules 1, 2 and 4–12 in `tests/tools/research-append.test.ts`, and each `primary` warning case in `tests/tools/tree-clear-primary.test.ts`, now refuses. The `primary`-clearing cases still clear, and completion on owed findings still warns (Decision 33).

**Deferred.** Rule T's flip → Stage 3b.

### Stage 2 — the evidence view and its readers (paid slots: project-status, hypothesis-tracking, question-selection, research)

**What changes**
- **A new `src/utils/evidence-view.ts`** computes "found in records" for each tree person from assertions and `pe_` links.
  - **Facts** use `materialize_facts`' mapping. `toTreeFactType`, `materializesToPersonFact` and the skip sets are already shared in `src/utils/record-persona.ts`. The agree-collapse rule (`factsEquivalent` plus an equal `value`, filling absent fields and unioning refs) is still inline in `src/tools/materialize-facts.ts`; it moves into `record-persona.ts` rather than being copied.
  - **Relationships** come from assertions with live `pe_` links to both endpoints, with direction from `ownPartyLinkedTo` (moved out of `src/tools/research-append.ts` into a shared util).
    - Spouse-of-parent pairs are labelled implied.
    - Co-parent pairs are view-only.
  - Evidence resting only on a speculative link, or on a persona a live denied identity claim covers, is hidden unless asked for (Decision 19).
  - The module also exports a same-record exclusion helper.
- **`src/tools/project-context.ts`** returns the view only under `include: ["view"]`, narrowed by `personIds` when given; the default projection carries no view.
- **`src/tools/research-append.ts`:** rules 1 and 4 also count a parent the view shows for the child: untyped or Biological, same gender, not labelled implied, not a view-only co-parent, and not hidden under Decision 19. `src/utils/conclusion-status.ts` reads the same set, so Decision 8's label agrees with the rule. The widened arm has its own entry in `src/validation/rule-modes.ts`: it lands in warn mode and refuses from Stage 2b. Spec: `docs/specs/research-append-tool-spec.md`.
- **`src/tools/same-person.ts`:**
  - the tree side sends imports, conclusions and the view, minus anything sourced to the record being scored;
  - it refuses to score a tree person minted from that record, reusing the exported `mintedFromThisRecord` (`src/tools/research-append.ts`);
  - spec: `docs/specs/same-person-tool-spec.md`.
- **Viewer** (`packages/viewer-ui/src/`):
  - a port of the status lookup pinned by `conclusion-status-vectors.json` (new `lib/conclusion-status.ts`);
  - the import baseline reaches the viewer, so the port applies Decision 7 as `project_context` does: `ProjectStateSnapshot` (`transport.ts`) gains `startingTree`, which Electron reads by adding `starting-tree.gedcomx.json` to `WATCHED_FILES` (`apps/electron/src/main/watcher.ts`), stored for hydration in `getCurrentState()` and cleared in `stopWatching`, as `lastGedcomx` is, and passes through `apps/electron/src/renderer/src/transport/IpcResearchTransport.ts`, and `contexts/ResearchDataProvider.tsx` hands to the port. On the hosted side the snapshot comes from REST `GET /api/sessions/{id}/state`: `session_state` returns `startingTree` in `apps/server/app/sessions.py` (from `read_project_snapshot`, `apps/server/app/sandbox/base.py`) and in `apps/server/proto/web/app.py` (from `documents`), and `apps/web/src/transport/WsResearchTransport.ts`'s `getProjectState` maps it. Because `project_create` writes the baseline after the viewer has loaded, `_emit_change` (`apps/server/app/sandbox_server.py`) and the prototype's `DOC_WIRE` also push it when it changes, through a new `SubscriptionHandlers` entry (`transport.ts`) both transports call. The hosted `send_snapshot` (`sandbox_server.py`) also resends the baseline on every WebSocket (re)connect, as it resends research and tree. Electron's new push channel goes through the preload: a listener beside `onGedcomxUpdated` and the channel in `removeAllWatchListeners` (`apps/electron/src/preload/index.ts`), the new `AppAPI` member and `getState`'s return type (`apps/electron/src/preload/index.d.ts`), and the channel's row in the allow-list of `apps/electron/.claude/skills/security-invariants/SKILL.md`. Nothing types `index.ts` against `index.d.ts`, so a missed listener would pass typecheck and throw at runtime. Before merge, verify the sandbox image with `E2B_TEMPLATE_NAME=genealogy-agent-dev make sandbox-image`;
  - status chips in `components/shared/PersonCard.tsx` and `components/sections/ProjectOverview.tsx`;
  - `lib/relationship-label.ts` stops treating untyped as biological;
  - per-record found-in-records rows in `components/sections/PersonEvidenceSection.tsx`;
  - rival parent sets side by side (a new component);
  - the new labels and colours in `components/shared/StatusBadge.tsx`. Each new `statusColorMap` key is copied into `eval/app/components/scenario/components/shared/StatusBadge.tsx` (`eval/app/tests/unit/statusBadgeParity.test.ts`), and each new label is added to the display-label table in `docs/specs/research-schema-spec.md` §5.11, whose 2026-09-14 rule reserves "conclusion" for `proved`.
- **Agents:**
  - `packages/engine/plugin/agents/project-status.md` and `hypothesis-tracking.md` gain `project_context` in all three spellings, with an updated `tests/packaging/agent-tool-names.test.ts` snapshot.
  - `question-selection.md` already holds it, and switches its tree read to it.
  - project-status, question-selection and hypothesis-tracking pass `include: ["status"]` (Decision 22); record-extractor and research-exhaustiveness, which make most calls, do not.
- **e2e:**
  - `eval/harness/e2e/orchestrator.py` saves `project_context`'s view (`include: ["view"]`) at the end of each run, beside the final tree;
  - `eval/harness/e2e/judge.py` and `judge_prompt.md` grade recall from the final tree plus the saved view for every finding kind, and report found (tree or view) beside concluded (claims) for every finding; for a relationship finding they also report whether the proof narrative concludes it with no claim covering it (issue #3213's trigger). `judge_prompt.md` also drops "the deliverable that uploads to FamilySearch" (Decision 16);
  - a shadow detector in `eval/harness/harness/skill_invocation.py` fires on a relationship fixture whose verdict proof's claims are all findings, registered in `tests/guard-cases/registry.json` with its case file;
  - spec: `docs/specs/e2e-test-spec.md`.

**What does not change**
- The tree still holds link-time evidence until Stage 3.
- The e2e verdict stays on found.
- `eval/app`'s forked scenario viewer changes only in its `StatusBadge.tsx` colour map.

**Acceptance check**
- The starting tree arrives on every path:
  - `apps/electron/src/preload/__tests__/channel-mapping.test.ts`: the preload listens on `channelMap['starting-tree.gedcomx.json']`;
  - `assertTransportContract` (`packages/viewer-ui/src/contract.ts`), which both transport tests run, asserts `startingTree`; `ResearchDataProvider.test.tsx` checks it reaches the port;
  - `apps/server/tests/test_sandbox_watch.py`: "the starting tree broadcasts", beside `test_research_and_tree_still_broadcast`;
  - `apps/server/tests/test_sessions.py`: a new `/state` test for the E2B route returns `startingTree`;
  - `apps/electron/src/main/__tests__/watcher.test.ts`: "stores the starting tree in getCurrentState() and stopWatching clears it", beside "stopWatching clears the stored notice";
  - `apps/electron/src/renderer/src/transport/__tests__/IpcResearchTransport.test.ts`: "routes a starting-tree push to its handler", beside "routes a folder notice to handlers.onNotice";
  - `apps/web/src/transport/__tests__/WsResearchTransport.test.ts`: "routes the starting-tree wire type to its handler" (the transport's `subscribe` is a string switch, so typecheck cannot catch a missing case);
  - `apps/server/tests/test_sandbox_watch.py`: "send_snapshot resends the starting tree", with `_RecordingHub` extended to record `send_one`;
  - `apps/server/tests/test_proto_web.py`: `test_state_reads_documents_and_the_unserved_routes_say_so` pins `startingTree` in `/state`'s shape, and `test_stream_snapshots_documents_at_open_then_emits_changes_without_ids` covers its push.
- `dev/replay-evidence-view.ts` (new, developer-only) replays the 41 e2e runs committed at f73a26962 and dated 2026-09-01 or later, less anders-monsen-ancestry's 2026-10-05 run, which landed after these counts were taken. The view must reproduce:
  - 511 of the 518 facts `materialize_facts` minted;
  - all 152 person-evidence agent edges: 142 with their stored type, and the 10 co-parent pairs as view-only, by design.

  It also lists every child whose view shows a qualifying parent beside a different tree parent, which Stage 2b reads before the widened rival arm refuses (ADR-0011 limit 2).
- `tests/utils/evidence-view.test.ts` (new) pins vectors drawn from those runs, so CI does not read `eval/runlogs`; one vector hides a persona a live denied identity claim covers.
- `tests/tools/research-append.test.ts`:
  - must fire: "a probable parent claim beside a rival named only by a linked baptism warns"; "a summary with no tree-object claim, citing a child whose view shows a second same-sex parent, warns";
  - must not fire: "the same claim with a denial on that rival passes"; "a rival resting only on a speculative link does not count"; "a census wife labelled implied is not a rival mother".
- `tests/tools/same-person.test.ts`:
  - "a relative attached only by the record being scored is not sent";
  - "scoring a person minted from the scored record is refused".
- `tests/tools/project-context.test.ts`: "the default projection carries no view".
- `packages/viewer-ui/src/lib/__tests__/relationship-label.test.ts`: "an untyped edge and a Biological edge render different labels", which fails today because `parentChildLabel` labels both "Parent of"; the test 'omits "Biological" subtype (treated as implicit default)' inverts with it. PersonCard receives the label as a prop, so the label test lives here, not in `PersonCard.test.tsx`.
- A test for side-by-side rival parent sets beside the new component.
- `packages/viewer-ui/src/lib/__tests__/conclusion-status.test.ts` (new): "the port returns every vector's expected status", over `docs/specs/schemas/conclusion-status-vectors.json`, so the port cannot drift from the engine.
- `eval/harness/tests/unit/test_e2e_judge.py`: the judge output carries found and concluded for every finding, and narrative-concluded-but-unclaimed for every relationship finding; "a fact present only in the view is graded found", computed in `judge.py` so it is deterministic.

**Deferred**
- **The widened rival arm's refusal** → Stage 2b.
- **Retiring link-time writes** → Stage 3.
- **The verdict switch** → Stage 4.
- **FamilySearch relationship sources in `person_read`** → issue #3229, filed 2026-10-07 for imported relationship-level sources and the child-and-parents grouping.

### Stage 2b — the widened rival arm refuses (0 paid slots)

**What changes.** The widened rival arm's entry in `src/validation/rule-modes.ts` moves from warn to refuse.

**When.** After at least 10 e2e runs made on or after Stage 2's merge.

**What does not change.** No agent body, schema or rule text; only that mode.

**Acceptance check**
- `dev/replay-evidence-view.ts`, run over those runs, lists every child whose view shows a qualifying parent beside a different tree parent, and every one is read (ADR-0011 limit 2): each is a true rival, or the PR names the false one and the arm stays in warn mode.
- Stage 2's two must-fire cases in `tests/tools/research-append.test.ts` now refuse.

**Deferred.** None.

### Stage 3 — retire link-time writes; one doctrine (paid slots: person-evidence, research, proof-conclusion, tree-edit, record-extraction)

**What changes**
- `packages/engine/plugin/agents/person-evidence.md`:
  - stops writing facts and edges, and only mints persons;
  - loses `tree_edit` from `tools:` in all three spellings (`tests/packaging/agent-tool-names.test.ts`). `docs/specs/schemas/ownership.json` drops `tree_edit` from `agent:person-evidence`'s `agentCallers` entries on the tree `persons`, `relationships` and `sources` rows, or `tests/packaging/ownership-manifest.test.ts` fails "names tree_edit, which it is not granted" on all three. It also drops `agent:person-evidence` from the `relationships` row's `unitCallers`. The `persons` row's `reason`, `requires` and `remedy`, the `relationships` row's `reason`, `requires` and `remedy`, the `sources` row's `notes`, and the `TREE_NARROWED` comment in `eval/harness/tests/unit/test_ownership_manifest.py` are rewritten to name-and-gender minting and rule T;
  - carries its `summary_for_user` return contract (`tests/packaging/agent-return-contract.test.ts` holds it PENDING "lands with its next body edit"), unless issue #2537 lands first with it.
- `src/tools/materialize-facts.ts`:
  - mints persons with a name and gender only;
  - writes nothing onto a person who already exists, in either arm: it returns `created: false` with zero counts, still reports `conflicts_surfaced` against that person's tree facts, and says the persona's facts now appear in the found-in-records view. An older person-evidence body that still enriches keeps working and writes nothing (Decision 25). In the 41 runs Stage 2 replays, this branch added at least 140 facts and 95 names;
  - every case in `tests/tools/materialize-facts.test.ts` (60 on main) is checked against that contract, and each that expects a fact written, or a name added to an existing person, is inverted or deleted, the PR naming each;
  - `dev/smoke-calls.ts`'s `materialize_facts` row targets the existing P1, so it omits `personId` and still smokes a mint, and the `extraction_append` row before it gains a SMOKE-1 `principal` name assertion for that mint to carry;
  - sets `living: false` when the minting record shows it, so `apps/server/app/feedback.py` and `apps/electron/src/main/feedback.ts` stop redacting run-minted relatives as living.
- **Rule T.** `add_fact`, `add_name`, `add_relationship`, `add_person`'s inline facts, and value changes through `update_fact`, `update_name` and `update_relationship`, refuse a fact, name or edge that is neither an import nor covered by an affirmed claim at `probable` or better (Decision 31's join).
  - The name and gender a minted person carries from its minting record are exempt.
  - A value change to an existing fact, name or edge that is neither an import nor claimed (a legacy link-time object) is admitted and keeps its legacy label (Decision 24).
  - It lands in warn mode and refuses only from Stage 3b, which follows `conclusion-tree-later.md`'s Part 2 (researcher statements): until Part 2 lands, a value the researcher states has no route into the tree.
- **The doctrine is rewritten once, for facts and relationships together**, in:
  - `docs/specs/tree-materialization-spec.md`;
  - `docs/specs/research-schema-spec.md`: "tree.gedcomx.json update timing"; the retired `_inferred` convention; and §4, "Ownership for `tree.gedcomx.json`" (the table, the household-skeleton paragraph, and the `unitCallers` paragraph naming `agent:person-evidence` on `relationships`);
  - `docs/specs/simplified-gedcomx-spec.md`;
  - `docs/specs/research-append-tool-spec.md`;
  - `docs/specs/tree-edit-tool-spec.md`;
  - `docs/specs/match-merge-workflow-spec.md`: §5.0's person-evidence, proof-conclusion and tree-edit rows, and §5.5;
  - `docs/gps-research-flow.md` ("The tree already holds the evidence by this point…");
  - `docs/skill-dataflow.md`: person-evidence's row and diagram node, and the tree `persons` and `relationships` ownership rows;
  - `packages/engine/plugin/skills/record-extraction/SKILL.md`: the household-skeleton sentence;
  - `packages/engine/plugin/agents/tree-edit.md`;
  - `packages/engine/plugin/agents/proof-conclusion.md`;
  - `packages/engine/plugin/agents/record-extractor.md`: intent records are labelled; the pre-1880 rule stays;
  - `eval/tests/unit/tree-edit/rubric.md` ("Evidence grounding") and `eval/tests/unit/proof-conclusion/rubric.md` (the tree-encoding dimension: evidence facts no longer sit on the tree, and the concluded edge is no longer "usually already present"), with the `eval/harness/scripts/check_rubric_tool_drift.py` SUPPRESSIONS quotes these edits remove (`test_every_suppression_quote_is_verbatim`);
  - `README.md`'s `materialize_facts` row.
- **Harness:**
  - `eval/harness/harness/skill_invocation.py`: `owning_skills` attributes edge and fact writes by claim, not to proof-conclusion; `find_effects_without_invocation` and `find_conclusions_without_tree_encoding` read claims; `find_citation_nulling_in_tree_sources` says "concluded" where it says "uploads";
  - `eval/harness/e2e/guardrail_shadow_report.py`'s "uploaded tree source(s)" labels, and `docs/specs/e2e-test-spec.md`'s paragraph on the citation-nulling check, say "concluded";
  - matching rows in `docs/specs/guardrail-enforcement-spec.md`.
- **Unit tests:**
  - `eval/tests/unit/person-evidence/household-skeleton-siblings.json` (`ut_person_evidence_021`) is inverted to "no edges written";
  - `marriage-assertion-links-only-defers-relationship.json` (`_022`) loses its xfail marker, because person-evidence can no longer write edges;
  - `eval/tests/unit/person-evidence/rubric.md` and `eval/harness/validators/test_person_evidence.py` are updated;
  - so is every person-evidence scenario that grades a link-time write.

**What does not change**
- There is no schema change.
- Claim semantics stay as built in Stage 1b.
- `_inferred` assertions already in fixtures stay as legacy data.
- Rule T only warns, so tree-edit's scenarios that add an unclaimed object still pass; they are rewritten in Stage 3b.

**Acceptance check**
- The person-evidence suite passes at `--runs-per-test 3`, with `_014` and `_022` present and passing and no xfail marker left, so rule 10 (`rule10_no_xfail_markers`) is green.
- `tests/tools/materialize-facts.test.ts`: "a minted person carries only a name and gender"; "materialize_facts on an existing person writes nothing and still reports a competing Birth".
- `tests/tools/tree-edit.test.ts`: "add_relationship with no covering claim warns"; "add_fact matching its claim by the join passes"; "a minted person's name needs no claim"; "a value correction to a legacy fact no claim covers passes".
- `tests/utils/conclusion-status.test.ts`: "an import edge whose parent was merged away still reads as an import".
- `tests/packaging/ownership-manifest.test.ts` and `eval/harness/tests/unit/test_ownership_manifest.py` pass, with `agent:person-evidence` paired with `materialize_facts` alone on tree `persons` and named on no other tree row.
- In the skill_invocation tests under `eval/harness/tests/unit/`, an edge written under a claim is not flagged as a proof-conclusion effect with no invocation.

**Rule 10.** PR #3131, which Stage 1b waits on, clears the person-evidence markers first: its run-log check fails rule 10 on all five today (2026-10-07). This stage settles whatever it leaves:
- A test PR #3131 deleted with a restore line is restored from git here when this stage makes it pass, and that restore line is ticked:
  - `_014` (issue #2943's) passes because its live failure, person-evidence minting James through `tree_edit add_person` (`test_stub_person_created_and_linked`), ends when this stage takes `tree_edit` out of person-evidence's `tools:`. Its `xfail_reason` records the scoring defect as already fixed (issue #1731);
  - `_022` passes by construction, since person-evidence no longer writes edges. A restore line for it would sit on issue #3032 and is kept when that body is rewritten.
- A marker still present follows rule 10's route here: `_001` and `_024` (issue #2537) and `_026` (issue #2475), unless their issue has landed first, are deleted with their scenarios and fixtures kept, and each issue's done-when gains "restore `<test id>` from git (deleted in PR #N) and make it pass 3 of 3". `_026`'s line adds "after rewriting its judge context to Stage 3's name-and-gender mints with no edges", since it grades both.
- Nothing PR #3131 kept unmarked is deleted.

The record-extractor edit puts record-extraction under the same rule. Its one marker, `ut_record_extraction_g4k` (`classification-refinement-informant.json`), fails today and its fix is issue #2484's genealogist doctrine, which waits on issue #2937; its `xfail_reason` still names issue #2173, which is closed. Unless issue #2484 lands first, this stage deletes the test with its scenario and MCP fixture kept, and issue #2484's done-when gains "restore `ut_record_extraction_g4k` from git (deleted in PR #N) and make it pass 3 of 3".

**Deferred**
- **Rule T's refusal** → Stage 3b.
- **Issue #2943's `research_append` arm**: independent of this plan, awaiting the lead's refs decision (Decision 15).

### Stage 3b — rule T refuses (paid slot: tree-edit)

**What changes**
- `src/validation/rule-modes.ts` moves rule T from warn to refuse.
- It is its own PR (Decision 25), after `conclusion-tree-later.md`'s Part 2 (researcher statements), which gives a value the researcher states its route into the tree.
- The tree-edit scenarios that add or change a non-import object no claim covers are rewritten to the routes rule T leaves: `add-occupation-fact-with-place.json` (`ut_tree_edit_009`), `couple-marriage-fact-on-relationship.json` (`_013`), `create-sibling-with-parentchild.json` (`_010`), `add-relationship-after-proof.json` (`_002`, whose premise also cites link-time materialization) and `person-merge-stub-into-fs-person.json` (`_006`). `correct-typo-death-date.json` (`_008`) is a legacy value correction, which rule T admits, and stays.
- `dev/smoke-calls.ts`'s `tree_edit add_name` call on P1, which expects `ok: true`, gets a covering name claim seeded (or moves to an operation rule T admits), so `make engine-smoke-stdio` and `make engine-smoke-http`, which no CI job runs, stay green.

**When.** After Part 2 lands and at least 10 e2e runs made on or after Stage 3's merge.

**What does not change.** The rule's text, and every other rule's mode.

**Acceptance check**
- `dev/replay-rule-modes.ts` lists every rule T fire over those runs, and each is read (ADR-0011 limit 2).
- The tree-edit suite passes with the rewritten scenarios, and "a value correction to a legacy fact no claim covers passes" still holds.

**Deferred.** None.

### Stage 4 — the verdict switches to concluded

**What changes**
- `eval/harness/e2e/judge_prompt.md` and `judge.py`:
  - concluded scores true, and a `fact` finding with no `fact_type` (a documented negative) is concluded by a `finding` claim that states it;
  - found but not concluded scores partial;
  - ruled out or doubted counts as correct avoidance.
- The avoid guard reads claims.
- The judge calibration set is relabelled.

**What does not change.** The engine and the plugin.

**Acceptance check**
- Of the relationship findings the judge marks found, and separately of the fact findings that carry a `fact_type`, at least 80% carry a claim (any tier or polarity), across 10 consecutive e2e runs. The Stage 2 metric gives each baseline before the bar binds.
- Judge agreement on the relabelled calibration set holds at its current floor.

## Open for the lead

None.
