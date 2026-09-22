---
name: search-images
description: Invoke for browsing FamilySearch digitized image volumes
  page-by-page — immediately when the user says "browse the images", "browse
  a volume", "page through", "look through the film/roll", "go through the
  unindexed records", or gives an image group number. Use this skill when a
  record set is digitized but NOT indexed and NOT full-text searchable, so the
  only way in is to open the volume and read images one at a time. Exclude
  indexed name/date/place search (use search-records), full-text transcript
  search (use search-full-text), external repositories like Ancestry (use
  search-external-sites), planning what to browse (use research-plan), and
  extracting facts from an image you have already found (use record-extraction).
allowed-tools:
  - project_context
---

# Search Images (router)

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

## 1. Resolve the arguments

From the user's words, gather:

- `projectPath` — the absolute project-folder path.
- `standardPlace` and the year range, **or** `imageGroupNumber` if the user gave
  a volume id (a split natural-group name like `007621224_005_M99P-2TQ` or a
  bare number like `007936749`). Pass it through verbatim.
- `planItemId` — if the user named the plan item this browse executes.
- `looking_for` — who or what they are hunting for, in their words.

Pass them through as given. Do not read `research.json` to choose a volume, do
not call a tool beyond the narration read above, and do not judge whether the set is indexed, whether a volume
exists, or whether the request is in scope — the agent runs every one of those
checks and declines when one fails.

## 2. Delegate the browse

Invoke `@plugin:search-images` with a delegation message carrying the arguments
above and asking it to **browse the volume and log the browse**.

Ask for the browse and let the agent report what it finds. Do not tell it what
is on a page, which image carries the record, or that a volume exists — it
cannot see the evidence from a delegation, and a pre-stated answer is the one
framing it has to refuse.

One invocation per browse target.

## 3. Relay

Print everything after the agent's final `---` verbatim, and nothing above it.
Do not summarize it, re-word it, or add a field name or identifier to it.

## Re-invocation behavior

**Writes:** nothing directly. Every write is made by the `search-images` agent
this skill delegates to — one `log` entry per browse, plus the executed plan
item's `status`. Nothing else, and no `tree.gedcomx.json` changes.

**On repeat invocation for the same volume:** delegate again, unchanged. Two
browses of one volume produce two log entries — that is correct, and the agent
does not deduplicate them.

**Safe to re-invoke.** A repeat run re-browses; it never rewrites a past entry.
