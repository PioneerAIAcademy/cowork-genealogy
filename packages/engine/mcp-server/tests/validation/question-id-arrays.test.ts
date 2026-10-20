// The JSON schema gives extracted_for_question_ids, blocks_question_ids and
// related_question_ids an item pattern of `^q_`; the hand-maintained validator
// checked none of the items, so extraction_append persisted a slug
// ("flynn-household-origins") that the schema then rejected
// (ut_search_records_003, issue #2116).
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { validateParsed } from "../../src/validation/validator.js";

const here = dirname(fileURLToPath(import.meta.url));
const scenario = join(here, "../../../../../eval/fixtures/scenarios/flynn-multi-conflict");
const load = (name: string) => JSON.parse(readFileSync(join(scenario, name), "utf-8"));

const questionIdErrors = (r: { errors: { message: string; path?: string }[] }) =>
  r.errors.filter((e) => /_question_ids/.test(`${e.path ?? ""} ${e.message}`));

describe("question-id arrays carry q_ ids", () => {
  it("accepts the scenario as committed", async () => {
    const result = await validateParsed(load("research.json"), load("tree.gedcomx.json"));
    expect(questionIdErrors(result)).toEqual([]);
  });

  const cases: [string, string, (r: any) => void][] = [
    ["assertions", "extracted_for_question_ids",
      (r) => { r.assertions.find((a: any) => a.extracted_for_question_ids?.length).extracted_for_question_ids[0] = "flynn-household-origins"; }],
    ["conflicts", "blocks_question_ids",
      (r) => { r.conflicts.find((c: any) => c.blocks_question_ids?.length).blocks_question_ids[0] = "flynn-household-origins"; }],
    ["hypotheses", "related_question_ids",
      (r) => { r.hypotheses.find((h: any) => h.related_question_ids?.length).related_question_ids[0] = "flynn-household-origins"; }],
  ];

  for (const [section, field, plant] of cases) {
    it(`reports a non-q_ id in ${section}.${field}`, async () => {
      const research = load("research.json");
      plant(research);
      const result = await validateParsed(research, load("tree.gedcomx.json"));
      const errs = questionIdErrors(result);
      expect(errs.length).toBe(1);
      expect(`${errs[0].path} ${errs[0].message}`).toContain(field);
      expect(errs[0].message).toContain("should start with 'q_'");
    });
  }
});
