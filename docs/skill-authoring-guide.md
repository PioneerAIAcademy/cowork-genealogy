# Skill authoring guide — how to write a good SKILL.md

This is the prose standard for the genealogy skills in
`packages/engine/plugin/skills/*/`. It covers **how to write the
instructions** — structure, the description, voice, examples — plus the
handful of architecture facts you need to make the right calls. You don't
need to read anything else to write a good skill; deeper rationale is in
the doc index at the end.

Two other things write toward this guide, so keep it current:

- The `cowork-skill-builder` agent (`.claude/agents/`) scaffolds a new
  skill — point it here for body style and frontmatter limits.
- The skill-improver loop (see [`docs/skill-lifecycle.md`](skill-lifecycle.md))
  proposes edits to existing skills and is told to write toward this
  standard.

## What kind of skill are you writing?

Three kinds, and it changes how you write it:

- **Workflow skill** — triggered by a user request (most skills). It maps
  to a step in the research process and reads from and writes to the two
  project files, `research.json` and `tree.gedcomx.json`.
- **Reference document** — not triggered on its own. It's a rules doc
  (like the research-log protocol) that several skills must follow
  identically, so a copy lives in each of their `references/` folders.
- **Guardrail** — enforces a check, e.g. schema validity. Cowork has no
  automatic post-write hooks, so a guardrail runs only because a writing
  skill's prose tells Claude to: "After writing to research.json, invoke
  validate-schema."

