import type { Principal } from "../auth/principal.js";
import type { PopulationResponse, PopulationToolInput } from "../types/place-population.js";
export type { PopulationToolInput } from "../types/place-population.js";
import { loadConfig } from "../auth/config.js";
import { resolveStandardPlaceToPlaceId, ambiguousPlaceError } from "../utils/place-resolver.js";
import { describeFetchError, fetchWithRetry } from "../utils/http.js";

const DEFAULT_POP_STATS_URL = "https://malachi.taild68f1b.ts.net/pop-stats";

export async function populationTool(
  input: PopulationToolInput,
  principal: Principal
): Promise<PopulationResponse> {
  if (!input.standardPlace) {
    throw new Error("standardPlace is required");
  }

  const resolution = await resolveStandardPlaceToPlaceId(input.standardPlace);
  if (resolution.kind === "ambiguous") {
    throw ambiguousPlaceError(input.standardPlace, resolution.candidates);
  }
  if (resolution.kind === "unresolved") {
    throw new Error(
      `Could not resolve "${input.standardPlace}" to a single FamilySearch place. ` +
        "Use place_search to get a standard place name first."
    );
  }
  const placeId = resolution.placeId;

  const config = await loadConfig(principal);
  const baseUrl = config.popStatsUrl ?? DEFAULT_POP_STATS_URL;

  // The upstream Pop Stats API expects snake_case query params; map the
  // camelCase MCP inputs onto them (place_id, year_start, year_end).
  const params = new URLSearchParams({ place_id: placeId });
  if (input.year != null) params.set("year", String(input.year));
  if (input.startYear != null) params.set("year_start", String(input.startYear));
  if (input.endYear != null) params.set("year_end", String(input.endYear));

  const url = `${baseUrl}/population?${params}`;

  let response: Response;
  try {
    response = await fetchWithRetry(url);
  } catch (err) {
    throw new Error(
      `Population data service is unavailable at ${baseUrl} (${describeFetchError(err)}).`
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
    "Pass a standard place name (the `standardPlace` field from place_search) and optionally filter by year or year range. " +
    "Returns population data from multiple sources and FamilySearch indexed birth record coverage. " +
    "No authentication required.",
  inputSchema: {
    type: "object",
    properties: {
      standardPlace: {
        type: "string",
        description:
          'The standard place name (the `standardPlace` field from place_search, ' +
          'e.g. "Nigeria" or "Schuylkill, Pennsylvania, United States"). ' +
          "Call place_search first to get this name.",
      },
      year: {
        type: "number",
        description:
          "Specific year to query. If no exact match exists, returns the nearest available year.",
      },
      startYear: {
        type: "number",
        description: "Start of year range filter (inclusive).",
      },
      endYear: {
        type: "number",
        description: "End of year range filter (inclusive).",
      },
    },
    required: ["standardPlace"],
  },
};
