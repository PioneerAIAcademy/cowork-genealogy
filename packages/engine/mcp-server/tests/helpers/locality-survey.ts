import { stageSearchResults } from "../../src/utils/results-staging.js";

/** A `locality_survey` answer's two localities fields, as the tool returns them. */
export const SURVEY_FIELDS = {
  pagesRead: [
    { section: "home", url: "https://www.familysearch.org/en/wiki/Ohio,_United_States_Genealogy", found: true },
    { section: "getting_started", url: null, found: false },
    { section: "online_records", url: null, found: false },
    { section: "research_tips", url: null, found: false },
  ],
  volumeSummary: {
    start_year: 1840,
    end_year: 1900,
    total_volumes: 3,
    complete: true,
    by_record_type: [{ group: "Probate", volumes: 3, browse_only: 3, fulltext_only: 0 }],
    untyped: { volumes: 0, browse_only: 0, fulltext_only: 0 },
  },
};

/** Stage a survey answer in the project, as `locality_survey` does, and return its ref. */
export async function stageSurvey(
  projectPath: string,
  answer: Record<string, unknown> = { place: "Ohio, United States", ...SURVEY_FIELDS },
): Promise<string> {
  const handle = await stageSearchResults({
    projectPath,
    tool: "locality_survey",
    response: { query: { standardPlace: answer.place }, results: [answer] },
  });
  if (!handle) throw new Error("the survey was not staged");
  return handle.resultsRef;
}
