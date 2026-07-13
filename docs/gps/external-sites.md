External Site Integration: Search URL Generation and Page Capture

1. The Problem: Valuable Records Behind Walled Gardens

The most-used genealogy record collections live on commercial platforms — Ancestry.com, MyHeritage.com, FindMyPast.com — that require paid subscriptions and prohibit automated access. These sites have no public APIs and actively block AI agents from fetching pages. Yet reasonably exhaustive research under the GPS demands that the agent search these collections; ignoring them because they're inconvenient is not an option.

The solution is a human-in-the-loop pattern: the agent generates search URLs, the user clicks them in their own authenticated browser, captures the resulting page, and hands it back to the agent for analysis. The user's subscription and browser session provide the access; the agent provides the expertise — knowing what to search, how to read the results, and which records to examine next.


--------------------------------------------------------------------------------


2. How It Works: The Generate-Click-Capture-Analyze Loop

The workflow has four steps, repeated as many times as the research question demands:

Step 1: Generate Search URL
The agent constructs a search URL for the target site using the site's query string format. The URL encodes the research parameters — names, dates, places, relationships, collection filters — directly into the query string so the user lands on a pre-filled search results page.

Step 2: Click
The agent presents the URL as a clickable link. The user clicks it, which opens the page in their own browser where they are already logged in. No credentials are shared with the agent.

Step 3: Capture
The user captures the page contents and returns them to the agent. The v1 capture method is Print-to-PDF: the user presses Cmd/Ctrl+P, selects "Save as PDF," and drags the file into the Cowork conversation. This requires zero installation and works on every browser and OS.

Step 4: Analyze
The agent reads the PDF, extracts every result or record field it can identify, evaluates match quality against the research question, logs the search in the research log (including nil results), and determines the next action — whether that's examining a specific record, refining the search, or moving to the next source in the research plan.

This loop is the agent's primary mechanism for GPS Step 1 (Reasonably Exhaustive Research) across external sites. Every iteration produces a research log entry, and nil results are recorded explicitly.


--------------------------------------------------------------------------------


3. Search URL Construction by Site

Each site has a different URL format for encoding search parameters. The agent must know these formats and construct valid URLs from the structured data in the research plan.

Ancestry.com

Ancestry uses query string parameters on its search endpoint. The agent constructs URLs of this form:

    https://www.ancestry.com/search/collections/{collection_id}/?name={first}_{last}&birth={year}&birthplace={place}&residence={year}_{place}&father={first}_{last}&mother={first}_{last}&spouse={first}_{last}

Key parameters:
- `name` — Given name and surname, underscore-separated
- `birth`, `death`, `marriage` — Year of the event
- `birthplace`, `deathplace`, `residenceplace` — Location string
- `residence` — Year and place, underscore-separated
- `father`, `mother`, `spouse` — Relative names
- `collection_id` — Ancestry's internal database ID (e.g., 7602 for 1880 US Census)

The agent can target a specific collection when the research plan calls for it, or search across all collections by omitting the collection path segment:

    https://www.ancestry.com/search/?name=Patrick_Flynn&birth=1845&birthplace=Pennsylvania

MyHeritage.com

MyHeritage uses a different query string format:

    https://www.myheritage.com/research?action=query&first={first}&last={last}&birth_year={year}&birth_place={place}&death_year={year}&death_place={place}&father_first={first}&father_last={last}&mother_first={first}&mother_last={last}

Key parameters:
- `first`, `last` — Given name and surname
- `birth_year`, `birth_place` — Birth year and location
- `death_year`, `death_place` — Death year and location
- `marriage_year`, `marriage_place` — Marriage year and location
- `father_first`, `father_last` — Father's name
- `mother_first`, `mother_last` — Mother's name
- `residence_year`, `residence_place` — Residence year and location

FindMyPast.com

FindMyPast uses a search endpoint with its own parameter naming:

    https://www.findmypast.com/search/results?firstname={first}&lastname={last}&yearofbirth={year}&keywordsplace={place}&eventyear={year}&fatherfirstname={first}&motherfirstname={first}

Key parameters:
- `firstname`, `lastname` — Given name and surname
- `yearofbirth`, `yearofdeath` — Birth and death years
- `keywordsplace` — Location string (used across event types)
- `eventyear` — Year of the target event
- `fatherfirstname`, `motherfirstname` — Parent first names
- `collection` — Collection identifier for targeted searches

FamilySearch.org (Public Search)

FamilySearch's public search page can also be driven by URL parameters, complementing the API-based tools:

    https://www.familysearch.org/search/record/results?q.givenName={first}&q.surname={last}&q.birthLikeDate.from={year}&q.birthLikeDate.to={year}&q.birthLikePlace={place}&q.residencePlace={place}


--------------------------------------------------------------------------------


4. What the Skill Does

A dedicated skill (or set of skills) handles this workflow. The skill's responsibilities:

URL generation. Given the current research question, target person data, and the next source in the research plan, the skill constructs the appropriate search URL. It selects parameters based on what's known about the subject — if a birth year is uncertain, it may widen the date range or omit the parameter entirely rather than over-constraining the search.

Search strategy. The skill determines which sites to search and in what order, based on the research plan. For US research post-1850, Ancestry is typically searched first (largest indexed collection), then FamilySearch (free, often has different indexing), then MyHeritage and FindMyPast for coverage gaps. For UK research, FindMyPast moves up in priority. The skill adapts ordering based on the time period, geography, and record type.

Result interpretation. When the user returns a captured PDF, the skill extracts the search results — names, dates, places, record types, and (critically) URLs to individual records. It evaluates each result against the research question, identifies the most promising matches, and recommends which records to examine in detail.

