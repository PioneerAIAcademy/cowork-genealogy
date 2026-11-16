"""Direct tests for `test_research.test_reply_links_named_sources`.

The validator runs only on a test tagged `links-sources`. The failing replies are the
two from feedback #4561 (issue #4582), verbatim, plus other shapes a reply can carry
the same fault in; the passing replies are the ones a correct run writes. `testpaths`
excludes `validators/`, which is why they live here.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import test_reply_links_named_sources as check  # noqa: E402

TAGGED = {"skill": "research", "tags": ["no-project", "links-sources"]}
ARK_URL = "https://www.familysearch.org/ark:/61903/3:1:3QHN-BQ8C-33BG"
FILM_URL = "https://www.familysearch.org/search/film/113551215?i=2"


def _transcribe(viewer_url: str = ARK_URL) -> dict:
    return {
        "tool": "mcp__genealogy__image_transcribe",
        "args": {"ark": "ark:/61903/3:1:3QHN-BQ8C-33BG"},
        "response": {"transcription": "5\n\nPhilip Eastman jun & Elizabeth Hodges", "viewerUrl": viewer_url},
    }


def _catalog(*group_numbers: str) -> dict:
    return {
        "tool": "mcp__genealogy__catalog_search",
        "args": {"keywords": "Ashford vital records"},
        "response": {
            "results": [{"title": "Town records", "filmNotes": [{"imageGroupNumber": g} for g in group_numbers]}]
        },
    }


READ = [_transcribe()]

# Feedback #4561, session 1: the main thread's own "Sources consulted" list.
SOURCES_CONSULTED = """**Sources consulted:**
- FamilySearch image ark:/61903/3:1:3QHN-BQ8C-33BG (Ashford vital register, page 5)
- FamilySearch image ark:/61903/3:1:3QHN-TQ2K-9B47 (page 209)
- FamilySearch image ark:/61903/3:1:3QHV-JQ56-WTQK (page 19)
- FamilySearch image ark:/61903/3:1:3Q9M-C9BT-D9VV-3 (pages 298–299, tabular transcription)"""

# Feedback #4561, session 2: group 113551215 came from volume_search, never catalog_search.
CATALOG_ITEM = (
    "**Catalog item:** FamilySearch imageGroupNumber 113551215, image 3 "
    "(viewer: familysearch.org/search/film/113551215?i=2)"
)


@pytest.mark.parametrize(
    ("reply", "calls", "agent_text"),
    [
        (SOURCES_CONSULTED, READ, ""),
        (SOURCES_CONSULTED + f"\n\nTranscribed: [page 5]({ARK_URL})", READ, ""),
        (CATALOG_ITEM + f"\n\n[Page 5]({ARK_URL})", READ, ""),
        (f"**Catalog item:** image group 113551215\n\n[Page 5]({ARK_URL})", READ, ""),
        (
            f"**Catalog item:** image group 113551215\n\n[Page 5]({ARK_URL})",
            READ,
            "Found Vol. 4: imageGroupNumber 113551215, Catalog item",
        ),
        (f"- Phebe, daughter of Philip (113551215_00003)\n\n[Page 5]({ARK_URL})", READ, ""),
        (f"[Page 5](ark:/61903/3:1:3QHN-BQ8C-33BG) and [again]({ARK_URL})", READ, ""),
        (f"| Mary | ark:/61903/3:1:3QHN-BQ8C-33BG |\n\n[Page 5]({ARK_URL})", READ, ""),
        (f"- Moses Dustin, Captain (00412)\n\n[Page 5]({ARK_URL})", READ, ""),
        (f"Read images 00412–00413.\n\n[Page 5]({ARK_URL})", READ, ""),
        (f"Open it at www.familysearch.org/search/film/113551215?i=2 ([Page 5]({ARK_URL}))", READ, ""),
        ("Mary, Phebe and Esther are the daughters recorded on page 5.", READ, ""),
        ("I could not read the page.", [], ""),
    ],
    ids=[
        "a-feedback-sources-consulted",
        "a2-feedback-sources-consulted-beside-a-link",
        "b-feedback-catalog-item-line",
        "c-catalog-item-no-catalog-search",
        "d-catalog-item-only-in-an-agent-return",
        "e-bare-image-id-in-a-bullet",
        "f-link-whose-target-is-a-bare-ark",
        "g-bare-ark-in-a-table-cell",
        "h-short-page-in-parentheses",
        "i-short-page-range",
        "j-schemeless-url",
        "k-no-citation-at-all",
        "l-nothing-read",
    ],
)
def test_an_unlinked_source_fires(reply, calls, agent_text):
    del agent_text  # the validator takes no agent_returns: relayed text is not evidence
    with pytest.raises(AssertionError):
        check(reply, calls, TAGGED)


@pytest.mark.parametrize(
    ("reply", "calls"),
    [
        (f"Page 5: [ark:/61903/3:1:3QHN-BQ8C-33BG]({ARK_URL})", READ),
        ("Page 5: https://familysearch.org/ark:/61903/3:1:3QHN-BQ8C-33BG", READ),
        (f"Page 5: {ARK_URL}", READ),
        (f"- Phebe, daughter of Philip ([113551215_00003]({FILM_URL}))", [_transcribe(FILM_URL)]),
        (f"Image group 113551215 (not a Catalog item). [Page 5]({FILM_URL})", [_transcribe(FILM_URL)]),
        (f"**Catalog item:** image group 113551215. [Page 5]({FILM_URL})", [_transcribe(FILM_URL), _catalog("113551215")]),
        (f"**Catalog item:** image group 008246133. [Page 5]({ARK_URL})", [*READ, _catalog("8246133")]),
        (f"Philip Eastman (1777) appears in the 1850 census (1850). [Page 5]({ARK_URL})", READ),
        (f"Born 1845 (1850 census). [Page 5]({ARK_URL})", READ),
        (
            "Page 5: [link](https://www.familysearch.org/ark:/61903/3:1:3QHN-BQ8C-33BG)",
            [_transcribe("https://familysearch.org/ark:/61903/3:1:3QHN-BQ8C-33BG")],
        ),
    ],
    ids=[
        "a-link-texted-ark",
        "b-no-www-url",
        "c-plain-https-url",
        "d-image-id-as-link-text",
        "e-negated-catalog-item",
        "f-catalog-item-catalog-search-returned",
        "g-catalog-item-leading-zeros",
        "h-years-in-parentheses",
        "i-census-year-in-parentheses",
        "j-www-differs-from-viewer-url",
    ],
)
def test_a_linked_source_passes(reply, calls):
    check(reply, calls, TAGGED)


def test_an_untagged_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check(SOURCES_CONSULTED, READ, {"skill": "research", "tags": ["no-project"]})
