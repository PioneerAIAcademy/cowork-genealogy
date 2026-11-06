import { describe, it, expect, vi } from "vitest";
import { assertCoverage, CALL_PLAN, runPlan, type CallResult, type SmokeCtx } from "../../dev/smoke-calls.js";
import { allToolSchemas } from "../../src/tool-schemas.js";
import { connectorProjectViewSchemas } from "../../src/tools/project-view.js";

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

const everywhere = allToolSchemas.map((t) => t.name);
const connectorList = [...everywhere, ...connectorProjectViewSchemas.map((t) => t.name)];

describe("the smoke plan covers every advertised tool", () => {
  it("has no advertised tool that is neither planned nor excluded", () => {
    expect(everywhere.length).toBeGreaterThan(0); // a plan over nothing proves nothing
    expect(
      assertCoverage(everywhere, { connector: false }),
      "Every tool the server advertises must either have a row in dev/smoke-calls.ts's\n" +
        "CALL_PLAN or be a named entry in EXCLUDED_TOOLS. Add the row (prefer\n" +
        "`offline: true` when it needs no network and no credentials, so CI runs it).",
    ).toEqual([]);
  });

  it("passes the connector's own list, which adds the connector-only tools", () => {
    expect(connectorList.length).toBeGreaterThan(everywhere.length);
    expect(assertCoverage(connectorList, { connector: true })).toEqual([]);
  });

  // The other direction, so this cannot quietly become a test of nothing.
  it("reports a tool that is advertised but unplanned", () => {
    for (const connector of [false, true]) {
      const list = connector ? connectorList : everywhere;
      const problems = assertCoverage([...list, "definitely_not_a_tool"], { connector });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/definitely_not_a_tool/);
    }
  });

  it("reports an exclusion that is no longer advertised", () => {
    // Drop `login`, a named exclusion, from the advertised set.
    const advertised = everywhere.filter((n) => n !== "login");
    expect(assertCoverage(advertised, { connector: false }).join(" ")).toMatch(/excluded tool 'login' is not advertised/);
  });

  it("reports a connector-only tool advertised outside the connector", () => {
    expect(assertCoverage([...everywhere, "show_project"], { connector: false })).toEqual([
      "connector-only tool 'show_project' is advertised outside the connector",
    ]);
    expect(assertCoverage(connectorList, { connector: false })).toEqual([
      "connector-only tool 'show_project' is advertised outside the connector",
      "connector-only tool 'read_project_view' is advertised outside the connector",
    ]);
  });

  it("reports a connector-only tool the connector does not advertise", () => {
    expect(assertCoverage(connectorList.filter((n) => n !== "read_project_view"), { connector: true })).toEqual([
      "connector-only tool 'read_project_view' is not advertised to the connector",
    ]);
    expect(assertCoverage(everywhere, { connector: true })).toEqual([
      "connector-only tool 'show_project' is not advertised to the connector",
      "connector-only tool 'read_project_view' is not advertised to the connector",
    ]);
  });
});

describe("the connector-only rows", () => {
  const ctx = (connector?: boolean): SmokeCtx => ({
    mode: "no-bearer",
    projectPath: "/proj_0123456789abcdef",
    hostProjectDir: null,
    missingProjectPath: "/proj_fedcba9876543210",
    connector,
    openRouterKeyConfigured: false,
    values: {},
  });

  const row = (tool: string) => {
    const step = CALL_PLAN.find((s) => s.tool === tool);
    if (!step) throw new Error(`no row for ${tool}`);
    return step;
  };

  /** The tools `runPlan` calls for one caller, with its per-row report lines muted. */
  async function toolsRun(connector?: boolean, offlineOnly = true): Promise<string[]> {
    const seen: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runPlan(
        async (tool) => {
          seen.push(tool);
          return { isError: false, body: {}, text: "" };
        },
        ctx(connector),
        { offlineOnly },
      );
    } finally {
      log.mockRestore();
    }
    return seen;
  }

  it("run for a connector caller and for no other, offline or not", async () => {
    for (const offlineOnly of [true, false]) {
      expect(await toolsRun(true, offlineOnly)).toEqual(expect.arrayContaining(["show_project", "read_project_view"]));
      for (const connector of [undefined, false]) {
        const seen = await toolsRun(connector, offlineOnly);
        expect(seen.length).toBeGreaterThan(0);
        expect(seen).not.toContain("show_project");
        expect(seen).not.toContain("read_project_view");
      }
    }
  });

  it("sit after the create that claims the project", () => {
    const create = CALL_PLAN.findIndex((s) => s.tool === "project_create" && s.label === undefined);
    expect(create).toBeGreaterThanOrEqual(0);
    expect(CALL_PLAN.indexOf(row("show_project"))).toBeGreaterThan(create);
    expect(CALL_PLAN.indexOf(row("read_project_view"))).toBeGreaterThan(create);
  });

  // The documents as the hand-built `project_create` row writes them.
  const documents = {
    research: { project: { objective: "Does this transport reach every tool?" } },
    tree: { persons: [{ id: "P1" }] },
  };
  const answered = (over: Partial<CallResult>): CallResult => ({ isError: false, body: {}, text: "", ...over });

  it("pass when the documents arrived", () => {
    const entry = { ...documents, echo: { projectPath: ctx().projectPath } };
    expect(row("show_project").expect(answered({ meta: { "genealogy/project": entry } }), ctx(true)).ok).toBe(true);
    expect(row("read_project_view").expect(answered({ structured: documents }), ctx(true)).ok).toBe(true);
  });

  it.each([
    ["no _meta", undefined],
    ["an empty _meta", {}],
    ["an empty entry", { "genealogy/project": {} }],
    ["the large-result cut", { "genealogy/project": { derived: {}, echo: { projectPath: ctx().projectPath } } }],
    ["no echo", { "genealogy/project": documents }],
    ["another project's echo", { "genealogy/project": { ...documents, echo: { projectPath: "/proj_ffffffffffffffff" } } }],
    ["another project's research", {
      "genealogy/project": {
        research: { project: { objective: "Another" } },
        tree: documents.tree,
        echo: { projectPath: ctx().projectPath },
      },
    }],
    ["no tree", { "genealogy/project": { research: documents.research, tree: null, echo: { projectPath: ctx().projectPath } } }],
  ])("fail show_project on %s", (_name, meta) => {
    expect(row("show_project").expect(answered({ meta }), ctx(true)).ok).toBe(false);
  });

  it.each([
    ["no structuredContent", undefined],
    ["an empty structuredContent", {}],
    ["no tree", { research: documents.research, tree: null }],
    ["another project's research", { research: { project: { objective: "Another" } }, tree: documents.tree }],
  ])("fail read_project_view on %s", (_name, structured) => {
    expect(row("read_project_view").expect(answered({ structured }), ctx(true)).ok).toBe(false);
  });

  it("fail a refusal that carries the documents", () => {
    const entry = { ...documents, echo: { projectPath: ctx().projectPath } };
    expect(row("show_project").expect(answered({ isError: true, meta: { "genealogy/project": entry } }), ctx(true)).ok).toBe(false);
    expect(row("read_project_view").expect(answered({ isError: true, structured: documents }), ctx(true)).ok).toBe(false);
  });
});
