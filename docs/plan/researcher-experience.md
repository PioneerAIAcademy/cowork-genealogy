# Plan: Researcher-experience improvements

Cross-cutting improvements to the plugin's user-facing surface: a
per-project researcher profile written into `research.json`, an adaptive
narration mode derived from that profile, a discoverable named-agents
catalog, a contributions on-ramp, an explicit researcher-responsibility
framing, and a small structural cleanup of skill reference docs.

Designed to run identically on **Claude Cowork**, **Claude Code**, and
**Claude Agent SDK** — no host-side persistence, no shared-file loading,
no slash-command argument hints. All state lives in the project folder.

## Goals

- Capture stable researcher context once per project, not per session.
- Make the 23 skills discoverable through a named-agents catalog in the
  README.
- Open the door to community contributions of skills and MCP servers.
- Make the researcher's verification responsibility explicit.
- Eliminate two name-collisions in skill reference docs.
- Adapt skill narration density to researcher experience without adding
  configuration friction or relying on unreliable runtime-context
  conventions.

## Conservative defaults adopted after platform verification

Three Claude conventions were considered and **rejected** as unreliable
across Cowork/Code/Agent SDK:

- **`argument-hint` frontmatter** — supported in Claude Code, OpenClaw,
  and Codex CLI per the docs. Cowork is conspicuously absent from the
  listed platforms. Known YAML bracket-syntax bug in Claude Code. Drop.
