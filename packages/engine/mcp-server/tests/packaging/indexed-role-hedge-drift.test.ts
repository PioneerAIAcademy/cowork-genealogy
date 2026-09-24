import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INDEXED_ROLE_HEDGES } from "../../src/tools/research-log-append.js";

// Drift guard for the two "indexed beside a role word" hedges the pre-1880
// census gate copies from the eval validator. The validator is the
// authoritative copy and has been re-tuned three times; a retune that reaches
// only one copy makes the gate refuse a note the validator accepts, or the
// reverse, with every other check green.
//
// Parses the validator's source rather than importing it: the pattern is an
// f-string over `_ROLE_WORD`, so it is expanded here the way Python would.

const here = dirname(fileURLToPath(import.meta.url));
const validatorPath = join(
  here, "..", "..", "..", "..", "..",
  "eval", "harness", "validators", "test_search_records.py",
);

function validatorIndexedHedges(): string[] {
  const src = readFileSync(validatorPath, "utf-8");
  const roleWord = /^_ROLE_WORD\s*=\s*r"([^"]+)"/m.exec(src)?.[1];
  if (!roleWord) throw new Error(`_ROLE_WORD not found in ${validatorPath}`);
  const markers = /^_INFERENCE_MARKERS\s*=\s*\(([\s\S]*?)^\)/m.exec(src)?.[1];
  if (!markers) throw new Error(`_INFERENCE_MARKERS not found in ${validatorPath}`);
  return [...markers.matchAll(/^\s*rf"([^"]*)"/gm)]
    .map((m) => m[1])
    .filter((p) => p.includes("{_ROLE_WORD}"))
    .map((p) => p.replaceAll("{_ROLE_WORD}", roleWord).replaceAll("{{", "{").replaceAll("}}", "}"));
}

describe("INDEXED_ROLE_HEDGES matches the eval validator's index markers", () => {
  it("finds exactly the two index markers in the validator", () => {
    expect(validatorIndexedHedges()).toHaveLength(2);
  });

  it("carries the same patterns, in the same order", () => {
    expect(INDEXED_ROLE_HEDGES.map((re) => re.source)).toEqual(validatorIndexedHedges());
  });
});