Record analysis. When the user captures an individual record page, the skill extracts every field (name, dates, places, relationships, source citation, household members) and feeds them into the record-extraction pipeline. Assertions are created, classified, and added to the research file (classification is first-and-final at extraction — there is no separate classification pass).

Iterative refinement. Based on the results (or lack thereof), the skill may generate a refined search URL — broadening date ranges if too few results were returned, adding a maiden name, switching to a FAN club search, or targeting a specific collection the research plan identified.

User instructions. At each step, the skill provides clear instructions to the user: what to click, how to capture the page, and what to do if the page looks different than expected (e.g., a login wall, a different page layout, or missing content).


--------------------------------------------------------------------------------


5. Why This Works: Respecting Terms of Service

This pattern is deliberately designed to respect the terms of service of commercial genealogy sites:

- No automated access. The agent never fetches pages from these sites. Every page load happens in the user's own browser, initiated by the user's own click, using the user's own authenticated session.
- No credential sharing. The user's login cookies, session tokens, and subscription credentials never leave their browser. The agent only sees the captured output.
- No scraping. The agent reads a static PDF that the user chose to export from their browser. This is functionally identical to the user printing a page and handing it to a human research assistant.
- User agency. The user decides whether to click each link, whether to capture each page, and whether to share each capture. The agent suggests; the user acts.

The tradeoff is speed. Every external-site search requires a round-trip through the user: the agent generates a URL, waits for the user to click and capture, then analyzes the result. This is slower than direct API access. But it's the only approach that works within the constraints — these sites don't offer APIs, and automating access violates their terms.


--------------------------------------------------------------------------------


6. Page Capture: Print-to-PDF

The v1 capture method is the browser's built-in Print-to-PDF. This was chosen for zero-install simplicity — it works on every browser and every OS without extensions or configuration.

Capture instructions the skill gives the user:

1. After the search results or record page has fully loaded, scroll to the bottom of the page and back to the top. This forces lazy-loaded content into the DOM so it appears in the PDF.
2. Press Cmd+P (Mac) or Ctrl+P (Windows/Linux).
3. Select "Save as PDF" as the print destination.
4. Save the file with default settings.
5. Drag the saved PDF into the Cowork conversation.

Known limitations of Print-to-PDF on genealogy sites:

- Lazy-loaded results. Some sites only render results as the user scrolls. The scroll-to-bottom step mitigates this, but the skill should ask the user to confirm the result count matches what they saw on screen.
- Document images. Record pages often display scanned documents (census pages, certificates) in JavaScript-based viewers that may not render in print output. The skill should prompt the user to take a separate screenshot of the document image when needed.
- Collapsed content. Tabs, accordions, and expandable sections may only print their currently-visible state. The skill should instruct the user to expand all sections before printing.
- URL preservation. Hyperlinks in PDFs may or may not be preserved as extractable links depending on the site's print stylesheet. When URLs are not extractable, the skill falls back to constructing record URLs from visible identifiers (record IDs, database names).

If testing reveals that Print-to-PDF consistently fails on a critical page type (e.g., Ancestry search results truncate to the visible viewport), the fallback is a browser extension like LLMFeeder that converts the page to clean Markdown with preserved URLs. This adds a one-time install step but produces more reliable captures for complex page layouts.


--------------------------------------------------------------------------------


7. Integration with the Research Pipeline

The external-sites workflow plugs into the broader GPS research pipeline at specific points:

Research planning (Step 1). The `research-plan` skill identifies which external sites to search and in what order. It references the `place_collections` MCP tool output (for FamilySearch) and its built-in knowledge of what Ancestry, MyHeritage, and FindMyPast cover for the target jurisdiction and time period.

Search execution. The external-sites skill generates URLs from the plan, walks the user through the click-capture loop, and processes results. Each search — including nil results — is logged via the `research-log` skill.

Record extraction (Step 2-3). Captured record pages flow into `record-extraction` to produce atomic assertions with GPS-conformant three-layer classifications (first-and-final at extraction; classification-refinement requests route back through `record-extraction`). Citations are generated via the `citation` skill, noting the repository (e.g., "Ancestry.com") and the specific database and record identifiers.

Conflict resolution (Step 4). When assertions from external sites conflict with FamilySearch data or with each other, the `conflict-resolution` skill handles them using the standard GPS preponderance hierarchy.

The agent treats external-site captures identically to any other source — they enter the same extraction, classification, and analysis pipeline. The only difference is the access mechanism.


--------------------------------------------------------------------------------


8. Example: A Complete Search-Capture Cycle

Research question: Identify the parents of Patrick Flynn, born ~1845 in Pennsylvania.

Agent (generates URL and instructs user):
"Let's search for Patrick Flynn in the 1850 US Census on Ancestry. Click this link and then print the results page as a PDF:

https://www.ancestry.com/search/collections/8054/?name=Patrick_Flynn&birth=1845&birthplace=Pennsylvania

After the page loads, scroll to the bottom and back up, then press Cmd+P and save as PDF."

User: [clicks link, captures page, uploads PDF]

Agent (analyzes the PDF):
"I found 23 results on this page. Three are strong matches:

1. Patrick Flynn, age 5, in the household of Thomas Flynn, age 32, born Ireland, residing in Schuylkill County, PA. [Record link]
2. Patrick Flynn, age 6, in the household of James Flynn, age 40, born Ireland, residing in Allegheny County, PA. [Record link]
3. Patrick Flynn, age 4, in the household of Mary Flynn, age 28, born Ireland, residing in Philadelphia County, PA. [Record link]

Result #1 is the strongest match — the age aligns with an ~1845 birth and the household head could be the father. Let's examine that record in detail. Click this link and print the record page as a PDF: [URL to record #1]"

The cycle continues until the research plan for this source is complete, then moves to the next source (FamilySearch records, MyHeritage, or a different record type on Ancestry).