- **Relative `../../references/<file>.md` loading from SKILL.md** —
  open Claude Code bug (issue #17741): paths in SKILL.md are not
  resolved relative to the SKILL.md file's location. Reference-file
  loading must be explicit and path-named per step, and even then the
  resolution is unreliable. Drop the shared-references-folder idea.
- **Plugin-level `CLAUDE.md` auto-load** — Anthropic's plugin docs are
  explicit: "a CLAUDE.md file at the plugin root is not loaded as
  project context." Drop.

Everywhere these would have been used, the design falls back to
**inlining state into `research.json`** (the existing project file).
Skills already read `research.json`; adding fields there is the lowest-risk
extension point.

## Out of scope

- `/customize` skill — deferred.
- Scheduled watcher agents — genealogy data changes too slowly.
- Cowork hooks — not a Cowork primitive; skills call validators directly.
- Cross-session profile in `~/.cowork-genealogy/` or
  `~/.claude/plugins/config/` — Cowork sessions are ephemeral; only the
  project folder persists.
- A standalone `cold-start-interview` skill or `/cold-start` slash command
  — folded into `init-project`.
- A `plugin/references/` shared-doc folder — relative-path loading is
  unreliable.
- `argument-hint` declarations — unverified in Cowork.
- Blanket `allowed-tools` declarations on every skill.
- GEDCOM software / DNA / living-person / brick-walls in the interview.
- Backwards compatibility for existing `research.json` files — out of
  scope per user direction. New projects get the profile; older projects
  without the section run with default narration until manually updated.
- Telemetry / feature-effectiveness measurement — handled out-of-band by
  a separate opt-in tool that copies `research.json` and
  `tree.gedcomx.json` to a central server at the user's request.

## Vocabulary

- **Researcher profile** — a `researcher_profile` section in
  `research.json` capturing per-project context (experience level,
  subscriptions, derived narration guidance). Written by `init-project`,
  read by all other skills.
- **Narration guidance** — concrete instruction text written into the
  profile at init-project time, derived from the researcher's experience
  level. Skills read and follow this text directly; the mapping logic
  lives in one place (init-project), not in each skill.
- **Named-agents catalog** — a README table mapping job-titled
  capability names to the underlying skill. A discovery surface, not a
  slash-command catalog.

---

## Phase 1 — README + structural cleanup (independent, parallelizable)

Four workstreams. None blocks the others. Each shippable as its own
small PR.

### 1A. Description amendments (13 skills)

For each skill whose `description` doesn't already mention the artifact
it produces, amend the description to name the artifact. The description
is Claude's routing signal — strengthening it where production info is
implicit improves routing.

Skills whose description already names the artifact (no change):
init-project, record-extraction, citation, proof-conclusion,
hypothesis-tracking, tree-edit, validate-schema, wiki-lookup,
person-evidence, conflict-resolution.

Skills to amend: assertion-classification, check-warnings, convert-dates,
historical-context, locality-guide, project-status, question-selection,
research-plan, search-external-sites, search-full-text, search-records,
timeline, translation.

Verification: invoke each amended skill from natural-language prompts
that previously routed correctly; confirm routing still fires.

### 1B. Name-collision renames

Rename the two file-name collisions in skill `references/` folders so a
future contributor doesn't mistake them for shared content:

- `locality-guide/references/broad-context-factors.md` →
  `locality-guide/references/locality-broad-context.md`
- `historical-context/references/broad-context-factors.md` →
  `historical-context/references/historical-broad-context.md`
- `question-selection/references/exhaustiveness-evaluation.md` →
  `question-selection/references/question-exhaustiveness.md`
- `project-status/references/exhaustiveness-evaluation.md` →
  `project-status/references/project-exhaustiveness.md`

Update the 4 SKILL.md files that link to these.

**Not in scope:** lifting `validation-protocol.md` (15 duplicate copies)
or `research-log-protocol.md` (4 duplicate copies) to a shared location.
Relative-path resolution from SKILL.md is unreliable. The duplicates stay
duplicated. Acceptable cost: when one of these shared protocols changes,
all copies need a coordinated edit. Mitigation: a one-time `grep` confirms
they remain identical.

Verification: open each renamed file's referrer SKILL.md, confirm new
filename appears in the reference list, confirm Claude can still load it
when the skill is invoked.

### 1C. Named-agents catalog in README

Replace the flat skill list with a "Named Agents" table. **Capabilities
catalog, not a command catalog** — most skills are description-triggered.

| Agent | What it does | Skill |
|---|---|---|
| Question Finder | Picks the next research question from project state | `question-selection` |
| Research Planner | Sequences which record sets to search and where | `research-plan` |
| Locality Researcher | Surveys what records exist for a place and time | `locality-guide` |
| Record Extractor | Pulls atomic assertions from a record | `record-extraction` |
| Evidence Classifier | Refines GPS three-layer classifications | `assertion-classification` |
| Citation Polisher | Formats sources to Evidence Explained | `citation` |
| Identity Resolver | Decides whether a record's subject matches a tree person | `person-evidence` |
| Conflict Resolver | Resolves contradictory evidence with rationale | `conflict-resolution` |
| Hypothesis Tracker | Manages competing identity/parentage hypotheses | `hypothesis-tracking` |
| Timeline Builder | Builds chronologies and flags impossibilities | `timeline` |
| Warning Checker | Flags impossible dates, ages, sequences | `check-warnings` |
| Date Converter | Julian/Gregorian, Old/New Style, double-dating | `convert-dates` |
| Translator | Genealogy-specific translation and paleography | `translation` |
| Historical Contextualizer | Boundary changes, naming conventions, era context | `historical-context` |
| Proof Writer | Drafts GPS-conformant proof conclusions | `proof-conclusion` |
| Tree Editor | Direct edits, merges, and corrections to the tree | `tree-edit` |
| Schema Validator | Validates project files against schemas | `validate-schema` |
| Project Starter | Creates `research.json` and `tree.gedcomx.json` for a new project | `init-project` |
| Status Reporter | Reports where the research stands and what's next | `project-status` |
| FamilySearch Searcher | Indexed search of FamilySearch records | `search-records` |
| FAN-Club Searcher | Full-text search surfacing witnesses, neighbors, sureties | `search-full-text` |
| Paid-Site Capturer | Search URL generation + capture workflow for Ancestry, MyHeritage, FindMyPast, FindAGrave, Newspapers.com | `search-external-sites` |

22 rows. `wiki-lookup` is intentionally **not** promoted to a named agent
— it's the simplified reference example, listed elsewhere in the README
under "skills" but not part of the capability catalog researchers should
think in terms of.

Verification: render the README; spot-check that capability names read
as job titles to a new contributor.

### 1D. README — CONTRIBUTIONS section + researcher-responsibility framing

No existing CONTRIBUTING.md (verified). Two additions to README.

**Researcher-responsibility note**, near the top of the README, before
the tool list:

> These tools assist your research; they do not replace it. Every record
> returned, every match suggested, every conflict resolution is a starting
> point for you to verify against original sources. The Genealogical Proof
> Standard requires the researcher — not the tool — to weigh evidence,
> resolve conflicts, and reach conclusions. Outputs from this plugin are
> working drafts in your research process, not citable conclusions.

**CONTRIBUTIONS section**, ~400 words, mirroring legal's CONNECTORS.md
depth. Three subsections:

1. **Skill contributions** (common case). Locality guides, specialized
   record-type extractors, language-specific paleography helpers,
   regional research-tip references. Include:
   - **Architecture rule** — skills run inside the Cowork VM with **no
     network access**. Anything that needs the network has to live in
     the MCP server. Reference the existing CLAUDE.md architecture
     section.
   - **Template guidance** — start from `wiki-lookup/` as the simplified
     reference example for minimal frontmatter; consult `citation/` or
     `record-extraction/` for the richer positive-trigger +
     negative-guard description pattern.
   - **Extensibility** — the `researcher_profile` section of
     `research.json` is extensible; a skill contribution can add a new
     field (e.g., `dna_companies` for a DNA-specialty skill) by
     proposing the schema extension in the PR.
   - **Submission steps** — fork, add skill, write the SKILL.md, write
     a testing-guide stub under `docs/testing-guides/`, open a PR.

2. **MCP server contributions** (rare). Criteria borrowed from legal's
   CONNECTORS.md: read-heavy tools, provenance in results, no
   instruction-like content in results, graceful error degradation. List
   wanted MCPs framed as "sites where an MCP server would replace the
   current click-capture workflow with automated retrieval" — FindAGrave,
   GenealogyBank, Newspapers.com, MyHeritage, FindMyPast. Mention that
   none of these currently expose public APIs, so contributions might be
   scraping-MCPs or vendor-built MCPs.

3. **How to submit** — fork, PR, what tests/verification we'll run, how
   we decide between landing in the default `.mcp.json` vs. documenting
   in the README for users to add themselves.

Verification: render the README; confirm the architecture-rule sentence
is unambiguous; confirm the wanted-list is framed as an invitation, not
a gripe.

---

## Phase 2 — Researcher profile in `research.json`

After Phase 1's description amendments so the `init-project` description
matches the established pattern. This phase is small (one skill
enhancement + one schema change + one doc update).

### 2A. Schema extension — `researcher_profile` in `research.json`

Add to the research.json schema (wherever it's defined — likely
`docs/specs/research-json-schema.md` or similar):

```json
{
  "researcher_profile": {
    "experience_level": "novice | intermediate | experienced | professional",
    "subscriptions": ["Ancestry", "MyHeritage", "FindMyPast", "Newspapers.com", "GenealogyBank", "FindAGrave-Plus", "other", "none"],
    "narration_guidance": "<text — concrete instructions for skill verbosity, written at init-project time>"
  },
  "questions": [...],
  ...
}
```

**Narration guidance text** (written by init-project per the level
selected — the mapping lives in one place, this skill):

| Experience level | `narration_guidance` text stored in `research.json` |
|---|---|
| novice | "Narrate the *why* before each action. Define genealogy terms inline when first introduced. Explain which GPS step you are executing and what it produces. Err on the side of more context — the user is learning." |
| intermediate | "One-line preamble per skill invocation explaining what you're about to do. Assume basic GPS vocabulary. Define unusual or specialized terminology inline." |
| experienced | "No preambles. Do the work and report results concisely. Assume fluency with GPS and standard genealogy terminology." |
| professional | "No preambles. Do the work and report results concisely. Assume fluency with GPS, BCG standards, and standard genealogy terminology." |

`subscriptions: ["none"]` is a valid answer for novice users who haven't
subscribed to anything.

**Subscription normalization (write-time):** `init-project` normalizes
user inputs to the canonical enum values before writing — case-folding,
trimming whitespace, deduping, and matching common aliases ("Ancestry.com"
→ "Ancestry", "ancestry" → "Ancestry"). Stored values always match the
enum exactly so downstream skills can do straight equality lookups.
Unrecognized inputs land under `"other"` and the user is shown the
normalization result for confirmation.

**Schema validation:** update `validate-schema` skill to know about the
new section. Optional fields, so omission is not an error; presence is
validated against the enum for `experience_level` and the set for
`subscriptions`.

### 2B. `init-project` enhancement

When `init-project` runs:

1. If a `research.json` already exists with a populated
   `researcher_profile`, skip the interview.
2. Otherwise (fresh project, or existing research.json with no profile),
   ask the two questions:
   - **Q1.** "How would you describe your genealogy experience? (a) just
     starting out, (b) some research under my belt, (c) experienced,
     (d) professional/certified."
   - **Q2.** "Which paid genealogy subscriptions do you have? (multi-select
     from: Ancestry, MyHeritage, FindMyPast, Newspapers.com, GenealogyBank,
     FindAGrave-Plus, other, none)"
