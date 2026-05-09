import type { PopulationResponse, PopulationToolInput } from "../types/population.js";
export type { PopulationToolInput } from "../types/population.js";

const POP_STATS_BASE_URL =
  process.env.POP_STATS_BASE_URL ?? "http://localhost:8000";

export async function populationTool(
  input: PopulationToolInput
): Promise<PopulationResponse> {
  if (!input.place_id) {
    throw new Error("place_id is required");
  }

  const params = new URLSearchParams({ place_id: input.place_id });
  if (input.year != null) params.set("year", String(input.year));
  if (input.year_start != null) params.set("year_start", String(input.year_start));
  if (input.year_end != null) params.set("year_end", String(input.year_end));

  const url = `${POP_STATS_BASE_URL}/population?${params}`;

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
  name: "population",
  description:
    "Get historical population data and indexed record counts for a FamilySearch place. " +
    "Pass a FamilySearch place ID (from the places tool) and optionally filter by year or year range. " +
    "Returns population data from multiple sources and FamilySearch indexed birth record coverage. " +
    "No authentication required.",
  inputSchema: {
    type: "object",
    properties: {
      place_id: {
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
    required: ["place_id"],
  },
};