**Skills never call each other.** There is no programmatic skill-to-skill
invocation in Cowork — orchestration is Claude reading the skill
descriptions and the current file state and deciding what to do next. If
skill A produces something skill B needs, A leaves it in `research.json` /
`tree.gedcomx.json` (or in Claude's context within the session), and B's
*description* is what tells Claude when to fire.

---

## 1. Anatomy

A skill is a directory under `packages/engine/plugin/skills/<name>/`:

```
<name>/
├── SKILL.md          (required) YAML frontmatter + markdown instructions
├── references/       (optional) docs loaded on demand
├── templates/        (optional) markdown files the skill fills in
└── scripts/          (optional) Python (stdlib only) for deterministic work
```

Frontmatter requires `name` and `description`. `model:` pins a model
for the harness; `allowed-tools:` lists the MCP tools the skill may
call (the eval harness enforces this allowlist — anything not listed is
blocked during tests).

## 2. Progressive disclosure — and the no-shared-references rule

Skills load in three levels. Keep cheap things resident and push depth
behind pointers:

1. **`name` + `description`** — always in the orchestrator's context for
   every session. Treat this as a scarce budget (see §3).
2. **SKILL.md body** — loaded whenever the skill triggers. Aim **under
   ~500 lines**. If you're approaching that, add a layer of hierarchy
   and point to a `references/` file rather than inlining everything.
3. **`references/`, `templates/`, `scripts/`** — loaded or executed only
   when the body tells the model to.

When you reference a file, say **when** to read it. For a reference over
~300 lines, give it a table of contents.

**The adaptation you must respect:** Claude Code can't reliably resolve
a shared reference path across skills (issue #17741), so shared guidance
is **duplicated into each skill's own `references/`, never linked to a
single shared copy.** The skill-creator advice to "factor shared
guidance into one file" does *not* apply here — if two skills need the
same rule, both carry their own copy, and "update the shared guidance"
means editing every copy. (This is also why there is no plugin-level
`CLAUDE.md`: it wouldn't be auto-loaded.)

## 3. The description is the trigger — write it deliberately

Cowork's orchestrator decides whether to invoke a skill from its
`name` + `description` alone. So:

- **Put all "when to use" information in the description**, not the body.
  Name the phrasings and contexts that should activate it — including
  ones where the user doesn't say the skill's name. Claude tends to
  *under*-trigger, so lean slightly pushy.
- **Name the confusable skills in a "Do NOT use when …" clause.** List
  the skills this one should defer to (for example, a Wikipedia-lookup
  skill defers to search-familysearch-wiki, locality-guide, and
  historical-context). Every such clause is also a free source of negative
  tests (see the lifecycle doc).
- **Stay within 1024 characters.** Not because a packager rejects longer
  — because every skill's description is *always resident* and the ~28
  descriptions compete for the orchestrator's attention on every turn. A
  tight description triggers more precisely than a rambling one. If you
  can't fit it, the skill is probably doing too much. (Trim over-long
  descriptions through the description optimizer, not by eye — see the
  lifecycle doc — because blind cuts drop activations.)
- **Avoid angle brackets in the description.** Write "before 1850," not
  "`<1850`"; `<…>` can collide with prompt scaffolding. In the body,
  `<1850` is fine.

## 4. Repo conventions every SKILL.md follows

- **Open with the Narration line.** Every skill starts with:
  `**Narration:** Read research.json's researcher_profile.narration_guidance
  and apply it as your narration style for this invocation.` Copy it
  verbatim from an existing skill.
- **End with `## Re-invocation behavior`.** State what the skill
  **Writes**, what happens **On repeat invocation**, and a **Do not
  duplicate** rule.
- **Network code never lives in a skill.** Skills run in the Cowork VM
  with no reliable egress. Anything that hits the network is an MCP tool
  on the host; the skill calls it. If you find yourself wanting `fetch`
  in a skill, you want an MCP tool instead.
- **Bundled scripts are Python, standard library only.** They run in the
  VM; no `pip` deps, no network. Move deterministic, repetitive work
  (date math, GEDCOM munging, formatting) into a `scripts/` helper
  rather than re-deriving it in prose on every run — and put it in *this*
  skill's `scripts/`, not a shared location.
- **Mind the casing seam.** MCP tool parameters are camelCase
  (`personId`, `birthPlace`); the persisted documents the skill edits —
  `research.json`, `tree.gedcomx.json` — are snake_case (`assertion_id`,
  `couple_relationship`). Keep each on its own side.
- **No skill invokes another skill.** Orchestration is Claude reading
  descriptions and file state. If skill A produces data B needs, A leaves
  it in `research.json`/`tree.gedcomx.json` (or Claude's context), and
  B's description tells Claude when to fire. A guardrail like
  validate-schema is invoked by a prose instruction in the writing
  skill, not a programmatic call.

## 5. Writing style

- **Imperative voice.** "Call `record_search` with the plan item's
  parameters," not "the skill should call…".
- **Explain the why; treat all-caps MUSTs as a yellow flag.** Today's
  models follow reasoning better than rote commands, and a "why"
  generalizes to cases your examples didn't cover. If you're reaching for
  `ALWAYS`/`NEVER`, reframe it as the reason the rule matters. Reserve
  hard mandates for genuine invariants (schema conformance, the research
  log protocol).
- **Define fixed output shapes with a template.** If the output has a
  required structure, show the literal skeleton (a `templates/` file or
  an inline block) for the model to fill in.
- **Show worked examples.** A concrete input→output pair teaches the
  mapping better than description — include a short "Example" section
  showing one full interaction.
- **Keep it general, not overfit.** You'll often write a skill against a
  few example records. Resist tuning the prose to those specific cases —
  a skill that only works for the Flynn scenario is useless. State the
  principle; let the model apply it.
- **Draft, then read it cold.** Write a first version, then re-read it
  against this guide with fresh eyes — is it lean, are the MUSTs
  justified, did the body stay under 500 lines? This pass is cheap and
  catches the most.

## 6. Lack of surprise

A skill's behavior must not surprise a user who read its description. No
hidden side effects, no data exfiltration, no network code smuggled past
the VM boundary. If a proposed skill's intent and its contents diverge,
fix the divergence before shipping.

---

## Checklist before you commit

- [ ] `description` ≤ 1024 chars, no angle brackets, names the
      confusable skills it defers to.
- [ ] Opens with the `**Narration:**` line; ends with
      `## Re-invocation behavior`.
- [ ] Body under ~500 lines; depth pushed into this skill's own
      `references/`.
- [ ] No network code; any bundled script is Python stdlib only.
- [ ] camelCase tool params, snake_case persisted fields.
- [ ] MUSTs are real invariants; everything else explains its why.
- [ ] Has unit tests under `eval/tests/unit/<name>/` (see the lifecycle
      doc for the test taxonomy and holdout convention).

## Doc index

- [`docs/skill-lifecycle.md`](skill-lifecycle.md) — the full create → test
  → improve flow this guide is step 1 of.
- [`docs/specs/skill-architecture-spec.md`](specs/skill-architecture-spec.md)
  — the architecture rationale behind the skill kinds and the file-handoff
  model. You don't need it to write a skill; read it only if you're curious
  or changing the architecture itself.
- [`docs/specs/research-schema-spec.md`](specs/research-schema-spec.md) —
  only if you're adding a new `research.json` / GedcomX field: that's a
  three-place change (the schema JSON + the prose table + the
  `validate_research_schema` validator), not something a skill does alone.
