# Content-advisory / CARE doctrine for sensitive findings — plan

> **Status:** Proposed — not started. Authored 2026-07-24 from a review of
> `DigitalArchivst/Open-Genealogy` (external repo, cloned and read directly).
> No implementation branch yet.
> **Goal:** give `proof-conclusion` (the actual disclosure point) and
> `person-evidence` (the skill most likely to first surface a sensitive
> discovery) explicit doctrine for handling findings like unknown
> parentage, institutionalization, criminal records, traumatic deaths, or
> records implicating Indigenous data sovereignty — content-warning-first,
> gradual disclosure, rather than detail-first.

## 1. Why (verified, not assumed)

Grepped `packages/engine/plugin/` and `docs/` for "Indigenous" / "CARE
principle" / "content advisor" / "sensitiv(e|ity) (disclos|content)" —
**zero hits**. This project has no doctrine at all for handling a sensitive
finding once discovered.

Open-Genealogy's `skills/gra/SKILL.md` §5 states it directly: respect
Indigenous data sovereignty (CARE — Collective Benefit, Authority to
Control, Responsibility, Ethics — spelled out in its
`companion-reference.md` Appendix A) and diverse family structures; handle
historical-trauma records (colonial framing, institutionalization, criminal
records, traumatic deaths) with care, centering the subjects rather than a
colonial lens; disclose sensitive findings gradually — a content
note/summary before the detailed account, not detail-first.

This project ingests FamilySearch's global record corpus — mission and
residential-school records, colonial administrative records, court and
asylum records, and more — so the concern is concrete, not hypothetical,
for a tool with this reach.

The two skills where this actually matters:

- **`proof-conclusion`** (`packages/engine/plugin/skills/proof-conclusion/SKILL.md`)
  is where the user-facing narrative gets written — the actual disclosure
  point. "### 4. Write the narrative markdown" (line 110) is the natural
  hook.
- **`person-evidence`** (`packages/engine/plugin/skills/person-evidence/SKILL.md`)
  is the skill that resolves identity and links assertions to persons —
  the point where an unknown-parentage or similarly sensitive
  family-structure discovery first surfaces, often as an unremarkable `pe_`
  entry with nothing flagging it forward.

## 2. Design

Prose-only, in our own words. Open-Genealogy's repo defaults to CC
BY-NC-SA — the CARE acronym and its four terms are a citable, general
framework (not their expression) and are safe to name directly; their
SKILL.md sentences are not ours to copy.

- **`proof-conclusion/SKILL.md`**, "### 4. Write the narrative markdown" —
  add a short paragraph: when the narrative discloses a sensitive finding
  (unknown/non-paternity, institutionalization, a criminal record, a
  traumatic death, or a record implicating Indigenous data sovereignty or
  colonial-era harm), lead with a brief content note and summary before the
  detailed account. One sentence naming CARE for records research
  clearly touches Indigenous communities' data.
- **`person-evidence/SKILL.md`**, near "## Edge cases and decision rules"
  (line 553) or "## Important rules" (line 578) — a shorter note: when a
  match/link surfaces an unknown-parentage or similarly sensitive
  family-structure discovery, flag it explicitly rather than folding it
  silently into a routine `pe_` entry, so it reaches `proof-conclusion`'s
  disclosure discipline instead of surfacing to the user for the first time
  buried in an ordinary link summary.

## 3. Changes by area

- `packages/engine/plugin/skills/proof-conclusion/SKILL.md`
- `packages/engine/plugin/skills/person-evidence/SKILL.md`

## 4. Decisions

1. **Whether `historical-context` also needs this** — *(proposed: no for
   v1. Its job is factual historical background, not disclosure of a
   specific person's sensitive finding — a different concern; don't
   conflate them.)*
2. **Whether this needs an eval fixture** — *(proposed: yes eventually, but
   defer. "Handled a sensitive disclosure with care" is judge-graded prose
   quality, harder to pin down with MUST/MUST-NOT criteria than the
   injection-defense case in the companion plan. Treat as a stretch goal,
   not a blocker for landing the prose change — write the fixture once a
   genealogist can point at a real disclosure and say concretely what
   "handled with care" looked like.)*

## 5. Sequencing

1. `proof-conclusion` doctrine (the actual disclosure point — highest
   value on its own).
2. `person-evidence` flag-forward note.
3. (stretch) eval fixture, once §4.2 has a concrete example to grade against.
