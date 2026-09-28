// Live-PID mode on person_warnings (issue #2225 D1).
//
// Lives in its own file because it needs `vi.mock` on person-read, and
// person-warnings.test.ts imports the predicate functions directly with no mocks.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/tools/person-read.js", () => ({
  personReadTool: vi.fn(),
}));

import { LOCAL } from "../../src/auth/principal.js";
import {
  personWarningsTool,
  personWarningsToolSchema,
} from "../../src/tools/person-warnings.js";
import { personReadTool } from "../../src/tools/person-read.js";
import type { PersonWarningsFound } from "../../src/types/person-warnings.js";

const mockedPersonRead = vi.mocked(personReadTool);

beforeEach(() => {
  mockedPersonRead.mockReset();
});

// Anchor born 1900; father died 1890, a decade before his child's birth. That is
// a relative-mob warning — it fires only if the FATHER came back from the fetch,
// which is what makes it the right shape for testing `relatives: true`.
function treeWithFatherDeadBeforeChildBirth(anchorId = "KD96-TV2") {
  return {
    persons: [
      {
        id: anchorId,
        gender: "Male",
        living: false,
        names: [{ preferred: true, given: "Child", surname: "Anchor" }],
        facts: [{ id: "f-birth", type: "Birth", date: "1 Jan 1900", standard_date: "1 Jan 1900" }],
      },
      {
        id: "FATHER-1",
        gender: "Male",
        living: false,
        names: [{ preferred: true, given: "Father", surname: "Anchor" }],
        facts: [
          { id: "f-fbirth", type: "Birth", date: "1 Jan 1850", standard_date: "1 Jan 1850" },
          { id: "f-fdeath", type: "Death", date: "1 Jan 1890", standard_date: "1 Jan 1890" },
        ],
      },
    ],
    relationships: [{ type: "ParentChild" as const, parent: "FATHER-1", child: anchorId }],
    sources: [],
  };
}

describe("person_warnings live mode", () => {
  it("advertises personId as the only required input", () => {
    // projectPath is conditionally required — the MCP input schema cannot say
    // "required unless another field is set", so the runtime enforces it. If
    // projectPath were still listed here the client would reject every live
    // call before the tool ran, and no function-level test would notice.
    expect(personWarningsToolSchema.inputSchema.required).toEqual(["personId"]);
    expect(
      Object.keys(personWarningsToolSchema.inputSchema.properties),
    ).toContain("live");
  });

  it("evaluates the same checks against a fetched tree", async () => {
    mockedPersonRead.mockResolvedValue(treeWithFatherDeadBeforeChildBirth() as never);
    const result = (await personWarningsTool(
      { personId: "KD96-TV2", live: true },
      LOCAL,
    )) as PersonWarningsFound;

    expect(result.warningCount).toBeGreaterThan(0);
    expect(result.warnings.map((w) => w.issueType)).toContain(
      "relativesHasDeathBeforeChildBirth365_2",
    );
  });

  it("fetches relatives, not the anchor alone", async () => {
    mockedPersonRead.mockResolvedValue(treeWithFatherDeadBeforeChildBirth() as never);
    await personWarningsTool({ personId: "KD96-TV2", live: true }, LOCAL);

    // Deliberately separate from the test above: a mocked fetch returns its
    // fixture whatever arguments it is handed, so the warning would still fire
    // with `relatives` left at its default of false. In production that default
    // means every relative check returns false — a profile with a
    // father-died-before-child in it reported clean, green in CI.
    expect(mockedPersonRead).toHaveBeenCalledWith(
      expect.objectContaining({ personId: "KD96-TV2", relatives: true }),
      LOCAL,
    );
  });

  it("refuses projectPath and live together", async () => {
    await expect(
      personWarningsTool(
        { personId: "KD96-TV2", live: true, projectPath: "/tmp/p" },
        LOCAL,
      ),
    ).rejects.toThrow(/either projectPath or live=true, not both/);
    expect(mockedPersonRead).not.toHaveBeenCalled();
  });

  it("keeps the local-mode error for every non-live call", async () => {
    // The mode is selected by `live === true` exactly. check-warnings has the
    // model COMPUTE projectPath, so a truthiness branch would turn an empty
    // string into a silent network call on the user's token.
    for (const input of [
      { personId: "I1" },
      { personId: "I1", live: false },
      { personId: "I1", projectPath: "" },
      { personId: "I1", live: "yes" },
    ]) {
      await expect(personWarningsTool(input as never, LOCAL)).rejects.toThrow(
        "projectPath is required",
      );
    }
    expect(mockedPersonRead).not.toHaveBeenCalled();
  });

  it("anchors on the surviving profile when the PID was merged away", async () => {
    // person_read follows a 301 for a merged profile and returns the survivor
    // under its NEW id without reporting the redirect, so anchoring on the id the
    // caller asked for would throw "anchor person not found" — naming neither the
    // merge nor where the person went.
    const merged = treeWithFatherDeadBeforeChildBirth("SURVIVOR-9");
    mockedPersonRead.mockResolvedValue({ ...merged, persons: [merged.persons[0]] } as never);
    const result = (await personWarningsTool(
      { personId: "OLD-PID", live: true },
      LOCAL,
    )) as PersonWarningsFound;
    expect(result).toHaveProperty("warningCount");
  });

  it("explains a miss it cannot resolve instead of leaking Mob's error", async () => {
    mockedPersonRead.mockResolvedValue(treeWithFatherDeadBeforeChildBirth("OTHER-1") as never);
    await expect(
      personWarningsTool({ personId: "MISSING-1", live: true }, LOCAL),
    ).rejects.toThrow(/may have been merged into another profile/);
  });
});
