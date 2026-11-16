import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import type http from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PORT, parseCliArgs, UsageError } from "../../viewer/args.js";
import { startHttp } from "../../viewer/start.js";
import { ENGINE_ROOT, realFoldersOnly, SECRET, STUB_PAGE, tempFolders, writeProject } from "./harness.js";

realFoldersOnly();
const { base, root } = tempFolders();

const PUBLIC = "https://tunnel.example";
const remote = (extra: string[] = []) => ["--secret", SECRET, "--root", "/r", "--public-url", PUBLIC, ...extra];
const local = (extra: string[] = []) => ["--local", "--root", "/r", ...extra];

describe("parseCliArgs", () => {
  it("reads the remote form, defaulting the port", () => {
    expect(parseCliArgs(remote())).toEqual({
      local: false,
      root: "/r",
      port: DEFAULT_PORT,
      secret: SECRET,
      publicUrl: PUBLIC,
    });
    expect(DEFAULT_PORT).toBe(8090);
  });

  it("reads the local form, opening the browser unless told not to", () => {
    expect(parseCliArgs(local())).toEqual({ local: true, root: "/r", port: 8090, open: true });
    expect(parseCliArgs(local(["--no-open", "--port", "8191"]))).toEqual({
      local: true,
      root: "/r",
      port: 8191,
      open: false,
    });
  });

  it("accepts the spellings of a good value", () => {
    expect(parseCliArgs(remote(["--port=1"])).port).toBe(1);
    expect(parseCliArgs(remote(["--port", "65535"])).port).toBe(65535);
    expect(parseCliArgs(["--secret", "a".repeat(32), "--root", "/r", "--public-url", PUBLIC]).local).toBe(false);
    const url = (publicUrl: string) => parseCliArgs(["--secret", SECRET, "--root", "/r", "--public-url", publicUrl]);
    expect(url("https://tunnel.example/")).toMatchObject({ publicUrl: PUBLIC });
    expect(url("https://TUNNEL.example:8443")).toMatchObject({ publicUrl: "https://tunnel.example:8443" });
  });

  it.each([
    ["no root", ["--local"], /--root is required/],
    ["an empty root", ["--local", "--root", ""], /--root is required/],
    ["neither mode", ["--root", "/r"], /--secret is required/],
    ["no public URL", ["--secret", SECRET, "--root", "/r"], /--public-url is required/],
    ["no secret", ["--root", "/r", "--public-url", PUBLIC], /--secret is required/],
    ["--local with --secret", local(["--secret", SECRET]), /cannot be combined/],
    ["--local with --public-url", local(["--public-url", PUBLIC]), /cannot be combined/],
    ["--no-open without --local", remote(["--no-open"]), /--no-open only applies/],
    ["an unknown flag", local(["--host", "0.0.0.0"]), /--host/],
    ["a bare argument", local(["extra"]), /no bare arguments/],
    ["a flag with no value", ["--local", "--root"], /--root/],
    ["a short secret", ["--secret", "a".repeat(31), "--root", "/r", "--public-url", PUBLIC], /--secret must/],
    ["a secret with other characters", ["--secret", `${"a".repeat(32)}/`, "--root", "/r", "--public-url", PUBLIC], /--secret must/],
    ["a secret with a newline", ["--secret", `${"a".repeat(32)}\n`, "--root", "/r", "--public-url", PUBLIC], /--secret must/],
  ])("refuses %s", (_name, argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(UsageError);
    expect(() => parseCliArgs(argv)).toThrow(message);
  });

  it.each(["0", "65536", "-1", "abc", "80.5", "1e3", "", " 80", "0x50", "100000"])("refuses the port %j", (port) => {
    expect(() => parseCliArgs(local([`--port=${port}`]))).toThrow(/--port must be/);
  });

  it.each([
    "http://tunnel.example",
    "ftp://tunnel.example",
    "https://tunnel.example/path",
    "https://tunnel.example/?q=1",
    "https://tunnel.example?q=1",
    "https://tunnel.example#x",
    "https://user@tunnel.example",
    "https://user:pw@tunnel.example",
    "tunnel.example",
    "not a url",
    "",
  ])("refuses the public URL %j", (publicUrl) => {
    const argv = ["--secret", SECRET, "--root", "/r", `--public-url=${publicUrl}`];
    expect(() => parseCliArgs(argv)).toThrow(/--public-url must be|--public-url is required/);
  });

  it("never echoes a bad value, which may be the secret", () => {
    const bad = "sentinel-value-sentinel-value-sentinel/";
    for (const argv of [
      ["--secret", bad, "--root", "/r", "--public-url", PUBLIC],
      local([bad]),
      local([`--port=${bad}`]),
      ["--secret", SECRET, "--root", "/r", `--public-url=${bad}`],
      local([`--no-such-flag=${bad}`]),
    ]) {
      let message = "";
      try {
        parseCliArgs(argv);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("sentinel");
    }
  });
});

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((done) => {
          server.closeAllConnections();
          server.close(done);
        }),
    ),
  );
});

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const { port } = probe.address() as AddressInfo;
  await new Promise((done) => probe.close(done));
  return port;
}

