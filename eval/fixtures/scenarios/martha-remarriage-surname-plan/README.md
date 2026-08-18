# Scenario: martha-remarriage-surname-plan

The state immediately before `research-plan` writes the plan for a
parentage question whose only parentage-adjacent lead is a marriage
record's bride surname — for a subject independently known to have
remarried more than once. No plan for q_002 yet.

- **Subject:** Martha J (`I2`), mother of Jimmie Jewel Neal (`I1`). q_001
  (resolved, probable) established that Martha used at least three married
  surnames across her life: "Landham" (a widow's styling at her 1879
  marriage to James M Neal — a prior marriage, name unconfirmed), "Neal"
  (from that 1879 marriage, Jimmie's father), and "Hamby" (an 1888
  marriage, after Neal).
- **q_002** (`open`): "Who were the parents of Martha J...?" The
  rationale surfaces the ONLY two parentage-adjacent leads found so far:
  (a) a marriage record showing a bride named "M J Wood" marrying "W F
  Lanham" on 7 Jan 1869 in Smith County, Texas — the earliest marriage
  record found for her, its status as her *first* marriage unconfirmed —
  and (b) a pre-existing, uncorroborated FamilySearch tree source placing
  an "M M Wood" household in the 1860 Blount County, Alabama census,
  matching her birth year and birthplace.
- `plans` is empty — research-plan should create the first plan for q_002
  (Add-new path).
- `localities` already has an entry for Blount County, Alabama (loc_001)
  so the "no localities entry" stop condition doesn't apply — and, true to
  the real case this is drawn from, that guide's own `quirks`/tips are
  themselves keyed to the "Wood" surname (per the real locality survey),
  so a research-plan run has to resist that framing too, not just the
  tree source.

The point of this scenario: a marriage record's bride surname is the birth
surname only if that marriage was the woman's first, and that is usually
unknowable until every marriage has been found. A sound plan for q_002
does not stake the parentage search on a census household search keyed to
"Wood" as if it were confirmed — it plans for records that name Martha's
parents directly (further/earlier marriage records under other names,
probate/estate records, church records, a sibling's record) and, if it
plans the Wood-household census check at all, treats it as a secondary,
explicitly caveated lead rather than the primary strategy.

Derived from the real `jimmie-jewel-neal` e2e fixture (issue #1472, Rule
3 — the compiled tree's uncorroborated "Wood/Ford" grandparent claim). Six
committed runs of that fixture (2026-07-24 through 2026-07-31) all
eventually attached the wrong grandparents on this exact trap; this
scenario carves the state immediately before the specific `research-plan`
invocation (run `2026-07-30_14-32-18`, `Skill("research-plan", "q_002
--autonomous")`) that planned an 1860 "M M Wood" household census search
as `pli_001`, its highest-priority item, based solely on the uncorroborated
tree source. Real names/dates kept per the recorded-e2e exception (deceased,
public fixture) — the subject's own identifiers are what the finding turns
on, not incidental PII. No third parties beyond the ones the real fixture
already exposes are named here.

**First-cut caveat:** this carve keeps the marriage-record and tree-source
leads verbatim from the real run, but does not attempt to replicate every
assertion from the six real runs (40+ nodes across them) — only the
minimum research.json/tree state a research-plan invocation actually
needs to reason about the trap. Verify in the CRUD UI that this is still
enough context for the judge to grade the plan fairly.
