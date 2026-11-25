// Every activity has a project (lead, 2026-11-19): every advertised tool requires
// `projectPath` and server.ts refuses a call with no project, except the six that
// manage projects or sign-in.
import { describe, it, expect } from "vitest";
import { allToolSchemas } from "../../src/tool-schemas.js";
import { PROJECT_EXEMPT_TOOLS, projectGateRefusal } from "../../src/utils/project-gate.js";
import { callTool } from "../helpers/call-tool.js";
import { makeLocalProject } from "../helpers/seed-project.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NAMES = allToolSchemas.map((t) => t.name);
const GATED = NAMES.filter((n) => !PROJECT_EXEMPT_TOOLS.has(n));

describe("the project gate", () => {
  it("exempts exactly the six project and sign-in tools and tree_gaps, all advertised", () => {
    expect([...PROJECT_EXEMPT_TOOLS].sort()).toEqual(
      ["auth_status", "login", "logout", "project_context", "project_create", "project_list", "tree_gaps"],
    );
    for (const name of PROJECT_EXEMPT_TOOLS) expect(NAMES).toContain(name);
  });

  it.each(GATED)("%s lists projectPath in required", (name) => {
    const schema = allToolSchemas.find((t) => t.name === name) as { inputSchema: { required?: string[]; properties: object } };
    expect(schema.inputSchema.properties).toHaveProperty("projectPath");
    expect(schema.inputSchema.required).toContain("projectPath");
  });

  it("refuses every gated tool with no projectPath, a blank one, or a folder that holds no project", async () => {
    const empty = await mkdtemp(join(tmpdir(), "gate-empty-"));
    try {
      for (const name of GATED) {
        for (const args of [{}, { projectPath: "" }, { projectPath: 7 }, { projectPath: empty }]) {
          const refusal = await projectGateRefusal(name, args);
          expect(refusal, `${name} ${JSON.stringify(args)}`).toMatch(/^No project: .*project_create.*init-project/s);
        }
      }
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("names a path that is not a folder as a missing path, not as a missing project", async () => {
    const missing = join(tmpdir(), "gate-no-such-folder-" + Date.now());
    const refusal = await projectGateRefusal("place_search", { projectPath: missing });
    expect(refusal).toBe(`projectPath does not exist: ${missing}`);
  });

  it("lets every gated tool through in a project, and the exempt ones through without one", async () => {
    const project = await makeLocalProject();
    try {
      for (const name of GATED) expect(await projectGateRefusal(name, { projectPath: project.dir }), name).toBeNull();
      for (const name of PROJECT_EXEMPT_TOOLS) expect(await projectGateRefusal(name, {}), name).toBeNull();
    } finally {
      await project.cleanup();
    }
  });

  it("refuses through the server, and runs the same tool once a project is named", async () => {
    const args = { date: { year: 1750, month: 2, day: 10 }, corrections: { osNsYear: true } };
    const refused = await callTool("convert_calendar", args);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("No project:");

    const project = await makeLocalProject();
    try {
      const ran = await callTool("convert_calendar", { ...args, projectPath: project.dir });
      expect(ran.isError).toBe(false);
      expect(JSON.parse(ran.text)).toMatchObject({ ok: true });
    } finally {
      await project.cleanup();
    }
  });

  it("leaves an unadvertised tool name to the server's Unknown tool error", async () => {
    await expect(callTool("no_such_tool", {})).rejects.toThrow(/Unknown tool/);
  });
});
