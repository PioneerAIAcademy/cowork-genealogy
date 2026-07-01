import { standardPlaceToCoords } from "../utils/place-resolver.js";

const EARTH_RADIUS_KM = 6371;
const KM_TO_MILES = 0.621371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): { miles: number; kilometers: number } {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const kilometers = EARTH_RADIUS_KM * c;
  return {
    kilometers: Math.round(kilometers),
    miles: Math.round(kilometers * KM_TO_MILES),
  };
}

export interface PlaceDistanceInput {
  standardPlace1: string;
  standardPlace2: string;
}

export interface PlaceDistanceResult {
  standardPlace1: string;
  standardPlace2: string;
  miles: number;
  kilometers: number;
}

export async function placeDistanceTool(
  input: PlaceDistanceInput
): Promise<PlaceDistanceResult> {
  const [coords1, coords2] = await Promise.all([
    standardPlaceToCoords(input.standardPlace1),
    standardPlaceToCoords(input.standardPlace2),
  ]);

  if (!coords1) {
    throw new Error(
      `Could not resolve coordinates for "${input.standardPlace1}". ` +
        `Use place_search to get a standard place name first.`
    );
  }
  if (!coords2) {
    throw new Error(
      `Could not resolve coordinates for "${input.standardPlace2}". ` +
        `Use place_search to get a standard place name first.`
    );
  }

  const { miles, kilometers } = haversineDistance(
    coords1.latitude,
    coords1.longitude,
    coords2.latitude,
    coords2.longitude
  );

  return {
    standardPlace1: input.standardPlace1,
    standardPlace2: input.standardPlace2,
    miles,
    kilometers,
  };
}

export const placeDistanceToolSchema = {
  name: "place_distance",
  description:
    "Calculate the approximate straight-line distance in miles and kilometers " +
    "between two places. Pass two standard place names (the `standardPlace` " +
    "field from place_search); the tool resolves each to coordinates internally.",
  inputSchema: {
    type: "object" as const,
    properties: {
      standardPlace1: {
        type: "string",
        description:
          'The standard place name of the first place (the `standardPlace` ' +
          'field from place_search, e.g. "Paris, Bear Lake, Idaho, United States").',
      },
      standardPlace2: {
        type: "string",
        description:
          "The standard place name of the second place (the `standardPlace` " +
          "field from place_search).",
      },
    },
    required: ["standardPlace1", "standardPlace2"],
  },
};
