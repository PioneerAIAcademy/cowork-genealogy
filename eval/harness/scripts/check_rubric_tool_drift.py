#!/usr/bin/env python3
"""GH Action: warn when eval grading prose drifts behind a tool contract.

For every skill, compares the MCP tool names that appear in its
`rubric.md` and its tests' `judge_context` notes against the tools its
`SKILL.md` `allowed-tools` frontmatter actually declares. A tool name
mentioned in grading prose but absent from allowed-tools means the corpus
is grading against a call the skill is no longer allowed to make — usually
because the call was folded into another tool and the prose was never
updated. That happened twice unnoticed (`same_person`/`source_attachments`
folded into `record_search`, `rank_search_matches` folded away as a
standalone step): the judge kept failing correct runs for not making calls
the architecture had retired.

Does the same check for plugin agents: a tool name mentioned in an agent's
body that is not in its `tools:` frontmatter (nor in `disallowedTools:`, if
one is ever re-added — no agent declares one today, but the code unions both
as insurance for a re-added deny; CLAUDE.md § "Re-adding a deny").

This is the exact inverse of check_tool_coverage.py's reverse check (a test
fixture referencing a tool absent from allowed-tools): that check catches
a corpus that calls a tool it shouldn't; this one catches a corpus that
*talks about* a tool it shouldn't.

Two mechanical (not heuristic) sources of false positives are filtered out:

- A skill that delegates to a plugin agent (`@plugin:<name>` in its
  SKILL.md, e.g. record-extraction -> record-extractor) legitimately
  describes calls that agent makes on its behalf. `delegated_tools()` reads
  the referenced agent's own `tools:` frontmatter — real ground truth, not
  a guess — and unions it into the skill's declared set.
- COMMON_WORD_EXEMPTIONS drops tool names that double as ordinary English
  words (`login`, `logout`) from the vocabulary entirely: a skill's own
  contract never legitimately requires *it* to call these (they're
  user-driven OAuth flows), so a match is far more likely to be the English
  word than the tool.

Warn-only: this never fails the build (always exits 0). There is a third,
NOT mechanically filterable, false-positive shape: grading prose naming a
tool that belongs to a *different* skill (a routing test's judge_context
naming the destination skill's tool, or "not this skill's job, that's
$OTHER_SKILL's" prose). These are handled by the per-site SUPPRESSIONS list
below (issue #1522). Inline comments were rejected: judge_context strings
go verbatim into the judge prompt (eval/harness/judge/prompt.md), agent
bodies forbid comments (CLAUDE.md § "Cowork plugin agents"), and touching
~15 skill directories to add per-file markers would trigger ~15 blocking
eval re-runs at $8–12 each. The list is shrink-only: a stale entry whose
(file, tool) no longer fires fails the unit test
(test_check_rubric_tool_drift.py), so removing entries is always safe and
adding one requires that it still corresponds to a live hit.

Run `python eval/harness/scripts/check_rubric_tool_drift.py` against a built
manifest for the current hit count. Run by
.github/workflows/check-runlogs.yml. Self-contained: stdlib only (the
workflow installs no dependencies).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS_DIR = HERE.parent
REPO_ROOT = HARNESS_DIR.parents[1]

# See the same block in check_tool_coverage.py: CI's `python <script>.py` adds
# HERE to sys.path, the unit tests' `spec_from_file_location` does not.
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from gh_annotations import gh_warning, write_step_summary  # noqa: E402

SKILLS_DIR = REPO_ROOT / "packages" / "engine" / "plugin" / "skills"
TESTS_DIR = REPO_ROOT / "eval" / "tests" / "unit"
AGENTS_DIR = REPO_ROOT / "packages" / "engine" / "plugin" / "agents"
MANIFEST = REPO_ROOT / "packages" / "engine" / "mcp-server" / "manifest.json"

# Tool names that double as ordinary English words, keyed by name -> the
# reason, so the exemption is self-documenting and never becomes a silent
# dumping ground (same idiom as check_tool_coverage.py's EXEMPT_TOOLS). Keep
# this list short and justified — a tool belongs here only when a false
# match is clearly more likely than a true one.
COMMON_WORD_EXEMPTIONS: dict[str, str] = {
    "login": (
        "collides with the ordinary English word (\"a login may be "
        "required\"). Skills never call login themselves — it's a "
        "user-driven OAuth flow outside any skill's tool contract — so a "
        "match is far more likely to be the word than the tool."
    ),
    "logout": "same collision as login, for the same reason.",
}

# -- Per-site suppression list ------------------------------------------
#
# Each entry suppresses one (file, tool) warning. This is the ONLY
# suppression mechanism for this check — inline comments were rejected
# (issue #1522): judge_context strings go verbatim into the judge prompt,
# agent bodies forbid comments, and touching ~15 skill dirs to add per-file
# markers would trigger ~15 blocking eval re-runs at $8–12 each.
#
# Shrink-only: every entry must still match a hit the script would otherwise
# emit. test_check_rubric_tool_drift.py asserts both directions — a stale
# entry (one whose (file, tool) no longer fires) fails the test, and a
# suppressed entry does not mask an unrelated genuine hit. Removing entries
# is always safe; adding one requires a reason longer than 20 characters.
#
# Keys: "file" (repo-relative, matches the file= arg in gh_warning),
#        "tool" (bare tool name), "reason" (why this is not drift), and
#        "quotes" (the exact span(s) the reason cites FROM THAT FILE).
#
# "quotes" is separate from "reason" so it can be checked mechanically:
# test_every_suppression_quote_is_verbatim asserts each one still appears
# in the file the entry names. Six entries once quoted a SIBLING file's
# wording — the verdict was right but the proof pointed at the wrong
# text, and nothing caught it. Prose in "reason" may mention a phrase
# that is deliberately ABSENT (patronymic-drop names "and expected" to
# say it is not there); only "quotes" is held to the file.
SUPPRESSIONS: list[dict[str, str]] = [
    {
        "file": "eval/tests/unit/check-warnings/negative-schema-validation.json",
        "tool": "validate_research_schema",
        "quotes": [
            "Should route to validate-schema (or whatever skill owns the validate_research_schema MCP tool)",
        ],
        "reason": (
            "cross-owner: names the destination skill of a routing test - "
            "'Should route to validate-schema (or whatever skill owns the "
            "validate_research_schema MCP tool)'"
        ),
    },
    {
        "file": "eval/tests/unit/init-project/rubric.md",
        "tool": "validate_research_schema",
        "quotes": [
            "init-project has no schema-validation tool in its `allowed-tools`, so this is graded by reading the file against the schema, not by expecting a `validate_research_schema` call",
        ],
        "reason": (
            "not-needed, and says so explicitly - 'init-project has no "
            "schema-validation tool in its `allowed-tools`, so this is "
            "graded by reading the file against the schema, not by "
            "expecting a `validate_research_schema` call'"
        ),
    },
    {
        "file": "eval/tests/unit/locality-guide/ut_locality_guide_009.json",
        "tool": "collection_read",
        "quotes": [
            "Citing collection ids that came from a correctly-matched collections_search call, without independently re-verifying them through collection_read, is not a fabrication given this fixture's known limitation - do not penalize Correctness for it",
        ],
        "reason": (
            "not-needed: permissive fixture-limitation note, no expectation "
            "of a call - 'Citing collection ids that came from a "
            "correctly-matched collections_search call, without "
            "independently re-verifying them through collection_read, is "
            "not a fabrication given this fixture's known limitation - do "
            "not penalize Correctness for it'"
        ),
    },
    {
        "file": "eval/tests/unit/locality-guide/ut_locality_guide_020.json",
        "tool": "collection_read",
        "quotes": [
            "is the fixture's known limitation, not a Tool Arguments error - do not penalize Tool Arguments for the mismatch between the requested id and the returned collection",
        ],
        "reason": (
            "not-needed: permissive fixture-limitation note - 'is the "
            "fixture's known limitation, not a Tool Arguments error - do "
            "not penalize Tool Arguments for the mismatch between the "
            "requested id and the returned collection'"
        ),
    },
    {
        "file": "eval/tests/unit/person-evidence/baptism-parentage-links-only-defers-relationship.json",
        "tool": "tree_correct",
        "quotes": [
            "nothing in this skill's toolset can raise the gender afterwards, since `tree_correct update_person` is not granted to it",
        ],
        "reason": (
            "negative mention: names the tool to say the skill lacks it - "
            "'nothing in this skill's toolset can raise the gender "
            "afterwards, since `tree_correct update_person` is not granted "
            "to it'"
        ),
    },
    {
        "file": "eval/tests/unit/person-evidence/patronymic-mismatch-caps-confidence.json",
        "tool": "record_search",
        "quotes": [
            "this assertion is record_search-sourced (record_persona_id CP1 is non-null), so same_person is available here",
        ],
        "reason": (
            "descriptive provenance, not a call: names where the assertion "
            "came from - 'this assertion is record_search-sourced "
            "(record_persona_id CP1 is non-null), so same_person is "
            "available here'"
        ),
    },
    {
        "file": "eval/tests/unit/proof-conclusion/no-image-claim-without-tool-confirmation.json",
        "tool": "record_read",
        "quotes": [
            "record_read was never called to check for a digitized image",
        ],
        "reason": (
            "descriptive ground truth about a call that was NOT made "
            "upstream - 'record_read was never called to check for a "
            "digitized image'"
        ),
    },
    {
        "file": "eval/tests/unit/proof-conclusion/no-image-claim-without-tool-confirmation.json",
        "tool": "record_search",
        "quotes": [
            "Its notes and log_001 explicitly state that record_search returned no imageId/artifacts field for this hit",
        ],
        "reason": (
            "descriptive ground truth about an upstream skill's call - 'Its "
            "notes and log_001 explicitly state that record_search returned "
            "no imageId/artifacts field for this hit'"
        ),
    },
    {
        "file": "eval/tests/unit/question-selection/ut_question_selection_005.json",
        "tool": "validate_research_schema",
        "quotes": [
            "if the skill calls validate_research_schema, gets a validation error, self-corrects, and re-validates successfully, score Tool Arguments=3",
        ],
        "reason": (
            "not-needed: a purely conditional score-UP rule that never "
            "penalizes an absence - 'if the skill calls "
            "validate_research_schema, gets a validation error, "
            "self-corrects, and re-validates successfully, score Tool "
            "Arguments=3'. question-selection holds only research_append"
        ),
    },
    {
        "file": "eval/tests/unit/question-selection/ut_question_selection_006.json",
        "tool": "validate_research_schema",
        "quotes": [
            "if the skill calls validate_research_schema, gets a validation error, self-corrects, and re-validates successfully, score Tool Arguments=3",
        ],
        "reason": (
            "not-needed: a purely conditional score-UP rule that never "
            "penalizes an absence - 'if the skill calls "
            "validate_research_schema, gets a validation error, "
            "self-corrects, and re-validates successfully, score Tool "
            "Arguments=3'. question-selection holds only research_append"
        ),
    },
    {
        "file": "eval/tests/unit/record-extraction/census-1850-subject-as-child-creates-sibling-stubs.json",
        "tool": "tree_edit",
        "quotes": [
            "record-extraction is ASSERTION-ONLY",
            "`mcp__genealogy__tree_edit` is not in its frontmatter; it makes ZERO tree_edit / tree_correct calls",
            "Do NOT expect, or reward, any tree person/edge write in this run",
        ],
        "reason": (
            "negative mention - 'record-extraction is ASSERTION-ONLY ... "
            "`mcp__genealogy__tree_edit` is not in its frontmatter; it "
            "makes ZERO tree_edit / tree_correct calls ... Do NOT expect, "
            "or reward, any tree person/edge write in this run'"
        ),
    },
    {
        "file": "eval/tests/unit/record-extraction/census-1850-subject-as-child-creates-sibling-stubs.json",
        "tool": "tree_correct",
        "quotes": [
            "record-extraction is ASSERTION-ONLY",
            "`mcp__genealogy__tree_edit` is not in its frontmatter; it makes ZERO tree_edit / tree_correct calls",
            "Do NOT expect, or reward, any tree person/edge write in this run",
        ],
        "reason": (
            "negative mention - 'record-extraction is ASSERTION-ONLY ... "
            "`mcp__genealogy__tree_edit` is not in its frontmatter; it "
            "makes ZERO tree_edit / tree_correct calls ... Do NOT expect, "
            "or reward, any tree person/edge write in this run'"
        ),
    },
    {
        "file": "eval/tests/unit/record-extraction/census-1850-subject-as-child-creates-sibling-stubs.json",
        "tool": "materialize_facts",
        "quotes": [
            "Minting the sibling person stubs (Bridget, John)",
            "is person-evidence's household-skeleton step (materialize_facts create-or-enrich + tree_edit add_relationship), reached later - not extraction's job",
        ],
        "reason": (
            "cross-owner: names person-evidence's tool - 'Minting the "
            "sibling person stubs (Bridget, John) ... is person-evidence's "
            "household-skeleton step (materialize_facts create-or-enrich + "
            "tree_edit add_relationship), reached later - not extraction's "
            "job'"
        ),
    },
    {
        "file": "eval/tests/unit/record-extraction/census-sex-assertion-for-gender.json",
        "tool": "materialize_facts",
        "quotes": [
            "WHY it matters (context for the judge, not a second check): materialize_facts reads a persona's sex/gender assertions to set the gender of any tree person person-evidence later mints from this record",
        ],
        "reason": (
            "cross-owner, and flagged as non-grading by its own first "
            "clause - 'WHY it matters (context for the judge, not a second "
            "check): materialize_facts reads a persona's sex/gender "
            "assertions to set the gender of any tree person "
            "person-evidence later mints from this record'"
        ),
    },
    {
        "file": "eval/tests/unit/record-extraction/positive-extract-and-route-image-ark.json",
        "tool": "image_read",
        "quotes": [
            "Do NOT grade whether the router called image_read directly in the main context - that guard is enforced mechanically by the harness",
        ],
        "reason": (
            "negative mention, and explicitly out of the judge's remit - "
            "'Do NOT grade whether the router called image_read directly in "
            "the main context - that guard is enforced mechanically by the "
            "harness'"
        ),
    },
    {
        "file": "eval/tests/unit/record-extraction/suspect-required-name-confirm-via-image.json",
        "tool": "image_read",
        "quotes": [
            "The router must NOT call image_read directly in the main context - image reading is the image-reader subagent's job",
        ],
        "reason": (
            "negative mention - 'The router must NOT call image_read "
            "directly in the main context - image reading is the "
            "image-reader subagent's job'"
        ),
    },
    {
        "file": "eval/tests/unit/record-extraction/sets-record-persona-id.json",
        "tool": "record_search",
        "quotes": [
            "search-records already logged this search as log_001 (a record_search entry whose sidecar holds the gedcomx)",
        ],
        "reason": (
            "descriptive provenance, another skill's call - 'search-records "
            "already logged this search as log_001 (a record_search entry "
            "whose sidecar holds the gedcomx)'"
        ),
    },
    {
        "file": "eval/tests/unit/record-extraction/rubric.md",
        "tool": "tree_edit",
        "quotes": [
            "does **not** hold `tree_edit`/`tree_correct`. It writes **no** tree persons, names, or relationships",
            "do not reward, and do not penalize the absence of, a tree stub or edge",
        ],
        "reason": (
            "negative mention, in record-extraction's own rubric - 'does "
            "**not** hold `tree_edit`/`tree_correct`. It writes **no** tree "
            "persons, names, or relationships ... do not reward, and do not "
            "penalize the absence of, a tree stub or edge'"
        ),
    },
    {
        "file": "eval/tests/unit/record-extraction/rubric.md",
        "tool": "tree_correct",
        "quotes": [
            "does **not** hold `tree_edit`/`tree_correct`. It writes **no** tree persons, names, or relationships",
            "do not reward, and do not penalize the absence of, a tree stub or edge",
        ],
        "reason": (
            "negative mention, in record-extraction's own rubric - 'does "
            "**not** hold `tree_edit`/`tree_correct`. It writes **no** tree "
            "persons, names, or relationships ... do not reward, and do not "
            "penalize the absence of, a tree stub or edge'"
        ),
    },
    {
        "file": "eval/tests/unit/record-extraction/rubric.md",
        "tool": "materialize_facts",
        "quotes": [
            "Minting a household's sibling stubs and writing their `ParentChild`/spouse edges is **person-evidence's** household-skeleton step (`materialize_facts` create-or-enrich + `tree_edit add_relationship`), not extraction's",
        ],
        "reason": (
            "cross-owner: names person-evidence's tool - 'Minting a "
            "household's sibling stubs and writing their "
            "`ParentChild`/spouse edges is **person-evidence's** "
            "household-skeleton step (`materialize_facts` create-or-enrich "
            "+ `tree_edit add_relationship`), not extraction's'"
        ),
    },
    {
        "file": "eval/tests/unit/research-exhaustiveness/declare-exhaustive-complete.json",
        "tool": "validate_research_schema",
        "quotes": [
            "Claude does not need to call validate_research_schema - it is not in this skill's allowed-tools, and per SKILL.md, research_append validates-before-persist",
            "Do NOT penalize Tool Arguments or Completeness for the absence of a separate validate_research_schema call",
        ],
        "reason": (
            "not-needed, naming the allowed-tools fact outright - 'Claude "
            "does not need to call validate_research_schema - it is not in "
            "this skill's allowed-tools, and per SKILL.md, research_append "
            "validates-before-persist ... Do NOT penalize Tool Arguments or "
            "Completeness for the absence of a separate "
            "validate_research_schema call'"
        ),
    },
    {
        "file": "eval/tests/unit/research-exhaustiveness/direct-declare-exhaustive-complete.json",
        "tool": "validate_research_schema",
        "quotes": [
            "Claude does not need to call validate_research_schema - it is not in this skill's allowed-tools, and per SKILL.md, research_append validates-before-persist",
            "Do NOT penalize Tool Arguments or Completeness for the absence of a separate validate_research_schema call",
        ],
        "reason": (
            "not-needed, naming the allowed-tools fact outright - 'Claude "
            "does not need to call validate_research_schema - it is not in "
            "this skill's allowed-tools, and per SKILL.md, research_append "
            "validates-before-persist ... Do NOT penalize Tool Arguments or "
            "Completeness for the absence of a separate "
            "validate_research_schema call'"
        ),
    },
    {
        "file": "eval/tests/unit/research-exhaustiveness/honest-early-termination.json",
        "tool": "validate_research_schema",
        "quotes": [
            "Claude does not need to call validate_research_schema - it is not in this skill's allowed-tools, and per SKILL.md, research_append validates-before-persist",
            "Do NOT penalize Tool Arguments or Completeness for the absence of a separate validate_research_schema call",
        ],
        "reason": (
            "not-needed, naming the allowed-tools fact outright - 'Claude "
            "does not need to call validate_research_schema - it is not in "
            "this skill's allowed-tools, and per SKILL.md, research_append "
            "validates-before-persist ... Do NOT penalize Tool Arguments or "
            "Completeness for the absence of a separate "
            "validate_research_schema call'"
        ),
    },
    {
        "file": "eval/tests/unit/research-exhaustiveness/child-link-marriage-not-sufficient.json",
        "tool": "validate_research_schema",
        "quotes": [
            "Tool Arguments: this is a decline/review response - Claude is not expected to call validate_research_schema.",
        ],
        "reason": (
            "not-needed - 'Tool Arguments: this is a decline/review "
            "response - Claude is not expected to call "
            "validate_research_schema.'"
        ),
    },
    {
        "file": "eval/tests/unit/research-exhaustiveness/tentative-value-alternative-record-gate.json",
        "tool": "validate_research_schema",
        "quotes": [
            "Tool Arguments: this is a decline/review response - Claude is not expected to call validate_research_schema.",
        ],
        "reason": (
            "not-needed - 'Tool Arguments: this is a decline/review "
            "response - Claude is not expected to call "
            "validate_research_schema.'"
        ),
    },
    {
        "file": "eval/tests/unit/research-exhaustiveness/decline-incomplete-research.json",
        "tool": "validate_research_schema",
        "quotes": [
            "Tool Arguments: This is a decline/review response - Claude is not expected to call validate_research_schema.",
        ],
        "reason": (
            "not-needed - 'Tool Arguments: This is a decline/review "
            "response - Claude is not expected to call "
            "validate_research_schema.'"
        ),
    },
    {
        "file": "eval/tests/unit/research-exhaustiveness/exhaustiveness-decisive-record-gate.json",
        "tool": "validate_research_schema",
        "quotes": [
            "Tool Arguments: This is a decline/review response - Claude is not expected to call validate_research_schema.",
        ],
        "reason": (
            "not-needed - 'Tool Arguments: This is a decline/review "
            "response - Claude is not expected to call "
            "validate_research_schema.'"
        ),
    },
    {
        "file": "eval/tests/unit/research-exhaustiveness/direct-refuse-while-in-progress.json",
        "tool": "validate_research_schema",
        "quotes": [
            "If Claude does call validate_research_schema that is acceptable but not required since no changes were made",
        ],
        "reason": (
            "not-needed - 'If Claude does call validate_research_schema "
            "that is acceptable but not required since no changes were "
            "made'"
        ),
    },
    {
        "file": "eval/tests/unit/research-exhaustiveness/refuse-while-in-progress.json",
        "tool": "validate_research_schema",
        "quotes": [
            "If Claude does call validate_research_schema that is acceptable but not required since no changes were made",
        ],
        "reason": (
            "not-needed - 'If Claude does call validate_research_schema "
            "that is acceptable but not required since no changes were "
            "made'"
        ),
    },
    {
        "file": "eval/tests/unit/research-exhaustiveness/already-declared-no-redeclare.json",
        "tool": "validate_research_schema",
        "quotes": [
            "Since no changes are being made to research.json, calling validate_research_schema is not required",
        ],
        "reason": (
            "not-needed - 'Since no changes are being made to "
            "research.json, calling validate_research_schema is not "
            "required'"
        ),
    },
    {
        "file": "eval/tests/unit/research-exhaustiveness/sealed-record-not-a-gap.json",
        "tool": "validate_research_schema",
        "quotes": [
            "if the skill declares, it writes via research_append (and may call validate_research_schema)",
        ],
        "reason": (
            "not-needed, permissive 'may' - 'if the skill declares, it "
            "writes via research_append (and may call "
            "validate_research_schema)'"
        ),
    },
    {
        "file": "eval/tests/unit/research-exhaustiveness/ut_research_exhaustiveness_011.json",
        "tool": "validate_research_schema",
        "quotes": [
            "The correct outcome is routing to proof-conclusion, with no exhaustive_declaration changes and no validate_research_schema call",
        ],
        "reason": (
            "negative mention in a triggering-boundary test - 'The correct "
            "outcome is routing to proof-conclusion, with no "
            "exhaustive_declaration changes and no validate_research_schema "
            "call'"
        ),
    },
    {
        "file": "eval/tests/unit/research-plan/locality-survey-first-plan.json",
        "tool": "wiki_search",
        "quotes": [
            "it should NOT call wiki_search / wiki_place_page / place_population (research-plan no longer holds those tools - the know-how comes from the localities entry). Do NOT fail it for not surveying.",
        ],
        "reason": (
            "negative mention naming the retirement outright - 'it should "
            "NOT call wiki_search / wiki_place_page / place_population "
            "(research-plan no longer holds those tools - the know-how "
            "comes from the localities entry). Do NOT fail it for not "
            "surveying.'"
        ),
    },
    {
        "file": "eval/tests/unit/research-plan/locality-survey-first-plan.json",
        "tool": "wiki_place_page",
        "quotes": [
            "it should NOT call wiki_search / wiki_place_page / place_population (research-plan no longer holds those tools - the know-how comes from the localities entry). Do NOT fail it for not surveying.",
        ],
        "reason": (
            "negative mention naming the retirement outright - 'it should "
            "NOT call wiki_search / wiki_place_page / place_population "
            "(research-plan no longer holds those tools - the know-how "
            "comes from the localities entry). Do NOT fail it for not "
            "surveying.'"
        ),
    },
    {
        "file": "eval/tests/unit/research-plan/locality-survey-first-plan.json",
        "tool": "place_population",
        "quotes": [
            "it should NOT call wiki_search / wiki_place_page / place_population (research-plan no longer holds those tools - the know-how comes from the localities entry). Do NOT fail it for not surveying.",
        ],
        "reason": (
            "negative mention naming the retirement outright - 'it should "
            "NOT call wiki_search / wiki_place_page / place_population "
            "(research-plan no longer holds those tools - the know-how "
            "comes from the localities entry). Do NOT fail it for not "
            "surveying.'"
        ),
    },
    {
        "file": "eval/tests/unit/research-plan/plan-danish-parentage-includes-levy-rolls.json",
        "tool": "wiki_search",
        "quotes": [
            "it should NOT call wiki_search / wiki_place_page / place_population (research-plan no longer holds those tools). Do NOT fail it for not surveying.",
        ],
        "reason": (
            "negative mention naming the retirement outright - 'it should "
            "NOT call wiki_search / wiki_place_page / place_population "
            "(research-plan no longer holds those tools). Do NOT fail it "
            "for not surveying.'"
        ),
    },
    {
        "file": "eval/tests/unit/research-plan/plan-danish-parentage-includes-levy-rolls.json",
        "tool": "wiki_place_page",
        "quotes": [
            "it should NOT call wiki_search / wiki_place_page / place_population (research-plan no longer holds those tools). Do NOT fail it for not surveying.",
        ],
        "reason": (
            "negative mention naming the retirement outright - 'it should "
            "NOT call wiki_search / wiki_place_page / place_population "
            "(research-plan no longer holds those tools). Do NOT fail it "
            "for not surveying.'"
        ),
    },
    {
        "file": "eval/tests/unit/research-plan/plan-danish-parentage-includes-levy-rolls.json",
        "tool": "place_population",
        "quotes": [
            "it should NOT call wiki_search / wiki_place_page / place_population (research-plan no longer holds those tools). Do NOT fail it for not surveying.",
        ],
        "reason": (
            "negative mention naming the retirement outright - 'it should "
            "NOT call wiki_search / wiki_place_page / place_population "
            "(research-plan no longer holds those tools). Do NOT fail it "
            "for not surveying.'"
        ),
    },
    {
        "file": "eval/tests/unit/search-full-text/parentage-compound-surname-cooccurrence.json",
        "tool": "record_search",
        "quotes": [
            "Should NOT scope the full-text search to a record `collectionId` guessed from record_search or a collections survey",
        ],
        "reason": (
            "negative mention of another skill's tool - 'Should NOT scope "
            "the full-text search to a record `collectionId` guessed from "
            "record_search or a collections survey'"
        ),
    },
    {
        "file": "eval/tests/unit/search-images/browse-unindexed-probate.json",
        "tool": "image_read",
        "quotes": [
            "the agent reads pages itself with image_transcribe - it must NOT call image_read (it has no such tool: image_read returns the page inline and a volume browse overflows the transport)",
        ],
        "reason": (
            "negative mention - 'the agent reads pages itself with "
            "image_transcribe - it must NOT call image_read (it has no such "
            "tool: image_read returns the page inline and a volume browse "
            "overflows the transport)'"
        ),
    },
    {
        "file": "eval/tests/unit/search-images/image-group-listing.json",
        "tool": "image_read",
        "quotes": [
            "the agent reads pages itself with image_transcribe - it must NOT call image_read (it has no such tool: image_read returns the page inline and a volume browse overflows the transport)",
        ],
        "reason": (
            "negative mention - 'the agent reads pages itself with "
            "image_transcribe - it must NOT call image_read (it has no such "
            "tool: image_read returns the page inline and a volume browse "
            "overflows the transport)'"
        ),
    },
    {
        "file": "eval/tests/unit/search-images/volume-selection-multi-candidate.json",
        "tool": "image_read",
        "quotes": [
            "the agent reads pages itself with image_transcribe - it must NOT call image_read (it has no such tool: image_read returns the page inline and a volume browse overflows the transport)",
        ],
        "reason": (
            "negative mention - 'the agent reads pages itself with "
            "image_transcribe - it must NOT call image_read (it has no such "
            "tool: image_read returns the page inline and a volume browse "
            "overflows the transport)'"
        ),
    },
    {
        "file": "eval/tests/unit/search-images/volume-split-across-films.json",
        "tool": "image_read",
        "quotes": [
            "the agent reads pages itself with image_transcribe - it must NOT call image_read (it has no such tool: image_read returns the page inline and a volume browse overflows the transport)",
        ],
        "reason": (
            "negative mention - 'the agent reads pages itself with "
            "image_transcribe - it must NOT call image_read (it has no such "
            "tool: image_read returns the page inline and a volume browse "
            "overflows the transport)'"
        ),
    },
    {
        "file": "eval/tests/unit/search-images/direct-browse-unindexed-probate.json",
        "tool": "image_read",
        "quotes": [
            "the agent reads pages itself with image_transcribe - it must NOT call image_read (it has no such tool)",
        ],
        "reason": (
            "negative mention - 'the agent reads pages itself with "
            "image_transcribe - it must NOT call image_read (it has no such "
            "tool)'"
        ),
    },
    {
        "file": "eval/tests/unit/search-images/direct-happy-path-browse.json",
        "tool": "image_read",
        "quotes": [
            "the agent reads pages itself with image_transcribe - it must NOT call image_read (it has no such tool)",
        ],
        "reason": (
            "negative mention - 'the agent reads pages itself with "
            "image_transcribe - it must NOT call image_read (it has no such "
            "tool)'"
        ),
    },
    {
        "file": "eval/tests/unit/search-images/volume-mixed-item-sections.json",
        "tool": "image_read",
        "quotes": [
            "Page reading is done by the agent itself with image_transcribe (never image_read, which it does not hold)",
        ],
        "reason": (
            "negative mention, worded as a parenthetical rather than an "
            "imperative - 'Page reading is done by the agent itself with "
            "image_transcribe (never image_read, which it does not hold)'"
        ),
    },
    {
        "file": "eval/tests/unit/search-images/rubric.md",
        "tool": "image_read",
        "quotes": [
            "The agent does not call `image_read` and does not hold it: `image_read` returns the page inline as base64 and a volume browse accumulates enough of it to overflow the transport and crash the run",
        ],
        "reason": (
            "negative mention - 'The agent does not call `image_read` and "
            "does not hold it: `image_read` returns the page inline as "
            "base64 and a volume browse accumulates enough of it to "
            "overflow the transport and crash the run'"
        ),
    },
    {
        "file": "eval/tests/unit/search-images/negative-indexed-search.json",
        "tool": "record_search",
        "quotes": [
            "A log entry from search-records itself (tool: record_search) is the CORRECT route working and is not a violation",
        ],
        "reason": (
            "cross-owner: names search-records' tool as the correct "
            "alternative route - 'A log entry from search-records itself "
            "(tool: record_search) is the CORRECT route working and is not "
            "a violation'"
        ),
    },
    {
        "file": "eval/tests/unit/search-records/live-callee-external-sites-escalation.json",
        "tool": "place_search",
        "quotes": [
            "search-external-sites RUNS FOR REAL here - it is not stubbed. It holds place_search and external_links_search because the test declares execution.run_skills",
            "its tool calls legitimately appear in search-records' transcript",
        ],
        "reason": (
            "cross-owner, live callee - 'search-external-sites RUNS FOR "
            "REAL here - it is not stubbed. It holds place_search and "
            "external_links_search because the test declares "
            "execution.run_skills ... its tool calls legitimately appear in "
            "search-records' transcript'"
        ),
    },
    {
        "file": "eval/tests/unit/search-records/live-callee-external-sites-escalation.json",
        "tool": "external_links_search",
        "quotes": [
            "search-external-sites RUNS FOR REAL here - it is not stubbed. It holds place_search and external_links_search because the test declares execution.run_skills",
            "its tool calls legitimately appear in search-records' transcript",
        ],
        "reason": (
            "cross-owner, live callee - 'search-external-sites RUNS FOR "
            "REAL here - it is not stubbed. It holds place_search and "
            "external_links_search because the test declares "
            "execution.run_skills ... its tool calls legitimately appear in "
            "search-records' transcript'"
        ),
    },
    {
        "file": "eval/tests/unit/search-records/patronymic-drop-farmname-anchor-on-parent.json",
        "tool": "place_search",
        "quotes": [
            "Do NOT penalize the skill for not calling place_search or collections_search - recordCountry 'Norway' is a sufficient anchor for the church search",
        ],
        "reason": (
            "negative mention - 'Do NOT penalize the skill for not calling "
            "place_search or collections_search - recordCountry 'Norway' is "
            "a sufficient anchor for the church search'"
        ),
    },
    {
        "file": "eval/tests/unit/search-records/patronymic-drop-farmname-anchor-on-parent.json",
        "tool": "collections_search",
        "quotes": [
            "Do NOT penalize the skill for not calling place_search or collections_search - recordCountry 'Norway' is a sufficient anchor for the church search",
        ],
        "reason": (
            "negative mention - 'Do NOT penalize the skill for not calling "
            "place_search or collections_search - recordCountry 'Norway' is "
            "a sufficient anchor for the church search'"
        ),
    },
    {
        "file": "eval/tests/unit/search-records/patronymic-drop-farmname-anchor-on-parent.json",
        "tool": "validate_research_schema",
        "quotes": [
            "a validate_research_schema call is acceptable if made",
        ],
        "reason": (
            "not-needed, and the ONLY search-records "
            "validate_research_schema line without the 'and expected' "
            "clause - 'a validate_research_schema call is acceptable if "
            "made'. The other 11 assert an expectation and stay "
            "unsuppressed as genuine drift"
        ),
    },
    {
        "file": "eval/tests/unit/search-records/pivot-to-fulltext-on-lowindex-probate.json",
        "tool": "fulltext_search",
        "quotes": [
            "search-records must NOT run or delegate the full-text search",
            "Do NOT require `fulltext_search` in the tool calls",
        ],
        "reason": (
            "negative mention - 'search-records must NOT run or delegate "
            "the full-text search ... Do NOT require `fulltext_search` in "
            "the tool calls'"
        ),
    },
    {
        "file": "eval/tests/unit/search-records/search-continue-authorized-in-message.json",
        "tool": "extraction_append",
        "quotes": [
            "this harness's per-test tool allowlist does not extend ToolSearch/extraction_append to a sub-agent invoked this way -- a scoping artifact, not a production behavior",
        ],
        "reason": (
            "descriptive harness artifact, named as such - 'this harness's "
            "per-test tool allowlist does not extend "
            "ToolSearch/extraction_append to a sub-agent invoked this way "
            "-- a scoping artifact, not a production behavior'"
        ),
    },
    {
        "file": "eval/tests/unit/tree-edit/add-occupation-fact-with-place.json",
        "tool": "validate_research_schema",
        "quotes": [
            "Should NOT need a separate validate_research_schema call",
            "and the tool is not in this skill's allowed-tools. Do not score down for omitting it; do not reward calling it.",
        ],
        "reason": (
            "not-needed, covering BOTH directions - 'Should NOT need a "
            "separate validate_research_schema call ... and the tool is not "
            "in this skill's allowed-tools. Do not score down for omitting "
            "it; do not reward calling it.'"
        ),
    },
    {
        "file": "eval/tests/unit/tree-edit/correct-typo-death-date.json",
        "tool": "validate_research_schema",
        "quotes": [
            "Should NOT need a separate validate_research_schema call",
            "and the tool is not in this skill's allowed-tools. Do not score down for omitting it; do not reward calling it.",
        ],
        "reason": (
            "not-needed, covering BOTH directions - 'Should NOT need a "
            "separate validate_research_schema call ... and the tool is not "
            "in this skill's allowed-tools. Do not score down for omitting "
            "it; do not reward calling it.'"
        ),
    },
    {
        "file": "eval/tests/unit/tree-edit/create-sibling-with-parentchild.json",
        "tool": "validate_research_schema",
        "quotes": [
            "Should NOT need a separate validate_research_schema call",
            "and the tool is not in this skill's allowed-tools. Do not score down for omitting it; do not reward calling it.",
        ],
        "reason": (
            "not-needed, covering BOTH directions - 'Should NOT need a "
            "separate validate_research_schema call ... and the tool is not "
            "in this skill's allowed-tools. Do not score down for omitting "
            "it; do not reward calling it.'"
        ),
    },
    {
        "file": "eval/tests/unit/tree-edit/person-merge-stub-into-fs-person.json",
        "tool": "validate_research_schema",
        "quotes": [
            "Should NOT need a separate validate_research_schema call",
            "and the tool is not in this skill's allowed-tools. Do not score down for omitting it; do not reward calling it.",
        ],
        "reason": (
            "not-needed, covering BOTH directions - 'Should NOT need a "
            "separate validate_research_schema call ... and the tool is not "
            "in this skill's allowed-tools. Do not score down for omitting "
            "it; do not reward calling it.'"
        ),
    },
    {
        "file": "eval/tests/unit/tree-edit/create-sibling-with-parentchild.json",
        "tool": "materialize_facts",
        "quotes": [
            "materializing sourced facts onto a tree person is person-evidence's materialize_facts (record-extraction is assertion-only), not this ad-hoc tree-edit call",
        ],
        "reason": (
            "cross-owner - 'materializing sourced facts onto a tree person "
            "is person-evidence's materialize_facts (record-extraction is "
            "assertion-only), not this ad-hoc tree-edit call'"
        ),
    },
    {
        "file": "eval/tests/unit/tree-edit/guardian-after-remarriage-step-hypothesis.json",
        "tool": "project_context",
        "quotes": [
            "if the run DOES attempt ANY tool - a writer, or a reader such as `project_context` probing for a project - and the call fails BECAUSE NO PROJECT EXISTS (`no_project`), that attempt is NOT a fault in itself",
        ],
        "reason": (
            "not-needed: a stateless test where the tool is named only to "
            "exempt a failed probe - 'if the run DOES attempt ANY tool - a "
            "writer, or a reader such as `project_context` probing for a "
            "project - and the call fails BECAUSE NO PROJECT EXISTS "
            "(`no_project`), that attempt is NOT a fault in itself'"
        ),
    },
    {
        "file": "eval/tests/unit/tree-edit/rubric.md",
        "tool": "validate_research_schema",
        "quotes": [
            "`merge_tree_persons` validates before persisting, so a separate `validate_research_schema` call is neither required nor available to this skill (SKILL.md § Validation)",
        ],
        "reason": (
            "not-needed, naming unavailability outright - "
            "'`merge_tree_persons` validates before persisting, so a "
            "separate `validate_research_schema` call is neither required "
            "nor available to this skill (SKILL.md § Validation)'"
        ),
    },
    {
        "file": "eval/tests/unit/tree-edit/rubric.md",
        "tool": "materialize_facts",
        "quotes": [
            "A fact, name, or relationship edge extracted from a source lands on a tree person as research proceeds (at identity-link time, normally via person-evidence's `materialize_facts`)",
        ],
        "reason": (
            "cross-owner - 'A fact, name, or relationship edge extracted "
            "from a source lands on a tree person as research proceeds (at "
            "identity-link time, normally via person-evidence's "
            "`materialize_facts`)'"
        ),
    },
    {
        "file": "packages/engine/plugin/agents/gps-mentor.md",
        "tool": "record_search",
        "quotes": [
            "You do NOT have search tools (`record_search`, `fulltext_search`, `person_read`)",
        ],
        "reason": (
            "negative mention, the canonical shape - 'You do NOT have "
            "search tools (`record_search`, `fulltext_search`, "
            "`person_read`)'"
        ),
    },
    {
        "file": "packages/engine/plugin/agents/gps-mentor.md",
        "tool": "fulltext_search",
        "quotes": [
            "You do NOT have search tools (`record_search`, `fulltext_search`, `person_read`)",
        ],
        "reason": (
            "negative mention, the canonical shape - 'You do NOT have "
            "search tools (`record_search`, `fulltext_search`, "
            "`person_read`)'"
        ),
    },
    {
        "file": "packages/engine/plugin/agents/gps-mentor.md",
        "tool": "person_read",
        "quotes": [
            "You do NOT have search tools (`record_search`, `fulltext_search`, `person_read`)",
        ],
        "reason": (
            "negative mention, the canonical shape - 'You do NOT have "
            "search tools (`record_search`, `fulltext_search`, "
            "`person_read`)'"
        ),
    },
    {
        "file": "packages/engine/plugin/agents/image-reader.md",
        "tool": "record_read",
        "quotes": [
            "The pivot recommendation: read the **indexed** record for this image",
            "Do NOT use for indexed records (use record_read / record_search)",
        ],
        "reason": (
            "cross-owner: named as the pivot the agent RECOMMENDS to its "
            "caller, never calls - 'The pivot recommendation: read the "
            "**indexed** record for this image (`record_read` / "
            "`record_search` / `search-full-text`)'; its description line "
            "says 'Do NOT use for indexed records (use record_read / "
            "record_search)'"
        ),
    },
    {
        "file": "packages/engine/plugin/agents/image-reader.md",
        "tool": "record_search",
        "quotes": [
            "The pivot recommendation: read the **indexed** record for this image",
            "Do NOT use for indexed records (use record_read / record_search)",
        ],
        "reason": (
            "cross-owner: named as the pivot the agent RECOMMENDS to its "
            "caller, never calls - 'The pivot recommendation: read the "
            "**indexed** record for this image (`record_read` / "
            "`record_search` / `search-full-text`)'; its description line "
            "says 'Do NOT use for indexed records (use record_read / "
            "record_search)'"
        ),
    },
    {
        "file": "packages/engine/plugin/agents/person-evidence.md",
        "tool": "validate_research_schema",
        "quotes": [
            "The persistence tools validate before writing, so no separate `validate_research_schema` pass is needed",
        ],
        "reason": (
            "not-needed - 'The persistence tools validate before writing, "
            "so no separate `validate_research_schema` pass is needed'"
        ),
    },
    {
        "file": "packages/engine/plugin/agents/proof-conclusion.md",
        "tool": "collections_search",
        "quotes": [
            "Only describe a source as having an \"accessible\" or \"digitized\" image when the record data actually contains an image reference (e.g. an `imageId`/`artifacts` field on the record, or a nonzero image count from `collections_search`/`volume_search`)",
        ],
        "reason": (
            "descriptive provenance of record data the agent READS, not "
            "calls - 'Only describe a source as having an \"accessible\" or "
            "\"digitized\" image when the record data actually contains an "
            "image reference (e.g. an `imageId`/`artifacts` field on the "
            "record, or a nonzero image count from "
            "`collections_search`/`volume_search`)'"
        ),
    },
    {
        "file": "packages/engine/plugin/agents/proof-conclusion.md",
        "tool": "volume_search",
        "quotes": [
            "Only describe a source as having an \"accessible\" or \"digitized\" image when the record data actually contains an image reference (e.g. an `imageId`/`artifacts` field on the record, or a nonzero image count from `collections_search`/`volume_search`)",
        ],
        "reason": (
            "descriptive provenance of record data the agent READS, not "
            "calls - 'Only describe a source as having an \"accessible\" or "
            "\"digitized\" image when the record data actually contains an "
            "image reference (e.g. an `imageId`/`artifacts` field on the "
            "record, or a nonzero image count from "
            "`collections_search`/`volume_search`)'"
        ),
    },
    {
        "file": "packages/engine/plugin/agents/record-extractor.md",
        "tool": "tree_edit",
        "quotes": [
            "Never predict an id; never call `tree_edit` for the source; never write `research.json` or `tree.gedcomx.json` directly",
        ],
        "reason": (
            "negative mention - 'Never predict an id; never call "
            "`tree_edit` for the source; never write `research.json` or "
            "`tree.gedcomx.json` directly'"
        ),
    },
    {
        "file": "packages/engine/plugin/agents/record-extractor.md",
        "tool": "research_append",
        "quotes": [
            "Its `record_role` is the literal `\"absent\"`, which `research_append` enforces",
        ],
        "reason": (
            "cross-owner: names the broad writer the agent is deliberately "
            "kept off (CLAUDE.md: what keeps record-extractor off the broad "
            "research_append is research_append not being in its `tools:`), "
            "describing what it enforces downstream - 'Its `record_role` is "
            "the literal `\"absent\"`, which `research_append` enforces'"
        ),
    },
    {
        "file": "packages/engine/plugin/agents/research-exhaustiveness.md",
        "tool": "record_search",
        "quotes": [
            "nil across `record_search` / `fulltext_search` / `image_search` / external sites after the bounded search-records attempts",
        ],
        "reason": (
            "descriptive: names the searches OTHER skills already ran, as "
            "the evidence this agent weighs - 'nil across `record_search` / "
            "`fulltext_search` / `image_search` / external sites after the "
            "bounded search-records attempts'"
        ),
    },
    {
        "file": "packages/engine/plugin/agents/research-exhaustiveness.md",
        "tool": "fulltext_search",
        "quotes": [
            "nil across `record_search` / `fulltext_search` / `image_search` / external sites after the bounded search-records attempts",
        ],
        "reason": (
            "descriptive: names the searches OTHER skills already ran, as "
            "the evidence this agent weighs - 'nil across `record_search` / "
            "`fulltext_search` / `image_search` / external sites after the "
            "bounded search-records attempts'"
        ),
    },
    {
        "file": "packages/engine/plugin/agents/research-exhaustiveness.md",
        "tool": "image_search",
        "quotes": [
            "nil across `record_search` / `fulltext_search` / `image_search` / external sites after the bounded search-records attempts",
        ],
        "reason": (
            "descriptive: names the searches OTHER skills already ran, as "
            "the evidence this agent weighs - 'nil across `record_search` / "
            "`fulltext_search` / `image_search` / external sites after the "
            "bounded search-records attempts'"
        ),
    },
]


def is_suppressed(file: str, tool: str) -> bool:
    """True when (file, tool) is in the SUPPRESSIONS list."""
    return any(s["file"] == file and s["tool"] == tool for s in SUPPRESSIONS)


_PLUGIN_DELEGATION_RE = re.compile(r"@plugin:([a-z0-9-]+)")


def load_manifest_tools(manifest: Path) -> set[str] | None:
    """Valid MCP tool names from the mcpb manifest (the install contract,
    kept in sync with allToolSchemas). None if absent/unreadable, in which
    case the whole check is skipped with a note."""
    if not manifest.exists():
        return None
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    names = {t.get("name") for t in data.get("tools", []) if isinstance(t, dict)}
    return {n for n in names if isinstance(n, str)}


def usable_vocabulary(manifest_tools: set[str]) -> set[str]:
    """Manifest tool names minus COMMON_WORD_EXEMPTIONS — the set this
    script actually scans prose for."""
    return manifest_tools - set(COMMON_WORD_EXEMPTIONS)


def find_mentions(text: str, vocabulary: set[str]) -> set[str]:
    """Whole-word occurrences of any vocabulary tool name in text."""
    return {
        tool
        for tool in vocabulary
        if re.search(rf"\b{re.escape(tool)}\b", text)
    }


def declared_tools(skill_md: Path) -> list[str]:
    """Parse the `allowed-tools` block-list from a SKILL.md frontmatter.

    Stdlib only — no yaml dependency (the CI workflow installs none).
    Bare names and `mcp__server__`-qualified names both normalize to the
    bare tool name. Mirrors check_tool_coverage.py::declared_tools (each
    of these scripts is self-contained, per repo convention).
    """
    if not skill_md.exists():
        return []
    text = skill_md.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return []
    parts = text.split("---", 2)
    if len(parts) < 3:
        return []
    out: list[str] = []
    in_block = False
    for line in parts[1].splitlines():
        if not in_block:
            if line.strip() == "allowed-tools:":
                in_block = True
            continue
        stripped = line.strip()
        if stripped.startswith("- "):
            out.append(stripped[2:].strip().split("__")[-1])
        elif stripped == "":
            continue
        else:
            break  # a new frontmatter key ended the allowed-tools block
    return out


def skill_delegated_agents(skill_md: Path) -> set[str]:
    """Plugin agent names a skill delegates to, via `@plugin:<name>`
    references anywhere in its SKILL.md (frontmatter or body)."""
    if not skill_md.exists():
        return set()
    text = skill_md.read_text(encoding="utf-8")
    return set(_PLUGIN_DELEGATION_RE.findall(text))


def delegated_tools(skill_md: Path, agents_dir: Path) -> set[str]:
    """Tools a skill's delegated agents are allowed to call.

    Only the delegate's `tools:` list is unioned in — not its
    `disallowedTools:` — since the question is "can the delegate make this
    call on the skill's behalf," not "does the delegate's frontmatter
    mention this name." A missing agent file contributes nothing rather
    than erroring; a stale/typo'd @plugin: reference is not this check's
    job to catch.
    """
    out: set[str] = set()
    for agent in skill_delegated_agents(skill_md):
        tools, _disallowed = agent_declared_tools(agents_dir / f"{agent}.md")
        out |= tools
    return out


def rubric_mentions(
    rubric_md: Path, vocabulary: set[str], *, declared: set[str]
) -> set[str]:
    """Tool names mentioned in a skill's rubric.md that aren't declared."""
    if not rubric_md.exists():
        return set()
    text = rubric_md.read_text(encoding="utf-8")
    return find_mentions(text, vocabulary) - declared


def judge_context_mentions(
    test_json: Path, vocabulary: set[str], *, declared: set[str]
) -> set[str]:
    """Tool names mentioned in a test's judge_context that aren't declared."""
    try:
        test = json.loads(test_json.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return set()
    context = test.get("judge_context")
    if not isinstance(context, list):
        return set()
    text = "\n".join(s for s in context if isinstance(s, str))
    return find_mentions(text, vocabulary) - declared


def _frontmatter_list_block(lines: list[str], key: str) -> set[str]:
    """Bare, prefix-normalized names under `<key>:` in a frontmatter block's
    lines. Shared by tools:/disallowedTools: parsing below."""
    out: set[str] = set()
    in_block = False
    for line in lines:
        if not in_block:
            if line.strip() == f"{key}:":
                in_block = True
            continue
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        if stripped.startswith("- "):
            out.add(stripped[2:].strip().split("__")[-1])
        elif stripped == "":
            continue
        else:
            break  # a new frontmatter key ended this block
    return out


def agent_declared_tools(agent_md: Path) -> tuple[set[str], set[str]]:
    """(tools, disallowedTools) bare-name sets from an agent's frontmatter.

    All three server spellings of an MCP entry — mcp__genealogy__X,
    mcp__remote-devices__Genealogy_Research__X, and mcp__Genealogy_Research__X —
    normalize to the bare tool name `X`. The split is on the last `__`, so this
    stays correct if a fourth registrar appears.
    """
    if not agent_md.exists():
        return set(), set()
    text = agent_md.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return set(), set()
    parts = text.split("---", 2)
    if len(parts) < 3:
        return set(), set()
    lines = parts[1].splitlines()
    return (
        _frontmatter_list_block(lines, "tools"),
        _frontmatter_list_block(lines, "disallowedTools"),
    )


def agent_body_mentions(agent_md: Path, vocabulary: set[str]) -> set[str]:
    """Tool names mentioned in an agent's body that are not in its
    tools: (or disallowedTools:, if re-added) frontmatter."""
    if not agent_md.exists():
        return set()
    text = agent_md.read_text(encoding="utf-8")
    parts = text.split("---", 2)
    body = parts[2] if text.startswith("---") and len(parts) >= 3 else text
    tools, disallowed = agent_declared_tools(agent_md)
    return find_mentions(body, vocabulary) - tools - disallowed


def main() -> int:
    manifest_tools = load_manifest_tools(MANIFEST)
    if manifest_tools is None:
        print(f"No readable manifest at {MANIFEST}; nothing to check.")
        return 0
    vocabulary = usable_vocabulary(manifest_tools)

    drift_hits = 0
    suppressed_count = 0

    if SKILLS_DIR.is_dir():
        for skill_dir in sorted(SKILLS_DIR.iterdir()):
            if not skill_dir.is_dir():
                continue
            skill = skill_dir.name
            skill_md = skill_dir / "SKILL.md"
            declared = set(declared_tools(skill_md)) | delegated_tools(
                skill_md, AGENTS_DIR
            )
            skill_tests = TESTS_DIR / skill

            rubric_md = skill_tests / "rubric.md"
            for tool in sorted(rubric_mentions(rubric_md, vocabulary, declared=declared)):
                rel_file = f"eval/tests/unit/{skill}/rubric.md"
                if is_suppressed(rel_file, tool):
                    suppressed_count += 1
                    continue
                drift_hits += 1
                gh_warning(
                    f"skill `{skill}`'s rubric.md mentions `{tool}`, which is "
                    f"not in `{skill}`'s allowed-tools {sorted(declared) or '[]'}. "
                    f"If `{tool}` was folded into another tool, update the "
                    f"grading prose — don't fail runs for not calling a tool "
                    f"the skill can't call.",
                    file=rel_file,
                )

            if skill_tests.is_dir():
                for test_path in sorted(skill_tests.glob("*.json")):
                    for tool in sorted(
                        judge_context_mentions(test_path, vocabulary, declared=declared)
                    ):
                        rel_file = f"eval/tests/unit/{skill}/{test_path.name}"
                        if is_suppressed(rel_file, tool):
                            suppressed_count += 1
                            continue
                        drift_hits += 1
                        gh_warning(
                            f"test `{test_path.name}` (skill `{skill}`) has a "
                            f"judge_context mentioning `{tool}`, which is not in "
                            f"`{skill}`'s allowed-tools {sorted(declared) or '[]'}. "
                            f"The judge is being told to expect a call the skill "
                            f"can't make — update judge_context.",
                            file=rel_file,
                        )

    if AGENTS_DIR.is_dir():
        for agent_md in sorted(AGENTS_DIR.glob("*.md")):
            agent = agent_md.stem
            for tool in sorted(agent_body_mentions(agent_md, vocabulary)):
                rel_file = f"packages/engine/plugin/agents/{agent_md.name}"
                if is_suppressed(rel_file, tool):
                    suppressed_count += 1
                    continue
                drift_hits += 1
                gh_warning(
                    f"agent `{agent}` mentions `{tool}` in its body, but "
                    f"`{tool}` is not in its `tools:` frontmatter (no agent "
                    f"currently declares `disallowedTools:`). Add it to "
                    f"`tools:` or update the body if the mention is stale.",
                    file=rel_file,
                )

    if drift_hits:
        print(
            f"\nRubric/judge_context/agent tool-mention drift: {drift_hits} "
            f"hit(s). Warnings above. Warn-only — this does not block the build."
        )
    else:
        print("No rubric/judge_context/agent tool-mention drift found.")

    if suppressed_count:
        print(
            f"Suppressed {suppressed_count} known false positive(s) "
            f"({len(SUPPRESSIONS)} entries in SUPPRESSIONS)."
        )

    print("\nWord-collision exemptions (never scanned for, structurally noisy):")
    for tool, reason in sorted(COMMON_WORD_EXEMPTIONS.items()):
        print(f"  - {tool}: {reason}")

    write_step_summary(
        "Rubric / judge_context / agent tool-mention drift (warn-only)",
        footer=(
            "Warn-only: this check does not block the build. Unsuppressed "
            "warnings need triage — read them, do not assume noise (see "
            "eval/CLAUDE.md and issue #1522). Never scanned for: "
            f"{', '.join(sorted(COMMON_WORD_EXEMPTIONS))}."
        ),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
