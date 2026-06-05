import type { PopulationResponse, PopulationToolInput } from "../types/place-population.js";
export type { PopulationToolInput } from "../types/place-population.js";
import { loadConfig } from "../auth/config.js";

const DEFAULT_POP_STATS_URL = "https://malachi.taild68f1b.ts.net/pop-stats";

export async function populationTool(
  input: PopulationToolInput
): Promise<PopulationResponse> {
  if (!input.placeId) {
    throw new Error("placeId is required");
  }

  const config = await loadConfig();
  const baseUrl = config.popStatsUrl ?? DEFAULT_POP_STATS_URL;

  // The upstream Pop Stats API expects the query param `place_id`; only the
  // MCP tool's input field is named `placeId` (standardized casing).
  const params = new URLSearchParams({ place_id: input.placeId });
  if (input.year != null) params.set("year", String(input.year));
  if (input.year_start != null) params.set("year_start", String(input.year_start));
  if (input.year_end != null) params.set("year_end", String(input.year_end));

  const url = `${baseUrl}/population?${params}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(
      "Population data service is unavailable. Is the Pop Stats API running?"
    );
  }

  if (!response.ok) {
    throw new Error(
      `Population API error: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<PopulationResponse>;
}

export const populationToolSchema = {
  name: "place_population",
  description:
    "Get historical population data and indexed record counts for a FamilySearch place. " +
    "Pass a FamilySearch place ID (from the places tool) and optionally filter by year or year range. " +
    "Returns population data from multiple sources and FamilySearch indexed birth record coverage. " +
    "No authentication required.",
  inputSchema: {
    type: "object",
    properties: {
      placeId: {
        type: "string",
        description:
          'FamilySearch place ID (e.g., "1927069" for Nigeria). ' +
          "Use the places tool first to find the place ID.",
      },
      year: {
        type: "number",
        description:
          "Specific year to query. If no exact match exists, returns the nearest available year.",
      },
      year_start: {
        type: "number",
        description: "Start of year range filter.",
      },
      year_end: {
        type: "number",
        description: "End of year range filter.",
      },
    },
    required: ["placeId"],
  },
};