function stubPage(): string {
  const pagePath = join(base(), "viewer.html");
  writeFileSync(pagePath, STUB_PAGE, "utf8");
  return pagePath;
}

async function start(argv: string[], pagePath = stubPage()) {
  const out: string[] = [];
  const openBrowser = vi.fn(async (_url: string) => undefined);
  const server = await startHttp(argv, { pagePath, out: (line) => out.push(line), openBrowser });
  servers.push(server);
  return { server, out, openBrowser };
}

describe("startHttp", () => {
  it("with --local: binds loopback, prints the page URL once, opens it, and serves it", async () => {
    writeProject(root());
    const port = await freePort();
    const { server, out, openBrowser } = await start(["--local", "--root", root(), "--port", String(port)]);
    expect(server.address()).toMatchObject({ address: "127.0.0.1", port });
    expect(out).toHaveLength(1);
    const pageUrl = out[0];
    expect(pageUrl).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/[A-Za-z0-9_-]{43}/$`));
    expect(openBrowser.mock.calls).toEqual([[pageUrl]]);
    const response = await fetch(pageUrl);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(STUB_PAGE);

    const reply = await fetch(`${pageUrl}mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "read_project_view", arguments: { part: "image", id: "images/a.jpg" } },
      }),
    });
    const { url } = (await reply.json()).result.structuredContent;
    expect(url.startsWith(`http://127.0.0.1:${port}/img/`)).toBe(true);
  });

  it("with --no-open: prints the URL and opens nothing", async () => {
    const port = await freePort();
    const { out, openBrowser } = await start(["--local", "--no-open", "--root", root(), "--port", String(port)]);
    expect(out).toHaveLength(1);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("still prints the URL, and keeps running, when no browser opens", async () => {
    const port = await freePort();
    const out: string[] = [];
    const server = await startHttp(["--local", "--root", root(), "--port", String(port)], {
      pagePath: stubPage(),
      out: (line) => out.push(line),
      openBrowser: () => Promise.reject(new Error("no browser")),
    });
    servers.push(server);
    expect(out[0]).toMatch(/^http:/);
    expect(out[1]).toMatch(/Could not open a browser/);
    expect(server.listening).toBe(true);
  });

  it("each --local start has its own secret", async () => {
    const [a, b] = [await freePort(), await freePort()];
    const first = await start(["--local", "--no-open", "--root", root(), "--port", String(a)]);
    const second = await start(["--local", "--no-open", "--root", root(), "--port", String(b)]);
    const secretOf = (url: string) => new URL(url).pathname;
    expect(secretOf(first.out[0])).not.toBe(secretOf(second.out[0]));
  });

  it("with --secret: serves the MCP route under it, no page, and never prints it", async () => {
    const port = await freePort();
    const argv = ["--secret", SECRET, "--public-url", PUBLIC, "--root", root(), "--port", String(port)];
    const { server, out, openBrowser } = await start(argv);
    expect(server.address()).toMatchObject({ address: "127.0.0.1", port });
    expect(openBrowser).not.toHaveBeenCalled();
    expect((await fetch(`http://127.0.0.1:${port}/${SECRET}/`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/${SECRET}/mcp`)).status).toBe(405);
    await vi.waitFor(() => expect(out.length).toBeGreaterThanOrEqual(3));
    expect(out.join("\n")).not.toContain(SECRET);
  });

  it("refuses a missing page file, naming make mcp-viewer-build", async () => {
    const pagePath = join(base(), "no-such-page.html");
    const argv = ["--local", "--no-open", "--root", root()];
    await expect(start(argv, pagePath)).rejects.toThrow(UsageError);
    await expect(start(argv, pagePath)).rejects.toThrow(/make mcp-viewer-build/);
  });

  it("refuses a root that does not exist, or is a file", async () => {
    const file = join(base(), "file.txt");
    writeFileSync(file, "x", "utf8");
    await expect(start(["--local", "--no-open", "--root", join(base(), "absent")])).rejects.toThrow(/--root cannot be opened/);
    await expect(start(["--local", "--no-open", "--root", file])).rejects.toThrow(/--root is not a folder/);
  });

  it("reports a port already in use", async () => {
    const port = await freePort();
    const argv = ["--local", "--no-open", "--root", root(), "--port", String(port)];
    await start(argv);
    await expect(start(argv)).rejects.toThrow(/EADDRINUSE/);
  });
});

/** Runs the real entry and resolves with how it exited. */
function runEntry(argv: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "viewer/cli.ts", ...argv], {
      cwd: ENGINE_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), 25_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe("the real entry", () => {
  it("viewer/cli.ts exits 2 on a bad value, saying so", async () => {
    const result = await runEntry(["--local", "--root", root(), "--port", "0"]);
    expect(result.code, result.stderr).toBe(2);
    expect(result.stderr).toMatch(/^viewer: --port must be/);
    expect(result.stdout).toBe("");
  });
});
