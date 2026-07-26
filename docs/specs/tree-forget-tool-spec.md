# `tree_forget` — strip known information from the tree — Spec

> **Status:** New (2026-07-23). Replaces the `forget-and-rederive` skill's
> bundled `scripts/forget.py`, which was deleted in the same change. Behavior
> is a port, not a redesign: same selectors, same cascade, same redacted
> reporting. What moves is *where it runs* — host-side, behind a tool call,
> instead of a Python script the agent had to locate on the VM filesystem.

```
tree_forget({ projectPath, forget, dryRun }) -> redacted counts (writes tree.gedcomx.json)
```

---

## 1. Why this exists

A researcher who wants to know whether the agent can actually *do* the research
seeds a project from a well-documented FamilySearch person — at which point the
answer is already sitting in the local tree and "research" degrades to reading
it back. The `forget-and-rederive` skill removes a chosen slice of that tree so
the question becomes real again.

That removal shipped as `packages/engine/plugin/skills/forget-and-rederive/scripts/forget.py`
and was invoked from SKILL.md as `python3 scripts/forget.py …` — a **bare
relative path**. The agent's cwd in Cowork is the *project* folder; the script
lives in the *installed plugin* folder. The first Bash call therefore failed
with ENOENT and the agent had to hunt the VM filesystem for the script before it
could even dry-run — with `allowed-tools: Bash, Read` there was no Glob or Grep,
so the hunt ran through `find`. That is the bulk of the "forget takes forever in
Cowork" reports.

Two properties made it a bad fit for a skill script in the first place:

