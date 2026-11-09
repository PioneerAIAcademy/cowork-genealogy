import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  DEEP_JSON,
  ENGINE_ROOT,
  rawInitialize,
  realFoldersOnly,
  refusal,
  RESEARCH,
  STUB_PAGE,
  tempFolders,
  writeProject,
} from "./harness.js";

realFoldersOnly();
const { base, root } = tempFolders();

const PAGE_URI = "ui://genealogy/viewer.html";
const UI_EXTENSION = { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } };

interface Session {
  client: Client;
  /** Every message the client could not read off stdout. */
  stdoutErrors: Error[];
  stderr: () => string;
}

async function connect(noise: "noise" | "quiet" = "quiet"): Promise<Session> {
  const pagePath = join(base(), "viewer.html");
  writeFileSync(pagePath, STUB_PAGE, "utf8");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "tests/viewer/stdio-entry.ts", pagePath, noise, "--root", root()],
    cwd: ENGINE_ROOT,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const client = new Client(
    { name: "stdio-probe", version: "9.9.9" },
    { capabilities: { extensions: UI_EXTENSION } },
  );
  const stdoutErrors: Error[] = [];
  client.onerror = (error) => stdoutErrors.push(error);
  await client.connect(transport);
  return { client, stdoutErrors, stderr: () => stderr };
}

describe("the stdio server", () => {
  it("speaks clean protocol on stdout and logs to stderr", async () => {
    const project = writeProject(join(root(), "proj"));
    mkdirSync(join(project, "results"));
    writeFileSync(join(project, "results", "log_001.json"), JSON.stringify({ hits: [] }), "utf8");
    const { client, stdoutErrors, stderr } = await connect();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(["read_project_view", "show_project"]);
      expect(client.getServerVersion()).toMatchObject({ title: "Genealogy Viewer" });

      const page = await client.readResource({ uri: PAGE_URI });
      expect(page.contents[0]).toMatchObject({ text: STUB_PAGE, mimeType: "text/html;profile=mcp-app" });
      expect((page.contents[0]._meta as any).ui.csp.resourceDomains).toEqual([]);

      const shown: any = await client.callTool({ name: "show_project", arguments: { show: "setup", projectPath: "proj" } });
      expect(shown.content[0].text.endsWith("CANARY-CONTENT-K7Q2")).toBe(true);
      expect(shown._meta["genealogy/project"].research).toEqual(RESEARCH);

      const read: any = await client.callTool({
        name: "read_project_view",
        arguments: { part: "results", id: "log_001", projectPath: "proj" },
      });
      expect(read.structuredContent).toEqual({ found: true, results: { hits: [] } });

      await vi.waitFor(() => expect(stderr()).toMatch(/"tool":"read_project_view"/));
      const lines = stderr().trim().split("\n").map((line) => JSON.parse(line));
      expect(lines.find((line) => line.method === "initialize")).toMatchObject({
        clientInfo: { name: "stdio-probe", version: "9.9.9" },
        extensions: UI_EXTENSION,
      });
      const call = lines.find((line) => line.tool === "show_project");
      expect(call).toMatchObject({ method: "tools/call" });
      expect(call.resultBytes).toBeGreaterThan(0);
      expect(stderr()).not.toContain(base());
      expect(stdoutErrors).toEqual([]);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("the stdout check fails when something else writes there", async () => {
    const { client, stdoutErrors } = await connect("noise");
    try {
      await client.listTools();
      expect(stdoutErrors.length).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("refuses a page image, saying images need the HTTP server", async () => {
    writeProject(root());
    const { client, stdoutErrors } = await connect();
    try {
      const result = await client.callTool({ name: "read_project_view", arguments: { part: "image", id: "images/a.jpg" } });
      expect(refusal(result)).toMatch(/images need the HTTP server/i);
      expect(stdoutErrors).toEqual([]);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("answers a clientInfo too deep to stringify, and the message after it", async () => {
    const pagePath = join(base(), "viewer.html");
    writeFileSync(pagePath, STUB_PAGE, "utf8");
    const entry = ["--import", "tsx", "tests/viewer/stdio-entry.ts", pagePath, "quiet", "--root", root()];
    const child = spawn(process.execPath, entry, { cwd: ENGINE_ROOT, stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    try {
      const initialize = rawInitialize(`{"name":"c","version":"1","deep":${DEEP_JSON}}`);
      child.stdin.write(`${initialize}\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n`);
      await vi.waitFor(() => expect(stdout.trim().split("\n").length).toBe(2), { timeout: 15_000 });
      const [first, second] = stdout.trim().split("\n").map((line) => JSON.parse(line));
      expect(first.result.serverInfo.name).toBe("genealogy-viewer");
      expect(second).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    } finally {
      child.kill();
    }
  }, 30_000);
});