3. Map experience level to narration guidance per the table in 2A.
4. Write the `researcher_profile` section to `research.json` alongside
   the rest of the project state.
5. Continue with the existing init-project flow.

Total interview time: ~30 seconds. Asked once per project, not per
session.

**Profile updates mid-project:** the user can edit `research.json`
directly to update the profile (rare event — buying a new subscription).
No special update flow needed. Document this in the README.

### 2C. README documentation

- Add a brief "Researcher profile" subsection near "Getting started"
  explaining that `init-project` asks two questions once per project, the
  answers are stored in `research.json`, and they can be edited there if
  the user's situation changes.

### Phase 2 verification

End-to-end on Cowork, Claude Code, and Agent SDK:

- From an empty folder, invoke `init-project` with a FamilySearch person
  ID. Confirm the two questions are asked, answers stored in
  `research.json`, `narration_guidance` derived correctly.
- Re-invoke `init-project` on the same folder. Confirm the interview is
  skipped.
- Manually delete the `researcher_profile` section. Re-invoke
  `init-project`. Confirm the interview re-fires.
- Manually edit `experience_level` from `novice` to `experienced`.
  Confirm subsequent skill runs adapt narration (covered in Phase 3
  verification).

---

## Phase 3 — Narration propagation across skills

After Phase 2. Touches every skill, so worth doing once carefully.

