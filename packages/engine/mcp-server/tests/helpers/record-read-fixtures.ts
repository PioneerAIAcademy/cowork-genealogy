// The committed record_read fixtures and a synthetic large household, shared by
// the compactor and merge_warnings suites (issue #4415).

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { RecordReadResult } from "../../src/types/record-read.js";

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../eval/fixtures/mcp",
);

export interface RecordReadFixture {
  file: string;
  /** The fixture's `args.recordId` with the harness's `~` predicate prefix stripped. */
  recordId: string;
  response: RecordReadResult;
}

export function loadRecordReadFixtures(): RecordReadFixture[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => /^record-read-.*\.json$/.test(f))
    .sort()
    .map((file) => {
      const d = JSON.parse(readFileSync(join(FIXTURE_DIR, file), { encoding: "utf-8" }));
      return {
        file,
        recordId: String(d.args?.recordId ?? "").replace(/^~/, ""),
        response: d.response as RecordReadResult,
      };
    })
    .filter((f) => f.response && Array.isArray(f.response.persons));
}

export function loadRecordReadFixture(file: string): RecordReadFixture {
  const f = loadRecordReadFixtures().find((x) => x.file === file);
  if (!f) throw new Error(`no record_read fixture ${file}`);
  return f;
}

/** A live-shaped household of `n` personas: each with a name, three facts and
 *  its own Person source, chained parent to child, persona 0 the principal. */
export function syntheticHousehold(n: number): RecordReadResult {
  const pid = (i: number) => `p_${1000 + i}`;
  const ark = (i: number) => `ark:/61903/1:1:AB${String(i).padStart(2, "0")}-XYZ`;
  const persons = Array.from({ length: n }, (_, i) => ({
    id: pid(i),
    ark: ark(i),
    ...(i === 0 ? { principal: true } : {}),
    gender: i % 2 ? "Male" : "Female",
    names: [{ id: `n${i}`, type: "BirthName", given: `Given${i}`, surname: "Householder" }],
    facts: [
      {
        id: `f${i}a`,
        type: "Census",
        date: "1850",
        place: "Branch Township, Schuylkill, Pennsylvania, United States",
        standard_place: "Branch, Schuylkill, Pennsylvania, United States",
      },
      { id: `f${i}b`, type: "Birth", date: "1820", place: "Pennsylvania", standard_place: "Pennsylvania, United States" },
      { id: `f${i}c`, type: "Occupation", value: "Laborer" },
    ],
    sources: [{ ref: `sd_p_${i}` }],
  }));
  const relationships = Array.from({ length: n - 1 }, (_, k) => {
    const i = k + 1;
    return i % 2
      ? { id: `r${i}`, type: "ParentChild", parent: pid(i - 1), child: pid(i) }
      : { id: `r${i}`, type: "Couple", person1: pid(i - 1), person2: pid(i) };
  });
  const sources = [
    {
      id: "sd_r_1",
      resource_type: "Record",
      title: 'Entry for Given0 Householder, "United States Census, 1850"',
      citation: '"United States Census, 1850", FamilySearch, Entry for Given0 Householder.',
      url: "https://www.familysearch.org/ark:/61903/1:2:AAAA-BBB",
    },
    { id: "sd_c_1", resource_type: "Collection", title: "United States Census, 1850" },
    ...persons.map((p, i) => ({
      id: `sd_p_${i}`,
      resource_type: "Person",
      title: `Given${i} Householder, "United States Census, 1850"`,
      citation: `"United States Census, 1850", FamilySearch (https://www.familysearch.org/${p.ark} : 2024), Given${i} Householder.`,
      url: `https://www.familysearch.org/${p.ark}`,
    })),
  ];
  const birthRanges = Object.fromEntries(persons.map((p) => [p.id, "Bet 1819 and 1820"]));
  return { persons, relationships, sources, birthRanges } as RecordReadResult;
}
