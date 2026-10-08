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
// list that lacks it fails. Two agents are excluded outright rather than
// pending: `image-reader`, which by spec returns a transcription and nothing
// else, and `project-status`, whose two summaries and integrity warnings ARE
// its whole output (lead ruling "PS return: A", 2026-09-24, issue #2793) —
// conforming would drop the detailed summary and the id-bearing warnings below
// the caller's print line.
//
// NOTE for anyone converting an agent: exclusion silences this lint in both
// directions, so a green run says nothing about whether the excluded body is
// right. Read it.

const here = dirname(fileURLToPath(import.meta.url));
const agentsDir = join(here, "..", "..", "..", "plugin", "agents");

const HEADING = /^#{2,4}\s+`summary_for_user`\s*$/m;

const EXCLUDED: Record<string, string> = {
  "image-reader.md": "returns a full transcription and nothing else, by spec",
  "project-status.md":
    "returns the user-friendly and detailed summaries, warnings first, as its whole output, by its own contract",
  // Issue #2796, applying issue #2793's "PS return: A" ruling (2026-09-24): the
  // agent writes nothing, so the per-source findings ARE the deliverable, and a
  // summary_for_user paragraph (no identifiers) printed in place of the return
  // would drop them in a production relay while the unit harness, which relays
  // the whole return, stayed green.
  "source-evaluation.md": "returns the audit report as its whole output; it writes nothing, so the report is the deliverable",
};

const PENDING: Record<string, string> = {
  "person-evidence.md": "lands with its next body edit (issues #2272 / #2537)",
  "research-exhaustiveness.md": "lands with its next body edit",
  "gps-mentor.md":
    "lands with the narrative_for_user split (spec §8, §11.1) on its next body edit",
  // NOT "lands with its next body edit" like the three above. This one is a
  // measured conflict, and the premise of the 2026-09-18 ruling does not hold
  // for it: that ruling exists because "an agent body without the field is an
  // agent whose work reaches the researcher as nothing", and this agent's
  // deliverable is a markdown file the researcher opens, announced by a
  // caller-facing line the router already relays verbatim.
  //
  // Its suite grades reply brevity from three directions at once
  // (`test_reply_does_not_narrate_pending_step`, the `Reply economy` rubric
  // dimension, and base Correctness, which failed one test for a single
  // interpretive clause), so two paragraphs of researcher-facing prose written
  // straight after reading the article is space the extract flows into.
  // Measured. The one-line return was clean across the three committed
  // pre-conversion logs -- v1_2026-07-28_09-35-42 (9 of 9 pass),
  // v1_2026-08-22_10-20-08 (11 pass, 1 partial) and v1_2026-09-03_11-36-25
  // (12 of 12) -- with zero fails in any of them. Adding the contract scored 7
  // fails, and 5 on a second wording, with every score of 1 tracing to article
  // content in the reply; those two runs are NOT in the corpus, because rule 6
  // forbids committing a run log carrying a fail, so their figures are quoted
  // from the PR that measured them rather than from a file here.
  //
  // Richard ruled on 2026-09-28 that the exemption stands, on the condition
  // that new agents are no longer copied from this one -- CLAUDE.md,
  // DEVELOPMENT.md, docs/architecture.md, docs/skill-lifecycle.md,
  // docs/skill-authoring-guide.md and CONTRIBUTING.md all point at
  // agents/search-images.md instead.
  "search-wikipedia.md":
    "measured conflict with its own suite's reply-brevity grading; premise of the 2026-09-18 ruling does not hold for a file-deliverable agent (#2795)",
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