### 3A. SKILL.md narration wiring (23 skills)

Add one line near the top of each SKILL.md body (not the frontmatter):

> **Before responding, read `researcher_profile.narration_guidance` from
> `research.json` and follow it as your narration style for this
> invocation. If the section is missing, default to a one-line preamble
> per action.**

**Exception:** `wiki-lookup` keeps its body minimal as the simplified
reference example, but still gets the line — the architectural rule that
all skills respect the profile applies even to the simplest skill. New
contributors copying wiki-lookup as a template should inherit this
behavior.

This is the same one-line addition across 23 files. Mechanical.

**Knowledge skills still read the profile.** `convert-dates`,
`translation`, and `historical-context` operate on user input without
otherwise touching `research.json`. They still get the narration line —
consistency across all skills beats the minor overhead of one extra
file-read per invocation. No per-skill exception list.

### 3B. Document the session override

In `init-project/SKILL.md` (after the interview) and in the README,
document that natural-language mid-session overrides — "be more verbose",
"skip the explanations", "explain that step", etc. — apply for the
current session without modifying `research.json`. No code change needed;
Claude handles overrides naturally. The documentation just names the
supported phrases so users know they're supported.

### 3C. Search-external-sites uses subscriptions

Bonus integration: update `search-external-sites/SKILL.md` to read
`researcher_profile.subscriptions` and prioritize URLs for subscribed
sites. Optionally de-emphasize or skip unsubscribed sites (the click-and-
capture workflow doesn't require a subscription, but a subscribed user
gets faster results). This is the first concrete use of the
`subscriptions` field — proves the schema is load-bearing rather than
decorative.

### Phase 3 verification

Spot-check: with one test input ("extract the facts from this record"),
run `record-extraction` against `research.json` files where
`experience_level` is set to each of `novice` / `intermediate` /
`experienced` / `professional`. Confirm narration density visibly differs
across the four runs. Repeat for `proof-conclusion` and
`question-selection` to catch skills that ignore the narration
instruction.