- **The path problem is structural.** It was the only script-bearing skill in
  the plugin, so there was no house convention for spelling the invocation, and
  no packaging test to catch the miss. Skill-relative path resolution is already
  documented as unreliable (issue #17741) — that is why shared `references/` are
  duplicated per skill rather than linked.
- **Step 1 forced a full tree read.** To turn "his parents" into
  `parents-of:<person_id>` the agent had to `Read tree.gedcomx.json` — tens of
  thousands of tokens, and the read is what the structured tools exist to
  remove (`project_context` §1). A host-side tool takes the ids and never puts
  the document in context at all.

Neither is fixed by editing prose. Both disappear when the removal is a tool
call.

### 1.1 Why it is a separate tool from `tree_correct`

`tree_correct`'s `remove` op deliberately **never deletes a person** — that
restriction is load-bearing (`tree-edit-tool-spec.md` § "The tree_edit /
tree_correct split"): a context granted only the correction tool must be
structurally unable to delete evidence. `tree_forget` does delete persons, and
cascades their relationships. Folding it into `tree_correct` would hand every
correction context that power. It stays a distinct, separately grantable tool
whose whole purpose is destructive, and which no research skill calls.

## 2. The tool

```typescript
tree_forget({
  projectPath: string,
  forget: ForgetSelector[],
  dryRun?: boolean,
})
```

Writes **only** `tree.gedcomx.json` (plus the restore file, §5). Never touches
`research.json`, the log, or the `results/` sidecars.

### 2.1 Selectors

`forget` is a non-empty array. Each entry is `{ selector, ...fields }`, mirroring
the `{ operation, ...fields }` shape `tree_edit` takes:

| `selector` | Required field(s) | Removes |
|---|---|---|
| `parents-of` | `personId` | the person's parents, and the ParentChild links to them |
| `children-of` | `personId` | the person's children, and the ParentChild links to them |
| `spouses-of` | `personId` | the person's spouses, and the couple relationships |
| `birth-of` | `personId` | that person's Birth facts |
| `death-of` | `personId` | that person's Death facts |
| `facts-of` | `personId`, `factType` | that person's facts of one type (e.g. `Marriage`); `factType` matches case-insensitively |
| `person` | `personId` | one person, cascading every relationship touching them |
| `fact` | `factId` | one specific fact, wherever it lives (person or Couple relationship) |
| `relationship` | `relationshipId` | one specific relationship |

Selection is **structural, never by name**. The caller passes ids; the tool
walks the tree's own relationships to resolve relatives. The caller never has to
read — and is better off not reading — the names and dates it is about to remove.

A selector that resolves to nothing is an **error, not a no-op**: `"<selector>
matched nothing — …"`. Re-running a selector whose target is already gone
therefore fails loudly, which reads as "this was already forgotten." An unknown
`personId` is likewise an error, phrased to distinguish a tree person id from a
FamilySearch PID.

### 2.2 Cascade

Removing a person removes **every relationship touching them**, or the tree is
left with links pointing at people who no longer exist. This is why `person:` and
the relative selectors are reported with a separate `relationshipsCascaded`
count, and why the skill dry-runs first: forgetting a father can also cut the
subject's siblings, that father's own parents, and his marriage. The fact-level
selectors (`birth-of`, `death-of`, `facts-of`, `fact`) never cascade.

Facts live on persons **and** on Couple relationships alike; `fact` searches both.

### 2.3 `dryRun`

`dryRun: true` computes and reports the identical summary and writes **nothing** —
neither the tree nor the restore file. Selector errors surface identically under
`dryRun`, so a dry run is a complete rehearsal.

The cascade depends on the tree's *current* shape, so a second forget's blast
radius is not the first one's. The skill dry-runs before every apply.

## 3. Return value

Wire-side **camelCase** (a tool output, not a persisted document — the repo's
identifier-casing rule).

```typescript
{
  ok: true,
  dryRun: boolean,
  removed: {
    persons: number,
    relationships: number,          // including cascaded
    relationshipsCascaded: number,  // the subset removed because a person went
    factsByType: { [factType: string]: number },
  },
  remaining: { persons: number, relationships: number },
  filesWritten: string[],           // [] under dryRun, else ["tree.gedcomx.json"]
  restoreFile: string | null,       // the restore file's name, or null under dryRun
  validation: { valid: true, warnings: string[] },
}
```

On failure: `{ ok: false, errors: string[] }`, with nothing written.

### 3.1 The redaction contract

**The return value carries counts and kinds only — never a name, date, place, or
any other genealogical value.** This is the tool's central constraint, not a
nicety. The result lands in the context of the agent that is about to go looking
for exactly this information; printing what was removed puts the answer straight
back and makes the exercise worthless. The researcher verifies the removal in the
viewer, where seeing the gap is the point.

What may appear in a result or error: entity **ids** (the caller supplied them,
and they are opaque), **counts**, **fact type names** (`Birth`, `Marriage` — a
kind, not a value), and JSON **paths**.

This constrains the pass-through channels too:

- `validation.warnings` carries the sanitizer's heal notices, which are
  count-and-kind only by construction. `validateParsed` emits no warnings today
  (`addWarning` has no call site in `validator.ts`); any warning added later
  must respect this contract, since this tool forwards them.
- Validation **errors** are forwarded on the failure path. Today those quote
  ids, paths, and closed-enum tokens only — no genealogical values. Same
  obligation on anything added later.

Any future field on this result is subject to the same rule.

## 4. Validation

The tool heals legacy shapes (`sanitizeTree`) and then validates the **whole
project** (`validateParsed`) before writing — the same validate-before-persist
contract every writer tool honors. On a validation failure nothing is written and
`{ ok: false, errors }` is returned.

This is a deliberate tightening over the deleted Python script, which validated
nothing and could leave the project in a state where every later `tree_edit`
rejected the whole document.

The realistic failure is a **dangling person reference**: `research.json` may
cite a person being removed (`person_evidence[i].person_id`, a question's
`subject_person_ids`, a timeline, a known holding), and `validateCrossFile`
reports those as errors. The tool does not repair them — it does not touch
`research.json`, by design — so the error names the blocking paths and the caller
decides: clear those entries first, or pick a fact-level selector that does not
cascade. The skill already tells the researcher that pre-existing assertions
stating the answer compromise the exercise anyway.

## 5. The restore file

A non-dry run writes the pre-removal tree to **`.tree-before-forget.gedcomx.json`**
in the project directory, then writes the stripped tree.

Three properties are load-bearing:

- **Dot-prefixed, deliberately.** The file still contains the answer. Both the
  agent's file browsing and the feedback bundler skip dot-prefixed entries, so
  the restore point cannot be picked up by accident. SKILL.md additionally
  forbids reading it.
- **No `.bak`.** Unlike `tree_edit`, this tool does **not** call
  `backupIfExists`. That would write `tree.gedcomx.json.bak` — same content, but
  *not* dot-prefixed, so it would be exactly the readable copy of the answer the
  dot-prefix exists to prevent.
- **Written once, never overwritten.** If `.tree-before-forget.gedcomx.json`
  already exists, it is left alone and the run proceeds. The restore point
  therefore always refers to the **original** tree, not to an
  already-forgotten intermediate. (The deleted script overwrote it on every run,
  which silently destroyed the pristine snapshot on a second forget — the hazard
  SKILL.md had to spend a paragraph warning about.) `restoreFile` is returned on
  every non-dry run regardless of whether this run created it.

## 6. Re-invocation

Forgetting is **additive**: a second call strips a further slice from the
already-stripped tree. Failures are safe — a selector that matches nothing, an
unknown id, or a validation error all abort before any write, leaving no partial
edit.

## 7. Out of scope

- **It does not prevent tree lookups.** Live FamilySearch still has the answer.
  The rule that `person_read` / `person_search` / `person_ancestors` / the
  person-match tools are off-limits for the affected people is prose in SKILL.md
  and holds because the agent follows it. Stripping the local copy is only half
  the mechanism.
- **It does not touch `research.json`.** See §4.
- **It does not verify the answer is recoverable from records.** Some facts on a
  FamilySearch tree have no supporting record behind them.
