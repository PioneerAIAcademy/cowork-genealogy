# Search External Sites Rubric

Grading dimensions for search-external-sites unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## URL generation

Did the skill generate a correctly pre-filled search URL for the target site (Ancestry, MyHeritage, etc.)? The URL should include the search parameters from the plan item.

- **pass:** Generated URL targets the correct site's search endpoint, includes all relevant search parameters from the plan item (name, date range, place), and is syntactically valid.
- **partial:** URL targets the right site but is missing a search parameter the plan item specified, or uses a less-effective query encoding.
- **fail:** URL targets the wrong site, has malformed query parameters, or omits the core search terms entirely.

## Capture guidance

Did the skill provide clear instructions for the click-capture workflow? The user needs to know what to look for and how to return results.

- **pass:** Instructions name what records the user should look for, how to save them (PDF download, copy-paste), and how to return the capture.
- **partial:** Instructions exist but are generic ("save anything that looks relevant") without naming specific result types or saving steps.
- **fail:** No instructions provided, or instructions assume the user knows the workflow already.

## Result triage

Did the skill handle results correctly **for the phase this turn actually reached**? Triage runs only *after* the user uploads a capture (PDF). Most tests end at URL generation, before any capture exists — so there is nothing to triage yet, and the correct behavior is to **defer**: don't fabricate or pre-judge results you haven't received, and signal what you'll evaluate once the capture arrives. On a no-capture turn, grade the deferral, not the absence of triage — a clean deferral is a **pass**, never a partial, because waiting for the capture is exactly what the workflow asks for. Only when a capture is actually present in the turn do you grade the per-record triage itself. (Scoring this dimension `null` / N-A on a no-capture turn is also acceptable; what must never happen is a partial or fail for correctly waiting.)

- **pass:** No capture in the turn → the skill defers triage without fabricating matches, ideally naming the criteria it will apply (name, age/birth-year, jurisdiction). Capture present → every result is categorized (relevant / needs review / not relevant) with reasoning that cites specific matching or non-matching attributes.
- **partial:** A capture is present and most results are triaged correctly, but one near-match is mis-categorized without justification. (A correct deferral on a no-capture turn is **not** a partial.)
- **fail:** The skill fabricates results or claims matches from a capture that was never provided; or, with a capture present, bulk-accepts or bulk-rejects without per-record reasoning, or silently drops relevant records.

## Tool selection

Did the skill use its MCP tools per the documented flow — resolve the place, fetch curated links, and consume the response correctly?

This dimension grades a turn that **generates** a search. When the turn instead **records a search the user already ran** — a nil-result report ("I searched X, zero results") — no new search is being generated, so the skill correctly logs it with `research_log_append` alone; `place_search`/`external_links_search` are **not** expected and their absence is a pass, not a slip.

- **pass:** For a search-generation turn: `place_search` runs first and the **`standardPlace` it returns** (not a guessed string) feeds `external_links_search` with the plan item's year window — using that returned value is correct even when it resolves to a broader administrative level (e.g. state) than the place named in the request. The response is consumed per the rules: keep links whose host matches the target site, dedupe repeated URLs, confirm a kept link's record type fits the plan item, and **fall back to the site-wide template whenever no curated link matches the target site or record type** (a correct, expected fallback — not a slip). The search is persisted via `research_log_append` (which validates before persisting). For a nil-result-report turn: logging the reported search via `research_log_append` alone is the complete, correct tool use.
- **partial:** On a search-generation turn, right tools but a genuine consumption slip — fabricated or guessed a `standardPlace` that `place_search` did not return, presented a curated link for the wrong record type as if it fit, or failed to dedupe duplicate curated URLs. (Not calling `place_search`/`external_links_search` on a nil-result-report turn is **not** a slip.)
- **fail:** Skipped `external_links_search` entirely and hand-built a URL when a *matching* curated link existed, or called tools with fabricated arguments.

## Log entry

Did the skill write the research-log entry for the search — at URL-generation time, and for nil results?

- **pass:** A new `log[]` entry names the site, person, place, and year/range (in `query`/`notes`), written in the same turn the URL is generated (`outcome: "partial"`, `capture_received: false`). A reported zero-match search is logged with `outcome: "negative"` and notes on coverage limitations — never skipped because "there was nothing to record".
- **partial:** Entry present but incomplete or vague (e.g. "searched records" without site/year), or written only after results came back instead of at URL generation.
- **fail:** No log entry, or a misleading one (wrong site, claims results that were not received).
