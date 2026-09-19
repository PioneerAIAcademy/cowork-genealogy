import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Every agent's return ends with a `summary_for_user` paragraph the router
// relays verbatim to the researcher (lead ruling 2026-09-18; the rule lives in
// docs/skill-to-agent-pair-conversion.md, "The process, in order", step 7).
//
// Why a lint: after the pair conversions the router's only prose is the relay
// of what the agent returned, so an agent body without the field is an agent
// whose work reaches the researcher as nothing, or as whatever the router
// improvises. Nothing else notices — the eval judge grades the persisted
// artifact and the return goes to the caller, not the run log's text.
//
// The pending list is the decision record for the agents that do not carry the
// heading YET. Each sits on its own paid eval slot, so the field lands with
// that agent's next body edit rather than flipping four run logs in one PR.
// An entry here is checked in BOTH directions: an agent on the list that has
// gained the heading fails ("stale entry — remove it"), and an agent off the
// list that lacks it fails. `image-reader` is excluded outright: by spec it
// returns a transcription and nothing else.

const here = dirname(fileURLToPath(import.meta.url));
const agentsDir = join(here, "..", "..", "..", "plugin", "agents");

const HEADING = /^#{2,4}\s+`summary_for_user`\s*$/m;

const EXCLUDED: Record<string, string> = {
  "image-reader.md": "returns a full transcription and nothing else, by spec",
};

const PENDING: Record<string, string> = {
  "proof-conclusion.md": "its eval slot is held by issue #2604; the field lands with that edit",
  "person-evidence.md": "lands with its next body edit (issues #2272 / #2537)",
  "research-exhaustiveness.md": "lands with its next body edit",
  "gps-mentor.md":
    "lands with the narrative_for_user split (spec §8, §11.1) on its next body edit",
};

function stripFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

describe("agent return contract — summary_for_user", () => {
  const files = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));

  it("scans the agent bodies it claims to", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it("has no stale entries in the excluded or pending lists", () => {
    const stale = [...Object.keys(EXCLUDED), ...Object.keys(PENDING)].filter(
      (f) => !files.includes(f),
    );
    expect(stale, `these entries name agents that no longer exist: ${stale.join(", ")}`).toEqual([]);
  });

  for (const file of files) {
    if (file in EXCLUDED) continue;
    const body = stripFences(readFileSync(join(agentsDir, file), "utf8"));
    const has = HEADING.test(body);
    if (file in PENDING) {
      it(`${file}: still pending — remove it from PENDING once it carries the heading`, () => {
        expect(
          has,
          `${file} now carries a summary_for_user heading; delete its PENDING entry (${PENDING[file]})`,
        ).toBe(false);
      });
    } else {
      it(`${file}: return contract carries a summary_for_user heading outside any fence`, () => {
        expect(
          has,
          `${file} has no \`summary_for_user\` heading in its return section. Add one (see ` +
            `agents/record-extractor.md "Return contract"), or add the file to PENDING with the ` +
            `eval slot that will carry it.`,
        ).toBe(true);
      });
    }
  }
});
