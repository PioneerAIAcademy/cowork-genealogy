import { lookupNameVariants, NAME_VARIANTS_GIVEN_PATH } from "../utils/name-variants.js";

export interface GetNameVariantsInput {
  name: string;
}

export interface GetNameVariantsResult {
  name: string;
  variants: string[];
}

export async function getNameVariants(
  input: GetNameVariantsInput
): Promise<GetNameVariantsResult> {
  const name = input.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("`name` must be a non-empty given name.");
  }
  const trimmed = name.trim();
  const variants = lookupNameVariants(trimmed, NAME_VARIANTS_GIVEN_PATH, { strict: true });
  return { name: trimmed, variants };
}

export const getNameVariantsSchema = {
  name: "get_name_variants",
  description:
    "Return a given name's alternate forms (nicknames, diminutives, formal forms). Given names only, not surnames. An unrecognized name returns an empty list, not an error. Add the returned forms to your own search query yourself.",
  inputSchema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "One given name to look up, e.g. \"Fred\" or \"William\".",
      },
    },
    required: ["name"],
  },
};
