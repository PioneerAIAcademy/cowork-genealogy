import { describe, it, expect } from "vitest";
import { assertCoverage } from "../../dev/smoke-calls.js";
import { allToolSchemas } from "../../src/tool-schemas.js";

// `assertCoverage` is a pure function over two in-repo arrays: the advertised
// tool list and the smoke plan. It answers "is every advertised tool either
// smoked or a named exclusion?", and nothing about it needs a transport, a
// server, Postgres or MinIO.
//
// It ran only inside the smoke binaries, so the answer arrived behind a Docker
// pull: a flaky image fetch took the check down with the stack, and the
// engine-smoke-http job only started running it at all in this PR. Here it runs
// in ~1 ms inside the already-required `vitest` job, so adding a tool without a
// smoke row reds a PR immediately and for a reason that names itself.
//
// The smoke binaries still call it -- this does not replace that, it front-runs
// it.

describe("the smoke plan covers every advertised tool", () => {
  it("has no advertised tool that is neither planned nor excluded", () => {
    const advertised = allToolSchemas.map((t) => t.name);
    expect(advertised.length).toBeGreaterThan(0); // a plan over nothing proves nothing
    expect(
      assertCoverage(advertised),
      "Every tool the server advertises must either have a row in dev/smoke-calls.ts's\n" +
        "CALL_PLAN or be a named entry in EXCLUDED_TOOLS. Add the row (prefer\n" +
        "`offline: true` when it needs no network and no credentials, so CI runs it).",
    ).toEqual([]);
  });

  // The other direction, so this cannot quietly become a test of nothing.
  it("reports a tool that is advertised but unplanned", () => {
    const problems = assertCoverage([...allToolSchemas.map((t) => t.name), "definitely_not_a_tool"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/definitely_not_a_tool/);
  });

  it("reports an exclusion that is no longer advertised", () => {
    // Drop `login`, a named exclusion, from the advertised set.
    const advertised = allToolSchemas.map((t) => t.name).filter((n) => n !== "login");
    expect(assertCoverage(advertised).join(" ")).toMatch(/excluded tool 'login' is not advertised/);
  });
});
