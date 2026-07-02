---
name: check-warnings
model: claude-sonnet-4-6
description: Checks genealogical data for impossibilities and anomalies --
  married before age 14, died after 120, child born after parent's death,
  events on impossible dates, conflicting birth or death dates,
  burial dated before death. Also reports FamilySearch's own data-quality
  score -- missing dates, places, and untagged sources -- for people with a
  FamilySearch ID. Surfaces both to the user without
  modifying project files; a guardrail skill invoked after
  assertions or person_evidence are added. Use when
  another skill's validation-protocol says "invoke check-warnings", when
  the user says "check for warnings", "are there any problems with this
  data?", "sanity check", or when reviewing assertions before writing a
  proof conclusion. Do NOT use for schema validation (use validate-schema)
  or for resolving conflicts between sources (use conflict-resolution).
allowed-tools:
  - person_warnings
  - person_quality
---

# Check Warnings

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

This skill runs two complementary checks and reports both, in separate sections:

- **`person_warnings`** (offline, deterministic) -- logical *impossibilities* in your **local** `tree.gedcomx.json`: death before birth, event after death, impossible ages. Same person, same warnings, every time.
- **`person_quality`** (online, FamilySearch) -- FamilySearch's own *data-quality score* for the live profile: missing dates/places, untagged sources, consistency and coherence issues, returned as ready-made English sentences.

They mean different things and must not be merged into one list: warnings are impossibilities in local data; quality issues are FamilySearch's assessment of the live tree profile (suggestions to improve it, not errors). Your job is to decide *whom* to check, run both, present the results clearly, and interpret them.

**Warnings ≠ conflicts:** Warnings are logical impossibilities in a single person's data. Conflicts are disagreements between two or more sources about the same fact. Use `conflict-resolution` for the latter.

**Phrasing rule (apply everywhere):** Phrase all next-step recommendations as research actions the user can take, not as instructions to run a named skill. Internal names like `timeline`, `person-evidence`, and `conflict-resolution` are routing references only -- do not put them in user-facing text.

## Assumption framework

- **Fundamental** (physical laws) → tool emits `severity: "error"`
- **Valid** (biological/social norms) → tool emits `severity: "warning"`
- **Unsound** (unproven premises) → tool does not fire

Full tag catalog: `references/warning-checks.md`.

## Steps

**Before anything — is this a warnings task?** If the user is describing a **disagreement between two or more sources** about the same fact (e.g. "one census says Ireland, the death cert says County Cork"), that is a **conflict**, not a warning: do **not** run the warning checks (`person_warnings`/`person_quality`) — instead **hand off by invoking the `conflict-resolution` skill** (see Handoff rules). Warnings are about a *single person's own data* violating physical/biological/temporal limits; source-vs-source disagreements are not this skill's job. Only run the steps below when the request is genuinely about such impossibilities/anomalies.

### 1. Identify the person(s) to check

- **Triggered by a writing skill** -- check every person whose assertions or person_evidence changed in that skill's run.
- **User-directed** -- use the person id from the request. If the user gave a name, read `tree.gedcomx.json` and match on `names[*].given` + `names[*].surname`. If multiple match, ask the user which one before calling the tool.
- **Batch review before a proof conclusion** -- check the subject person and every person whose evidence is cited in the proof.

The `personId` is the simplified GedcomX id from `tree.gedcomx.json` (e.g. `I1` or `KWCJ-RN4`).

### 2. Call the tools

Once you've confirmed this is a warnings task (not a handoff — see the Handoff rules; a source-vs-source disagreement goes to `conflict-resolution`, not here), then for each person to check:

1. Call `person_warnings({ projectPath, personId })` — the offline impossibility check that runs for every person you check. `projectPath` is the absolute path of the current working directory. The tool reads `tree.gedcomx.json` itself and returns each warning's `issueType`, `severity`, `personId`, `personName`, and `message`.
2. **Additionally, when `personId` is a FamilySearch ID** -- four characters, a hyphen, three characters (e.g. `KWCJ-RN4`, `KD96-TV2`) -- also call `person_quality({ personId })`. In projects built from FamilySearch the tree id *is* the FS ID, so the same id feeds both tools. **When the id is synthetic (e.g. `I1`), skip this call silently** -- there is no FamilySearch profile to score, so do not call the tool and do not mention FamilySearch quality at all for that person.

`person_quality` needs the user logged in and calls FamilySearch's live quality service. Handle it gracefully -- it must **never** suppress the offline warnings, which are the guardrail and always appear:

- **Not logged in / auth error** -- skip quality and note it once: "FamilySearch quality score unavailable -- log in to include it." Still report the warnings.
- **Tool error** (person tombstoned/merged, not found, still calculating, network) -- surface the tool's message as a one-line note in that person's quality section; do not block the warnings report.

