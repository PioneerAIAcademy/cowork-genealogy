# tree-survey/v1_2026-10-15_11-20-37.json

## ut_tree_survey_001 (partial)
- **Correctness** = 2: The response correctly identifies Hannah Pruitt (TGAP-GM2) as the hole and accurately reports the tree_gaps findings: 8 ancestor generations, 4 descendant generations, 40 persons scanned, no early stop. The coverage data (9 collections, 1860 census, CENSUS/CHURCH_RECORD/VITAL types) is accurately drawn from the tool response. However, the opening sentence 'The searches returned no results, but the tree survey shows 9 collections covering Lancaster, Pennsylvania for that period' is misleading. The agent performed three record_search calls that all returned zero results, which is correctly treated as a result per the per-test context. But the phrasing 'The searches returned no results, but...' suggests the searches were a primary check that failed, when in fact the coverage data is the legitimate source for what FamilySearch holds. This is a minor mischaracterization of the evidence chain, not a fabrication, but it does misrepresent the basis for the claim about available collections.

## ut_tree_survey_002 (partial)
- **Tool Arguments** = 2: The tree_gaps call was correct (personId: TGAP-ROT). The two record_search calls were reasonable explorations of the hole, but the fourth call to person_quality (personId: TGAP-AUN) was unnecessary and failed with 'not_familysearch_id' error. The per-test context states the agent should check using person_quality, record_search, pendingHints, or coverage; the coverage data was already available from tree_gaps. The person_quality call added noise and failed, though it did not prevent the agent from completing the task. This represents a noisy extra call that was not critical but was not ideal.

## ut_tree_survey_004 (partial)
- **Correctness** = 2: The response correctly identifies the hole (Samuel Ashby and Ida Marsh, TGAP-GF3) and accurately describes the gap (last child born 1888, mother only 28, suggesting more children through ~1903). The 1900 census reference is supported by the coverage.censusYears data. However, the response states 'The single hole found carries no search hits, no pending hints' but then performs a record_search call that returns 0 results—this is accurate reporting of the search outcome. The person_quality call failed with 'not_familysearch_id' error, which the response does not explicitly mention. The response correctly treats empty results as valid findings per the rubric. The factual claims about Samuel Ashby (1855-1920) and Ida Marsh align with the tool response. One minor issue: the response says the coverage includes '1890 (ignored per the survey rules) and 1900' but the rubric does not explicitly state that 1890 should be ignored—this appears to be Claude's interpretation rather than stated guidance, though it is reasonable.

## ut_tree_survey_008 (pass)

## ut_tree_survey_012 (partial)
- **Correctness** = 2: The response is mostly correct but contains one unsupported claim. Claude states 'no search results surfaced a fitting record' and 'the quality check was not available for that ID format,' which are accurate. However, Claude claims the hole 'still carries signal from its coverage: 6 collections exist for Dayton, Montgomery County, Ohio in that window, including the 1880 census.' While the coverage data is present in tree_gaps response, Claude's phrasing 'still carries signal' and the implication that this is meaningful despite zero search results is somewhat misleading—the coverage shows what exists, but the agent found no actual records matching Clara. The suggestion itself is sound and grounded in the coverage data, but the framing overstates the evidentiary support.

## ut_tree_survey_013 (partial)
- **Correctness** = 2: The response correctly identifies Heinrich Weis as the hole and accurately reports the coverage data from tree_gaps (9 collections, 4.2M records, 1850 and 1860 censuses). However, it claims 'The search returned no matching records under the exact spelling' and 'no top result fits the hole by name and place,' but the record_search tool was never called with birth parameters alone—only with birthYearFrom/To and birthPlace. The agent then performed a second record_search with census-specific parameters (residenceYearFrom/To, recordType: census), which also returned zero results. The phrasing 'The search returned no matching records' is ambiguous about which search is meant and could mislead the user about what was actually checked. The coverage statement is accurate and well-supported by the tool response.

## ut_tree_survey_014 (partial)
- **Tool Arguments** = 2: The tree_gaps call was correct (personId: TGAP-ROT matched expected_args). However, the person_quality call for TGAP-H1A returned an error (not_familysearch_id), indicating the tool was called with an incorrect ID type. The record_search calls all used correct arguments matching expected_args (surname fields matched the ~substring expectation). The person_quality error represents a meaningful mismatch on a coverage-check tool, though the skill recovered by proceeding with other checks and still produced valid suggestions.
- **Coverage check** = 2: The agent checked coverage for most holes it kept: it attempted person_quality for TGAP-H1A (which failed with not_familysearch_id), and performed record_search calls for TGAP-H1B (August Ashby marriage), TGAP-H2A (Hannah Pruitt birth), TGAP-H3A (Samuel Weis birth), TGAP-H1A (Edmund Ashby death), and TGAP-H5A (Karl Ruhl marriage). All searches returned empty results, which the agent treated as results. However, the agent did not check TGAP-H4A (Louise Marsh, no birth info) before excluding it, and the person_quality call failed rather than returning usable data. The coverage checks were incomplete for the full set of holes.
- **Hand-off and prose** = 2: The response includes the required structured section above the `---` line with person IDs and questions, and the tree-read summary. However, the prose below the `---` contains field names and tool-related language: 'FamilySearch has flagged a pending hint for him', 'FamilySearch has', 'Lancaster County has census records', 'Lancaster has a solid collection', 'church or civil records', 'church marriage registers'. While the hint to run init-project is present, the user-facing prose below the `---` should contain no tool names or field names, only plain language accessible to the user. The prose also references 'FamilySearch' multiple times, which is a tool/system identifier that should not appear in user-facing text.

## ut_tree_survey_015 (pass)

## ut_tree_survey_016 (pass)
# research/v24_2026-10-15_11-20-37.json

## ut_research_015 (pass)

## ut_research_016 (pass)

## ut_research_017 (pass)
- **Tool Arguments** = None: No MCP tool calls were made by the research skill itself. The skill correctly declined and routed rather than invoking tools. N/A per the base rubric: Tool Arguments may be null only when zero MCP tool calls occurred.

## ut_research_018 (pass)
- **Tool Arguments** = None: No MCP tool calls were made by the skill under test. The skill correctly routed to question-selection without invoking tools itself. N/A per base rubric policy for zero tool calls.

## ut_research_019 (pass)
