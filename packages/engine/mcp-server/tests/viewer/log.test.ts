import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeRpc, headerFields, logLine } from "../../viewer/request-log.js";
import {
  DEEP_JSON,
  PUBLIC_URL,
  rawInitialize,
  realFoldersOnly,
  SECRET,
  startViewer,
  tempFolders,
  writeProject,
} from "./harness.js";

realFoldersOnly();
const { base, root } = tempFolders();

describe("the request log", () => {
  it("writes one JSON line per request, with the method, tool and result size", async () => {
    writeProject(join(root(), "proj"));
    const viewer = await startViewer(root());
    await viewer.call("show_project", { show: "setup", projectPath: "proj", pad: 5_000 });
    await viewer.rpc("tools/list");
    const [call, list] = await viewer.logged(2);
    expect(viewer.log).toHaveLength(2);
    expect(call).toMatchObject({ route: "mcp", status: 200, method: "tools/call", tool: "show_project" });
    expect(call.resultBytes).toBeGreaterThan(5_000);
    expect(list).toMatchObject({ route: "mcp", status: 200, method: "tools/list" });
    expect(list).not.toHaveProperty("tool");
  });

  it("logs a 404 as only that, whichever path or token it was", async () => {
    const viewer = await startViewer(root());
    await fetch(`${viewer.origin}/some/secret/looking/path`);
    await fetch(`${viewer.origin}/img/not-a-token`);
    await fetch(`${viewer.origin}/${SECRET}/mcp/deeper`);
    const lines = await viewer.logged(3);
    for (const line of lines) expect(Object.keys(line).sort()).toEqual(["status", "t"]);
    expect(lines.map((line) => line.status)).toEqual([404, 404, 404]);
  });

  it("carries no secret, root path, project path or token through a full session", async () => {
    const project = writeProject(join(root(), "proj-name"));
    mkdirSync(join(project, "images"));
    writeFileSync(join(project, "images", "page.jpg"), "x", "utf8");
    const viewer = await startViewer(root(), { local: true });

    const args = { part: "image", id: "images/page.jpg", projectPath: project };
    const { url } = (await viewer.call("read_project_view", args)).structuredContent;
    const imagePath = url.slice(PUBLIC_URL.length);
    const token = imagePath.slice("/img/".length);
    await fetch(`${viewer.origin}${imagePath}`);
    await fetch(`${viewer.origin}/${SECRET}/`);
    await fetch(`${viewer.origin}/img/${token}x`);
    await viewer.call("show_project", { show: "setup", projectPath: project });
    await viewer.call("show_project", { show: "setup", projectPath: join(base(), "elsewhere") });
    await viewer.rpc("resources/read", { uri: `file://${project}/${SECRET}` });
    await viewer.rpc(`${project}/${SECRET}`);
    await viewer.call(`${project}/${token}`);
    await fetch(`${viewer.origin}/${SECRET}/mcp`, { method: "GET" });
    await fetch(`${viewer.origin}/${SECRET}/mcp`, { method: "POST", body: `{"${SECRET}` });

    const lines = await viewer.logged(10);
    expect(lines.map((line) => line.route)).toContain("img");
    expect(lines.map((line) => line.route)).toContain("page");
    const all = viewer.log.join("\n");
    for (const forbidden of [SECRET, base(), root(), "proj-name", token, token.split(".")[0], token.split(".")[1]]) {
      expect(all).not.toContain(forbidden);
    }
  });

  it("outlives a clientInfo too deep to stringify, on a reply and on a refusal", async () => {
    const viewer = await startViewer(root());
    const post = (body: string) =>
      fetch(`${viewer.origin}/${SECRET}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body,
      });
    const held = await post(rawInitialize(`{"name":"c","version":"1","deep":${DEEP_JSON}}`));
    expect(held.status).toBe(200);
    expect((await held.json()).result.serverInfo.name).toBe("genealogy-viewer");
    expect((await post(rawInitialize(DEEP_JSON))).status).toBe(200);
    expect((await post(rawInitialize(DEEP_JSON, `"id":1`))).status).toBe(400);
    expect((await viewer.rpc("tools/list")).status).toBe(200);
    const lines = await viewer.logged(4);
    expect(lines.length).toBe(4);
    expect(lines.filter((line) => line.method === "tools/list").length).toBe(1);
  });
});

describe("logLine", () => {
  it("keeps client objects as objects", () => {
    const fields = { method: "initialize", clientInfo: { name: "c" }, extensions: { e: {} } };
    expect(JSON.parse(logLine(fields))).toEqual(fields);
  });

  it("writes a fixed line with no client data when the fields will not stringify", () => {
    const circular: Record<string, unknown> = { name: "client-sent" };
    circular.self = circular;
    for (const clientInfo of [circular, { name: "client-sent", big: 1n }]) {
      const line = logLine({ method: "initialize", clientInfo });
      expect(JSON.parse(line)).toEqual({ logError: "these fields could not be written" });
      expect(line).not.toContain("client-sent");
    }
  });
});

describe("describeRpc", () => {
  it("names only methods and tools this server knows", () => {
    expect(describeRpc({ method: "/Users/x/project" })).toEqual({ method: "other" });
    expect(describeRpc({ method: "tools/call", params: { name: "/Users/x/project" } })).toEqual({
      method: "tools/call",
      tool: "other",
    });
    expect(describeRpc({ method: "tools/call", params: { name: "read_project_view" } })).toEqual({
      method: "tools/call",
      tool: "read_project_view",
    });
  });

  it("names an unknown method only when it has a method's shape", () => {
    expect(describeRpc({ method: "server/discover" })).toEqual({ method: "other", name: "server/discover" });
    for (const method of ["/Users/x", "a/b/c", "server/abc123", "x".repeat(60), "bare"]) {
      expect(describeRpc({ method })).toEqual({ method: "other" });
    }
  });

  it("logs a protocol version header only when it looks like one", () => {
    expect(headerFields({ "mcp-protocol-version": "2026-07-28" })).toEqual({ protocolVersion: "2026-07-28" });
    for (const value of [undefined, "/Users/x", ["2026-07-28"], "2026-07-28x"]) {
      expect(headerFields({ "mcp-protocol-version": value })).toEqual({});
    }
  });

  it("logs a user agent only when it looks like one", () => {
    expect(headerFields({ "user-agent": "claude-code/2.1.318 (cli)" })).toEqual({ userAgent: "claude-code/2.1.318 (cli)" });
    for (const value of [undefined, "x".repeat(121), 'a"b', "line\nbreak"]) expect(headerFields({ "user-agent": value })).toEqual({});
  });

  it("takes clientInfo and the declared extensions from initialize", () => {
    const params = { clientInfo: { name: "c", version: "1" }, capabilities: { extensions: { e: {} }, roots: {} } };
    expect(describeRpc({ method: "initialize", params })).toEqual({
      method: "initialize",
      clientInfo: params.clientInfo,
      extensions: params.capabilities.extensions,
    });
  });

  it("survives anything", () => {
    for (const body of [null, 7, "x", [], {}, { method: 3 }]) expect(describeRpc(body)).toEqual({ method: "other" });
  });
});
