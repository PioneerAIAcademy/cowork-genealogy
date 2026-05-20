import { getPlaceByPrimaryId } from "./place-search.js";

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
  place_id1: string;
  place_id2: string;
}

export interface PlaceDistanceResult {
  place_id1: string;
  place_id2: string;
  place1Name: string;
  place2Name: string;
  miles: number;
  kilometers: number;
}

export async function placeDistanceTool(
  input: PlaceDistanceInput
): Promise<PlaceDistanceResult> {
  const [place1, place2] = await Promise.all([
    getPlaceByPrimaryId(input.place_id1),
    getPlaceByPrimaryId(input.place_id2),
  ]);

  if (!place1) {
    throw new Error(`Place not found: ${input.place_id1}`);
  }
  if (!place2) {
    throw new Error(`Place not found: ${input.place_id2}`);
  }
  if (place1.latitude === undefined || place1.longitude === undefined) {
    throw new Error(
      `Place "${place1.name}" (ID ${input.place_id1}) has no coordinates.`
    );
  }
  if (place2.latitude === undefined || place2.longitude === undefined) {
    throw new Error(
      `Place "${place2.name}" (ID ${input.place_id2}) has no coordinates.`
    );
  }

  const { miles, kilometers } = haversineDistance(
    place1.latitude,
    place1.longitude,
    place2.latitude,
    place2.longitude
  );

  return {
    place_id1: input.place_id1,
    place_id2: input.place_id2,
    place1Name: place1.fullName,
    place2Name: place2.fullName,
    miles,
    kilometers,
  };
}

export const placeDistanceToolSchema = {
  name: "place_distance",
  description:
    "Calculate the approximate straight-line distance in miles and kilometers between two FamilySearch places. " +
    "Pass two numeric FamilySearch place IDs. Use the places tool first if you only have place names and need their IDs.",
  inputSchema: {
    type: "object" as const,
    properties: {
      place_id1: {
        type: "string",
        description: "The FamilySearch place ID of the first place.",
      },
      place_id2: {
        type: "string",
        description: "The FamilySearch place ID of the second place.",
      },
    },
    required: ["place_id1", "place_id2"],
  },
};