For 3C: invoke `search-external-sites` with `subscriptions: ["Ancestry"]`
vs. `subscriptions: ["MyHeritage"]`. Confirm the generated URL list
prioritizes the subscribed site.

---

## Phase 4 — Example projects (external)

Senior researchers contribute example projects to an `examples/`
directory. Each:

- A real research project scoped to a **single research question**
  (not an entire family tree), with `research.json` and
  `tree.gedcomx.json` at a meaningful end-state (typically a
  proof conclusion).
- A short `README.md` explaining the research question, what's notable
  about how it was answered, and which skills produced what artifacts.
- A `researcher_profile` consistent with the contributor's actual
  experience level (so the example demonstrates the appropriate
  narration mode in the captured assertions and notes).

**Privacy note** in `examples/README.md`: verify no living individuals
are identifiable in the audit trail. Obtain consent from any living
relatives whose data appears (correspondence quoted, etc.). The GPS
standard already requires this; the README makes it explicit.

**Bundling decision:** examples live in `examples/` at repo root,
**not** bundled into the `.mcpb` or `plugin.zip` artifacts. They're
documentation and reference material; bundling them bloats every release
for users who won't read them. README links to the directory in the
GitHub repo.

Doesn't gate any other phase. Can land any time after Phase 1.

---

## `wiki-lookup` policy

`CLAUDE.md` designates `wiki-lookup` as the simplified working reference
example for new contributors. **Do not upgrade its frontmatter** to the
rich positive-trigger + negative-guard pattern the other 22 skills use —
doing so would defeat its role as a copy-from template.

Add one comment-line in wiki-lookup's SKILL.md noting its role:

> *(This skill is intentionally minimal — it's the simplified reference
> example for new contributors. For the richer pattern with positive
> triggers and negative guards, see `citation/SKILL.md` or
> `record-extraction/SKILL.md`.)*

Phase 3A's narration line still applies (every skill respects the
profile, even the minimal one).

---

## Project-root CLAUDE.md update

After Phase 2 lands, update the project-root `CLAUDE.md` to document:

- The `researcher_profile` section of `research.json` and its purpose.
- The convention that all skills read `narration_guidance` from the
  profile.
- The architecture rule reinforced: shared state lives in the project
  folder (`research.json`), not in home-directory paths or in
  plugin-level files that don't auto-load.

Roughly 50–100 words of additions. Lands with the Phase 2 PR.

---

## Ordering and sizing

| Phase | Effort | Dependencies |
|---|---|---|
| 1A description amendments (13 skills) | 0.5d | none |
| 1B name-collision renames + 4 SKILL.md updates | 0.25d | none |
| 1C named-agents catalog in README | 0.5d | none |
| 1D README CONTRIBUTIONS + framing | 0.75d | none |
| 2A schema extension + validate-schema update | 0.5d | none |
| 2B init-project enhancement | 0.5d | 1A (description pattern) |
| 2C README researcher-profile docs | 0.25d | 2A, 2B |
| 3A 23 SKILL.md narration line + wiki-lookup comment | 1d | 2A |
| 3B session override docs | 0.25d | 3A |
| 3C search-external-sites subscriptions integration | 0.25d | 2A |
| 4 example projects | external | Phase 2 |

Total: roughly **4 working days**, ship in 4–5 PRs.

**Recommended PR sequencing:**

1. **PR-1** — Phase 1A + 1B bundled (SKILL.md description amendments +
   reference renames). Pure plugin/skills/ edits.
2. **PR-2** — Phase 1C + 1D bundled (README named-agents catalog +
   CONTRIBUTIONS + researcher-responsibility framing). Pure README edits.
3. **PR-3** — Phase 2A + 2B + 2C bundled (schema extension +
   init-project enhancement + project-root CLAUDE.md update + README
   docs). Implements the profile.
4. **PR-4** — Phase 3A + 3B + 3C bundled (23 SKILL.md narration line +
   session-override docs + search-external-sites integration). The
   narration propagation.
5. **PR-N** — Phase 4 example projects (whenever senior researchers
   contribute, independent).