The tool returns `{ personId, segment, overallScore, issueCount, categories: [{ scoreType, count, score }], issues: [{ sentence, conclusionType, conclusionId, scoreType }] }`.

### 3. Report warnings

For each warning, report:

- Severity icon: `severity: "error"` → `[!] Critical`; `severity: "warning"` → `[!] Note`
- The `issueType` tag (for traceability)
- The tool's `message` (already user-friendly)
- The assumption category violated (Fundamental / Valid)
- **The specific facts or sources involved.** When the warning's optional `factIds` field is populated, name those facts (e.g. "fact F3 -- Birth dated 1850"). Otherwise look up the relevant facts in `tree.gedcomx.json` and name them by id, type, and source ("source S3 -- Death certificate"). Actionability means the user can find the record at a glance.
- A concrete next step ("Verify the death date against S3" beats "verify the source").

**Before listing individual warnings, count.** If 2 or more `severity: "error"` warnings fire on the same person, open the report with a cluster verdict: "2 errors plus N warnings on this one person is a strong signal that records from two different individuals have been merged into one profile." Then recommend: "I'd recommend rebuilding a chronological timeline of every recorded event for this person and going through each one to identify where one person's records end and another's begin -- once we find the split point, we can reassign the records that belong to the other individual." List individual warnings *under* that verdict, not above it.

**Special case -- `missingFactsAndRelatives`:** Report with Note severity and add: "Note: this person has limited data, so most warning checks need dates and relatives to fire. Adding more research may surface additional issues currently hidden."

**Special case -- `hasEventAfterDeath1`:** This tag has three legitimate causes. Do NOT default to identity confusion just because the severity is `error`. The corrective action depends on the source type, which this skill cannot determine -- the source must be inspected first.

The three causes, with cues and recommended actions:

- **Identity confusion** -- the late-dated record actually describes a same-name individual who outlived the deceased. Cue: the source describes events apparently performed BY the deceased (e.g. a later census listing them as head of household, a later marriage record). Recommended action: "Let's rebuild a full chronological timeline of every recorded event for [person] and go through each record one by one to check whether it actually belongs to this person or to a same-name individual who outlived them."
- **Wrong death date** -- the recorded death date is too early. Cue: a single late-dated record is inconsistent with one earlier death record but consistent with everything else. Recommended action: "Verify the recorded death date for [person] against the original death record (the certificate or burial register) -- one of the two dates is likely wrong."
- **Posthumous mention** -- the late-dated record was created after the deceased's death and merely references them. Cue: the source is an obituary, a descendant's death certificate, an estate or probate document where the deceased is named as a parent or prior owner but is not performing an action. Recommended action: "Look at the late-dated record itself -- if it's a record about someone else that just mentions [person] as a parent or relative, it shouldn't be attached to [person]'s profile as one of their own events. Unlink it and treat it as a reference instead."

When the cause is ambiguous (the most common case), report the warning, list the three candidate causes, and recommend inspecting the source next. Do not recommend a specific corrective action before the source type is known -- recommending an identity split when the record is actually a posthumous mention would damage the data.

**Example output:**

```
WARNINGS FOR: Patrick Flynn (I1)

[!]  Critical -- Event after death  [hasEventAfterDeath1]
    [Fundamental: people cannot act after their death -- but a
    posthumous mention can be misattached to their profile.]
    An event is dated more than 1 year after this person's latest
    death-like fact (F2 -- Death 1908-03-12, source S3 Death
    certificate).

    This usually has one of three causes: (a) the recorded death
    date is wrong, (b) the late-dated record actually belongs to
    a same-name individual whose records were merged in, OR (c)
    the late-dated record is a posthumous mention (an obituary,
    a descendant's death certificate, an estate, probate, or
    guardianship record that names the deceased without
    describing actions by them).
    Next step: take a closer look at the late-dated record
    itself -- what kind of document is it? The right corrective
    action depends on what you find.

[!]  Note -- Long lifespan  [hasAgeRangeGreaterThan120]
    [Valid: people rarely live past 120.]
    This person's lifespan is greater than 120 years (F1 -- Birth
    ~1845, F2 -- Death 1908-03-12).
    Next: verify both vital dates against the cited sources.

(2 warnings total)
```

### 3b. Report the FamilySearch quality score

When `person_quality` returned data, add a separate **FamilySearch quality** section for the person -- kept apart from the impossibilities above, because it's a different source and a different meaning.

