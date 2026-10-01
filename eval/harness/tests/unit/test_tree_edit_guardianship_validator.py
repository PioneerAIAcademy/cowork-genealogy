"""Direct tests for tree-edit's guardianship leading-reading validator.

Same reason as `test_init_project_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and this check's real pass/fail set would otherwise
appear only inside a paid per-skill run.

Every reply below is **verbatim** from a captured `ut_tree_edit_014` run --
the five committed run logs plus the three scratch runs of 2026-09-22 filed
on issue #2449. Nothing is tidied: the em dashes, the bold markers and the
table pipes are what the model actually emitted, and they are what the
splitter has to survive.

The violating reply is `v1_2026-09-15_05-34-57`, whose human annotation
upheld Correctness 1 and Completeness 1 -- "That reverses the required
determination." It weights the readings twice, once in a comparison table
and once in prose, which is why both units are pinned separately.
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix on purpose: pytest would otherwise
# collect the imported validator as a test of this module and error on its
# harness-supplied fixtures. Same pattern as test_init_project_validator.py.
from test_tree_edit import (  # noqa: E402
    test_step_reading_leads_when_the_surname_is_unresolved as check_leads,
    test_uncle_reading_is_named_at_all as check_uncle,
)


TAGS = {"tags": ["tree-edit", "relationship-accuracy", "guardianship",
                 "step-relation", "relationship-subtype", "issue-1900"]}

# --- verbatim from v1_2026-09-15_05-34-57 (the inverted run) ----------

_INVERTED_TABLE_ROW = '| **Uncle by marriage** (favoured) | "Watts" is Nancy\'s **maiden** name | Children are likely her brother\'s orphans; Ridley is their uncle by marriage |'

_INVERTED_PROSE = "Everything you have recorded points toward Nancy's maiden name being Watts — she appears as *Nancy Watts* before the November 1820 marriage. That makes the **uncle-by-marriage reading the favoured one**: a Watts father (probably Nancy's brother or father) died, and the Amherst County court appointed Ridley — a new son-in-law of the family, an adult householder — to manage the minors' property. That is exactly the routine purpose a county guardianship bond served in Virginia."

# --- verbatim from v1_2026-09-14_18-51-07 (a passing run) -------------

_BOTH_WEIGHED_TOGETHER = "The bond does not distinguish these. What resolves it is **Nancy's earlier history**: if she has a maiden name other than Watts, the stepparent reading leads; if Watts is her maiden name, the uncle-by-marriage hypothesis stays open."


def test_fires_on_the_observed_prose_inversion():
    """The sentence the annotator failed the run for."""
    with pytest.raises(AssertionError, match="favoured one"):
        check_leads(_INVERTED_PROSE, TAGS)


def test_fires_on_the_observed_table_row_alone():
    """The same run weighted the readings a second time, in a table.

    Pinned separately so a regression that reached only prose still reds.
    """
    with pytest.raises(AssertionError, match="uncle-by-marriage"):
        check_leads(_INVERTED_TABLE_ROW, TAGS)


def test_passes_on_a_row_whose_cells_qualify_each_other():
    """Constructed, not captured -- no run in the corpus has this shape yet.

    A row is held whole because sentence-splitting inside one can cut "not
    favoured" away from the clause that qualifies it, leaving a fragment
    that names uncle beside a lead marker with no step in sight. This row
    is correct and must pass; under a splitter that breaks rows on
    sentence punctuation it fires spuriously.
    """
    check_leads(
        "| **Uncle by marriage** | not favoured. The step reading leads. |",
        TAGS,
    )


def test_passes_when_one_sentence_ranks_step_above_uncle():
    """Constructed, not captured -- and the reason the `not step` arm exists.

    No unit in any captured reply names both readings beside a lead marker,
    so nothing in the corpus exercises this arm. But it is the most natural
    way to write the correct answer in one breath, and without the arm the
    check reds it.
    """
    check_leads(
        "The step reading leads over the uncle-by-marriage alternative, "
        "which the bond does not rule out.",
        TAGS,
    )


def test_passes_when_both_readings_are_weighed_together():
    """Prove the other direction, per CLAUDE.md.

    This line names uncle AND a lead marker AND step, all in one sentence --
    the shape of a correct answer that holds the question open. A check that
    fired on "uncle near a lead word" would red every good run.
    """
    check_leads(_BOTH_WEIGHED_TOGETHER, TAGS)


def test_passes_when_uncle_is_named_without_being_favoured():
    """Naming the alternative is required by the reference, not a fault."""
    check_leads(
        "The step reading leads. The uncle-by-marriage reading is not yet "
        "ruled out; her prior marriage would settle it.",
        TAGS,
    )


def test_fires_when_step_is_named_only_in_a_different_sentence():
    """The guard is per-unit, not per-document.

    A reply that favours uncle in one breath and mentions step somewhere
    else entirely has still inverted the weighting. A document-level
    "does the word step appear" check would pass this.
    """
    with pytest.raises(AssertionError, match="favoured"):
        check_leads(
            "The uncle-by-marriage reading is favoured here. A stepfather "
            "would also be appointed guardian in the ordinary course.",
            TAGS,
        )


# --- verbatim from scratch_2026-09-28_11-00-31 run 2 (a correct reply) ---
# Leads with step in prose, but writes each surname branch as its own
# "If ..." bullet. The uncle bullet carries "more likely" and no "step",
# and was red on that alone before the conditional-branch exemption.
REPLY_CONDITIONAL_BRANCHES = 'There\'s no active research project here, so I\'m answering as a standalone advisory question — nothing to write yet. The answer is governed directly by the "Guardianship shortly after a remarriage" section of the relationship-accuracy reference, which addresses this exact pattern. Here is the full reasoning.\n\n---\n\n## What to record, and why\n\n### The relationship type: ParentChild — four edges, Ridley as parent\n\nA guardianship bond is a legal document establishing Ridley Stribling\'s authority over the four Watts children\'s persons and property. That is a parent-surrogate role, and the GedcomX model for it is a **ParentChild** relationship — one edge per child, Ridley on the parent side, each Watts minor on the child side.\n\n### The subtype: **none — leave it empty**\n\nThis is the critical point. The reference is explicit:\n\n> "Write the parent-child edge with **no subtype at all** — a `Step` subtype on the bond-plus-marriage pair alone fails the threshold above."\n\nHere is why neither candidate subtype clears the bar:\n\n| Subtype | Why it fails here |\n|---|---|\n| **Biological** | Nothing in the record suggests Ridley is their biological father. He has a different surname. |\n| **Step** | Strongly suggested by timing, but the bond does not say it. |\n| **Adoptive / Foster** | No evidence of adoption or foster placement. |\n\nThe threshold for asserting a *specific* subtype is that the record (or a prior proof conclusion) actually states the nature of the connection. A guardianship bond combined with a recent marriage is *circumstantial* evidence pointing toward step-parentage — it is a hypothesis about the subtype, not evidence of it.\n\n---\n\n## The two competing hypotheses\n\nThe reference identifies exactly this fork:\n\n> "If the wife\'s shared surname is a **married** name, the children are most likely hers and the step reading leads. If it is her **maiden** name, they may instead be her brother\'s orphans — the same bond, with the guardian an uncle by marriage."\n\nNancy married Ridley Stribling in November 1820 using the name **Watts**. That name is ambiguous at the marriage record alone:\n\n- **If "Watts" was Nancy\'s prior married name** (she was a widow): John, Mary, Elizabeth, and Thomas are almost certainly her children by that prior husband → Ridley is their **stepfather**.\n- **If "Watts" was Nancy\'s maiden name** (she was never previously married): the children are more likely her deceased brother\'s orphans → Ridley is their **uncle by marriage**, appointed because he is the closest responsible male relative now connected to the Watts family.\n\nThe reference says the **step reading leads** because it explains the *timing* — the remarriage is the natural occasion for the new husband to take charge of property the children inherited from their deceased father. The uncle reading has to treat the guardianship and the marriage as coincidental. But "leads" is not "proved," which is why no subtype goes on the edge yet.\n\n---\n\n## What to write when you do make the edits\n\nFour `add_relationship` calls, all identical in structure:\n\n```\ntype: "ParentChild"\nparent: <Ridley Stribling\'s person id>\nchild: <each Watts child\'s person id>\n// no subtype field\nsourceAssertionId: <the parentchild or relationship assertion from the guardianship bond>\n```\n\nDo **not** add a corresponding Nancy → Watts-child edge unless you have a source that establishes her maternity. The reference is explicit:\n\n> "Do not compensate by asserting the **mother\'s** edge as Genetic either; her maternity rests on the same surname correspondence and gets the same treatment."\n\n---\n\n## What research would settle it\n\n1. **Nancy\'s prior marriage record** — if one exists, it names the husband and dates the marriage; a Watts surname from a prior marriage makes her the children\'s mother and the step reading conclusive.\n2. **The deceased father\'s estate or probate records** — a guardian is most often appointed over property the children inherited. The estate will name the father and confirm whether he was a Watts. It may also name the children\'s mother.\n3. **An earlier appearance of the Watts children** — a pre-1821 tax list or deed naming a Watts household with these children would identify the father directly.\n\nOnce any of those is found and extracted, return here and the correct subtype can be written.'


def test_passes_a_reply_whose_uncle_branch_is_an_if_clause():
    """GREEN direction, captured: a hypothesis branch is not a verdict."""
    check_leads(REPLY_CONDITIONAL_BRANCHES, TAGS)


def test_passes_a_prose_if_sentence_weighting_the_uncle_branch():
    """The same exemption when the branch is a sentence, not a bullet."""
    check_leads(
        "If Watts was her maiden name, the uncle reading is more likely.",
        TAGS,
    )


def test_fires_on_an_unconditional_uncle_verdict_beside_if_bullets():
    """RED direction: the exemption is per unit, so an "If" bullet
    elsewhere does not excuse a verdict that favours uncle outright."""
    with pytest.raises(AssertionError, match="favoured"):
        check_leads(
            "- **If Watts was a married name**: Ridley is a stepfather.\n"
            "- **If Watts was her maiden name**: Ridley is an uncle.\n\n"
            "On balance the uncle reading is favoured.",
            TAGS,
        )


def test_fires_when_if_appears_mid_unit_not_at_its_head():
    """RED direction: only a unit that OPENS with "If" is a branch. A
    verdict with a trailing conditional clause is still a verdict."""
    with pytest.raises(AssertionError, match="favoured"):
        check_leads(
            "- The uncle reading is favoured, even if Watts was a married name.",
            TAGS,
        )


@pytest.mark.parametrize("reply", [
    # The premise settled in one sentence, the verdict hung on "If so".
    "Nancy's maiden name is Watts. If so, the uncle reading is favoured.",
    "If anything, the uncle-by-marriage reading is stronger.",
    "If I had to choose, the uncle reading leads.",
    # A bullet held whole: only its conditioned first sentence is exempt.
    "- **If Watts was her maiden name**: Ridley is an uncle. The record "
    "points that way, so the uncle reading is favoured.",
    # Table rows are never exempt, whatever their first cell says.
    "| If maiden name (our reading) | **Uncle by marriage** (favoured) |",
])
def test_fires_on_a_verdict_that_only_looks_conditional(reply):
    """RED direction: an opener that does not condition on the surname
    premise, or a verdict riding after a branch, is still a verdict."""
    with pytest.raises(AssertionError, match="uncle-by-marriage"):
        check_leads(reply, TAGS)


@pytest.mark.parametrize("reply", [
    "Should Watts be her maiden name, the uncle reading is more likely.",
    "Were Watts her maiden name, the uncle reading would be stronger.",
    "Assuming Watts is her maiden name, the uncle reading is more likely.",
    "If Watts was her maiden name: the uncle reading is more likely.",
    "If she was a widow, a stepfather; if never married, the uncle "
    "reading is more likely.",
])
def test_passes_other_spellings_of_a_surname_branch(reply):
    """GREEN direction: the same branch written without a bare leading
    "If ...," must not fire, or the exemption gets widened by hand."""
    check_leads(reply, TAGS)


def test_skips_a_test_without_the_guardianship_tag():
    """Tag-gated: no other tree-edit test discusses either reading, so an
    ungated version would scan replies that cannot satisfy it."""
    with pytest.raises(pytest.skip.Exception):
        check_leads(_INVERTED_PROSE, {"tags": ["tree-edit", "merge"]})


def test_skips_an_empty_reply():
    """A run that said nothing is a different defect, owned elsewhere."""
    with pytest.raises(pytest.skip.Exception):
        check_leads("   ", TAGS)


# --- verbatim from v1_2026-09-22_17-41-42 (names NEITHER reading) -----
# The first run taken after the reference began saying the step reading
# leads. `uncle` appears 0 times; the five runs predating the change had
# 2, 2, 1, 3 and 5. The judge scored it Completeness 3 anyway.
REPLY_NAMES_NEITHER = "There's no initialized project here, so I'll answer this as a standing genealogical guidance question — the advice is the same regardless.\n\n---\n\n## Do not record a parent-child relationship\n\nA guardianship bond appoints a legal custodian for minors whose father has died. It does **not** assert biological, adoptive, step, or any other parental connection. Recording a `ParentChild` relationship — with any subtype — between Ridley Stribling and these four children would misrepresent what the source actually says.\n\n### What the bond *does* establish\n\nThe source proves a **guardian–ward** relationship: Ridley was legally responsible for John, Mary, Elizabeth, and Thomas Watts. If your tree supports a dedicated `Guardian` relationship type, that is the correct edge to record, citing the 1821 Amherst County guardianship bond.\n\n### What it strongly implies but does not prove\n\nThe surname overlap is significant. Ridley married **Nancy Watts** in November 1820, and within months he was appointed guardian of four **Watts** minors. The most common Virginia pattern is:\n\n- Nancy was a widow of a prior Mr. Watts, and these are **her children from that marriage**. When she remarried, the orphan's court appointed her new husband guardian of the fatherless minors.\n\nIf that inference is correct, then:\n\n| Relationship | Type | Subtype | Source needed |\n|---|---|---|---|\n| Nancy → each child | ParentChild | *(biological — but only once proved)* | Birth / baptism records, earlier census, prior Watts estate records |\n| Ridley → each child | ParentChild | **Step** | *Derives from proving Nancy is the mother; not from the bond itself* |\n\nNeither of those parent-child edges should be written yet. The bond alone does not close either inference.\n\n### Recommended next steps\n\n1. **Search for a prior Watts husband** — an estate or administration record in Amherst County circa 1818–1821 for a deceased Mr. Watts would name his widow and orphaned children, directly linking Nancy and the four minors.\n2. **Check the 1820 census** — if a Watts household in Amherst County enumerated a widow with minors, that corroborates the scenario.\n3. Once Nancy's maternity and the prior Watts marriage are proved, record:\n   - `ParentChild` (biological) between Nancy and each child\n   - `ParentChild` (step) between Ridley and each child\n   - Both citing the supporting sources, not just the guardianship bond\n\nUntil that research is done, the only defensible tree entry from this document is the guardian relationship."

# --- verbatim from v1_2026-09-14_18-51-07 (names both, weighs both) ---
REPLY_NAMES_UNCLE = 'Let me read the reference materials and project files before advising or touching anything.\n\nThere\'s no `tree.gedcomx.json` yet, so I can\'t make edits — but the question is an important analytical one, and the relationship-accuracy reference addresses this exact pattern directly. Let me give you the full picture.\n\n---\n\n## What the 1821 bond evidence actually establishes\n\nThe combination of facts you have — **Ridley marries Nancy Watts in November 1820, then is appointed guardian of four Watts-surname minors in 1821** — is the textbook scenario covered in the guidance on *guardianship shortly after remarriage*.\n\nTwo readings are both consistent with the evidence:\n\n| Reading | Logic |\n|---|---|\n| **Stepfather** (favoured) | "Watts" was Nancy\'s *married* surname from a prior marriage; the children are hers by that first husband, now deceased. Ridley married the widow and was then appointed guardian of her minor children\'s property. |\n| **Uncle by marriage** | "Watts" was Nancy\'s *maiden* name; the children are her brother\'s orphans. Ridley, now connected to the Watts family by marriage, was appointed to manage their inheritance. |\n\nThe bond does not distinguish these. What resolves it is **Nancy\'s earlier history**: if she has a maiden name other than Watts, the stepparent reading leads; if Watts is her maiden name, the uncle-by-marriage hypothesis stays open.\n\n---\n\n## What subtype to record\n\n**None.** The `Step` subtype requires more than the bond-plus-marriage pair. The reference is explicit:\n\n> *"Write the parent-child edge with no subtype at all — a Step subtype on the bond-plus-marriage pair alone fails the threshold."*\n\nSimilarly, do **not** assert Nancy\'s edge to the children as `Genetic` — her maternity rests on the same surname correspondence and earns the same treatment: an edge, no subtype.\n\n---\n\n## Recommended edges to create (once you have a project)\n\nOnce the project files exist, record these four relationships — one per child:\n\n- **Ridley Stribling → John Watts** — `ParentChild`, **no subtype**\n- **Ridley Stribling → Mary Watts** — `ParentChild`, **no subtype**\n- **Ridley Stribling → Elizabeth Watts** — `ParentChild`, **no subtype**\n- **Ridley Stribling → Thomas Watts** — `ParentChild`, **no subtype**\n\nEach edge carries the guardianship bond as its source-ref. If you also add Nancy as a possible mother to the children (the stepparent reading), those four Nancy-child edges get the same treatment — no subtype, sourced to the same bond via surname correspondence.\n\n---\n\n## Research implications before asserting Step\n\nTo upgrade to a `Step` subtype (or to correctly record `Uncle` instead), look for:\n\n1. **Nancy\'s prior marriage record** — Does a Watts husband appear? When did he die?\n2. **The children\'s father\'s estate records** — An Amherst County estate or will for a deceased "Mr. Watts" naming these children as heirs is what most likely *drove* the guardianship appointment.\n3. **Nancy\'s maiden name** — A marriage bond or register for the Ridley–Nancy marriage may name her father; if her father\'s surname is not Watts, the stepparent reading is strongly supported.\n4. **The guardianship bond itself in full** — Virginia bonds sometimes name the children\'s deceased father or the nature of the property being managed.\n\nThe appointment alone establishes neither orphanhood nor a step-relation — it establishes that a court entrusted Ridley with the management of these minors\' property. That\'s the floor the subtype must build from, not the ceiling.'


def test_uncle_arm_fires_when_the_reply_names_neither_reading():
    """RED direction: the captured reply this PR shipped as its own
    evidence names neither reading, and the new arm catches it."""
    with pytest.raises(AssertionError, match="never names the uncle"):
        check_uncle(REPLY_NAMES_NEITHER, TAGS)


def test_uncle_arm_passes_a_reply_that_names_the_uncle_reading():
    """GREEN direction: a reply that does name the alternative passes.
    Without this the arm could be a bare `assert False` and still look
    like coverage."""
    check_uncle(REPLY_NAMES_UNCLE, TAGS)


def test_uncle_arm_passes_the_inverted_run():
    """The inverted run named uncle repeatedly -- it weighted it WRONGLY,
    which is `check_leads`'s job. This arm must not double-report it."""
    check_uncle(_INVERTED_TABLE_ROW, TAGS)


def test_uncle_arm_skips_a_test_without_the_guardianship_tag():
    """Same gate as the lead arm: a non-guardianship reply says nothing
    about this craft question and must not be graded on it."""
    with pytest.raises(BaseException) as exc:
        check_uncle(REPLY_NAMES_NEITHER, {"tags": ["tree-edit"]})
    assert exc.typename == "Skipped"


def test_uncle_arm_skips_an_empty_reply():
    """A run with no reply has nothing to weigh."""
    with pytest.raises(BaseException) as exc:
        check_uncle("   ", TAGS)
    assert exc.typename == "Skipped"


def test_uncle_gate_grades_the_agent_return_not_the_relay_on_the_direct_arm():
    # A relay that adds "uncle" must not pass an agent whose own return never
    # named the reading.
    direct = {**TAGS, "delegation": "Record the guardianship.\n\nprojectPath: <workspace>"}
    agent = [{"subagent_type": "tree-edit", "text": "The step reading leads: Nancy was a widow and these are her children."}]
    relay = "The agent says step leads; the uncle-by-marriage reading is still open."
    with pytest.raises(AssertionError):
        check_uncle(relay, direct, agent)
    check_uncle(relay + " x", {**TAGS}, None)  # routed arm: the reply IS the subject's

