import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A locality's `record_types[].type` (`locality_record_type`, closed) and a plan item's
 * `record_type` (`record_type_recommended`, open) are one vocabulary, so a row matches the plan
 * items that use a listed value. The open enum lists its values as `examples`; this keeps the
 * closed copy equal to them, in both schema trees.
 */
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..", "..", "..", "..");

describe.each([["docs/specs/schemas"], ["packages/schema/schemas"]])("%s/enums.schema.json", (tree) => {
  const defs = JSON.parse(readFileSync(join(projectRoot, tree, "enums.schema.json"), "utf8")).$defs;

  it("locality_record_type is exactly record_type_recommended's examples", () => {
    expect(Array.isArray(defs.record_type_recommended.examples)).toBe(true);
    expect(defs.locality_record_type.enum).toEqual(defs.record_type_recommended.examples);
  });
});