- Lead with the overall picture: `overallScore` (0--1) and the per-category counts from `categories` (Completeness / Verifiability / Consistency / Coherence).
- List each issue's `sentence` **verbatim** -- they are already user-ready English ("The burial date is missing.", "A residence has no tagged sources."). Group them by `scoreType`. Collapse identical repeats with a count (e.g. `(x5)`).
- These are FamilySearch's *suggestions to improve the profile*, not impossibilities. Phrase next steps as optional improvements ("adding the burial date would raise the completeness score"), never as urgent errors.
- **Don't invent a quality label or verdict** (no "High Quality" band) -- report the `overallScore` and the sentences as-is. The tool deliberately omits a band.
- When `issueCount` is 0: "FamilySearch quality: no issues flagged (overall {overallScore})."
- **Synthetic id (quality not applicable):** the person has no FamilySearch profile, so `person_quality` was never called. Say **nothing** about FamilySearch quality -- do not add a "not available" note. (This is the common case for hand-built or record-derived persons; a quality remark there is just noise.)
- **Quality attempted but failed** (the tool returned an error -- tombstoned/merged, not found, still calculating, or not logged in): add one brief note in the quality section using the tool's message. Never let it abort or suppress the warnings report.

**Example:**

```
FAMILYSEARCH QUALITY: Patrick Flynn (KD96-TV2)   overall 0.97
  Completeness 2 - Source tagging 5 - Consistency 0 - Coherence 0

  Completeness
    - The burial date is missing.
    - A marriage place is missing a city.
  Source tagging
    - A residence has no tagged sources.  (x5)
```

### 4. Interpret and recommend

- **`severity: "error"`** -- Investigate immediately. Almost always indicates data errors or conflated identities (records from two people merged into one profile).
- **`severity: "warning"`** -- Note and recommend verification. May indicate twins, blended families, or transcription errors. Phrase to the user as: "Let's verify [the specific assertion or fact] against its original source. If the original record genuinely shows that, we'll document it as an exception; if not, we'll correct the fact."
- **Relative warnings (`relatives*` tags)** -- The problem is in the relationship, not the focal person. Verify the relationship link *before* any data fix on the relative. Recommend: "This warning is about [Patrick]'s relative [Thomas], not [Patrick] directly. The first thing to check is whether [Thomas] is actually [Patrick]'s father, or whether a same-name record was linked here by mistake. Once we confirm the relationship is correct, then we can look at whether [Thomas]'s data needs fixing." A "fix the data" step on a `relatives*` warning with no link-verification first commits the user to research time on a relationship that may not be real.

Load `references/warnings-as-identity-signals.md` for the full escalation table.

## When no warnings are found

When the tool returns `warningCount: 0`, report: "No genealogical warnings found for [person]. The tool's checks all passed."

## Important rules

- **Warnings are informational, not gates.** They don't block further work.
- **Don't auto-correct.** Report the warning; let the user or other skills investigate.
- **The tool is the arbiter; don't re-derive.** The tool's output is ground truth. Do not read the tree to verify whether the tool's verdict is correct. Do not perform your own date arithmetic to explain a warning the tool already explained -- the number "208 years" was never in the tool's response; do not invent it. Cite only the `factIds`, sources, and persons the tool's response actually mentions.
- **Quality issues are improvements, not impossibilities.** A missing date or untagged source lowers FamilySearch's quality score but is not an error -- never escalate a `person_quality` issue the way you would a `severity: "error"` warning. Report its `sentence` verbatim; don't re-derive, re-score, or invent a band.
- **Historical exceptions exist.** A 13-year-old bride or a 105-year-old death is unusual by modern standards but documented historically. Present warnings with appropriate context.
- **Surface tool errors verbatim.** If the tool returns an error (e.g. `personId` not found in `tree.gedcomx.json`), surface it as-is. Do not fall back to manual reasoning -- the whole point is determinism.

## Handoff rules

- **Two sources disagreeing** -- hand off to `conflict-resolution`.
- **Warning suggests identity confusion** -- suggest rebuilding the chronological timeline first, then reassigning records once the split point is found.
- **User asks to fix a warning** -- do NOT fix it here. Route to `person-evidence`, `conflict-resolution`, or let the user correct manually.
- **Timeline skill invoked check-warnings** -- return results to timeline's caller; do not start a new investigation.

## Re-invocation behavior

This skill writes no project state. It reads `tree.gedcomx.json` via
`person_warnings` (offline, deterministic) and, for FamilySearch-ID
persons, fetches the live score via `person_quality` (online). Safe to
re-invoke at any time. The warnings depend only on the current tree
state; the quality score reflects the live FamilySearch profile at call
time and requires login, so -- unlike the warnings -- it can change
between runs or be temporarily unavailable.
