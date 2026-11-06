import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MAX_BODY_BYTES, PAGE_CSP } from "../../viewer/http.js";
import { PUBLIC_URL, realFoldersOnly, SECRET, startViewer, STUB_PAGE, tempFolders, writeProject } from "./harness.js";

realFoldersOnly();
const { root } = tempFolders();

const PAGE_URI = "ui://genealogy/viewer.html";
const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'";

describe("tools/list", () => {
  it("carries the card link, the app-only visibility and the read-only hint", async () => {
    const viewer = await startViewer(root());
    const { tools } = (await viewer.rpc("tools/list")).body.result;
    expect(tools.map((t: any) => t.name).sort()).toEqual(["read_project_view", "show_project"]);
    const show = tools.find((t: any) => t.name === "show_project");
    const read = tools.find((t: any) => t.name === "read_project_view");
    expect(show._meta.ui.resourceUri).toBe(PAGE_URI);
    expect(show._meta["ui/resourceUri"]).toBe(PAGE_URI);
    expect(read._meta.ui.visibility).toEqual(["app"]);
    expect(read._meta.ui.resourceUri).toBeUndefined();
    expect(read._meta["ui/resourceUri"]).toBeUndefined();
    expect(show.annotations.readOnlyHint).toBe(true);
    expect(read.annotations.readOnlyHint).toBe(true);
  });

  it("tells the model not to restate the card and states the project rule", async () => {
    const viewer = await startViewer(root());
    const { tools } = (await viewer.rpc("tools/list")).body.result;
    const { description } = tools.find((t: any) => t.name === "show_project");
    expect(description).toMatch(/researcher sees the card/);
    expect(description).toMatch(/do not restate/);
    for (const name of ["show_project", "read_project_view"]) {
      expect(tools.find((t: any) => t.name === name).description).toMatch(/bare folder name[\s\S]*refused with the list/i);
    }
  });
});

describe("the page resource", () => {
  it("is listed, and read with its MIME type and the public origin as a resource domain", async () => {
    const viewer = await startViewer(root());
    const { resources } = (await viewer.rpc("resources/list")).body.result;
    expect(resources).toEqual([expect.objectContaining({ uri: PAGE_URI, mimeType: "text/html;profile=mcp-app" })]);
    const { contents } = (await viewer.rpc("resources/read", { uri: PAGE_URI })).body.result;
    expect(contents).toHaveLength(1);
    expect(contents[0].text).toBe(STUB_PAGE);
    expect(contents[0].mimeType).toBe("text/html;profile=mcp-app");
    expect(contents[0]._meta.ui.csp.resourceDomains).toContain(PUBLIC_URL);
  });

  it("refuses any other resource", async () => {
    const viewer = await startViewer(root());
    const reply = await viewer.rpc("resources/read", { uri: "ui://genealogy/other.html" });
    expect(reply.body.error).toBeDefined();
    expect(reply.body.result).toBeUndefined();
  });
});

describe("paths", () => {
  const offSecret = [
    "/",
    "/mcp",
    "/livez",
    "/healthz",
    "/img",
    "/img/",
    "/img/x",
    `/${SECRET}`,
    `/${SECRET}/`,
    `/${SECRET}/mcp/`,
    `/${SECRET}/mcp/x`,
    `/${SECRET}/img/x`,
    `/${SECRET}x/mcp`,
    `/${SECRET.slice(0, -1)}/mcp`,
    `//${SECRET}/mcp`,
    `/x/${SECRET}/mcp`,
  ];

  it.each(offSecret)("answers 404 on %s", async (path) => {
    const viewer = await startViewer(root());
    const response = await fetch(`${viewer.origin}${path}`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  it("answers 404 to a POST off the secret", async () => {
    const viewer = await startViewer(root());
    const response = await fetch(`${viewer.origin}/mcp`, { method: "POST", body: "{}" });
    expect(response.status).toBe(404);
  });

  it("answers 405 to anything but POST on the MCP route", async () => {
    const viewer = await startViewer(root());
    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(`${viewer.origin}/${SECRET}/mcp`, { method });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });
});

describe("the page with --local", () => {
  it("is served at /<secret>/ with its CSP and hardening headers", async () => {
    const viewer = await startViewer(root(), { local: true });
    const response = await fetch(`${viewer.origin}/${SECRET}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(STUB_PAGE);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(response.headers.get("content-security-policy")).toBe(CSP);
    expect(PAGE_CSP).toBe(CSP);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("keeps a query string, which is how a tab says what to show", async () => {
    const viewer = await startViewer(root(), { local: true });
    expect((await fetch(`${viewer.origin}/${SECRET}/?show=plan`)).status).toBe(200);
  });

  it.each(["/", `/${SECRET}`, `/${SECRET}/x`, `/${SECRET}/viewer.html`, `/${SECRET}x/`, "/index.html"])(
    "is not served at %s",
    async (path) => {
      const viewer = await startViewer(root(), { local: true });
      expect((await fetch(`${viewer.origin}${path}`)).status).toBe(404);
    },
  );

  it("does not answer a POST at /<secret>/", async () => {
    const viewer = await startViewer(root(), { local: true });
    expect((await fetch(`${viewer.origin}/${SECRET}/`, { method: "POST" })).status).toBe(404);
  });

  it("is a 404 without --local", async () => {
    const viewer = await startViewer(root(), { local: false });
    expect((await fetch(`${viewer.origin}/${SECRET}/`)).status).toBe(404);
  });
});

describe("the POST body", () => {
  const post = (origin: string, body: string) =>
    fetch(`${origin}/${SECRET}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body,
    });

  it("answers bad JSON with a JSON-RPC parse error", async () => {
    const viewer = await startViewer(root());
    for (const body of ["{not json", ""]) {
      const response = await post(viewer.origin, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: expect.any(String) },
      });
    }
  });

  it("answers 413 over the cap and takes a body at the cap", async () => {
    const viewer = await startViewer(root());
    const atCap = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} }).padEnd(MAX_BODY_BYTES, " ");
    expect(Buffer.byteLength(atCap)).toBe(MAX_BODY_BYTES);
    expect((await post(viewer.origin, atCap)).status).toBe(200);
    const response = await post(viewer.origin, `${atCap} `);
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBeLessThan(0);
  });

  it("refuses a batch of any length before a server sees it", async () => {
    const viewer = await startViewer(root());
    const call = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const batches = [[call, { ...call, id: 2 }], [call], []];
    for (const batch of batches) {
      const response = await post(viewer.origin, JSON.stringify(batch));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Batches are not supported." },
      });
    }
    for (const line of await viewer.logged(batches.length)) {
      expect(Object.keys(line).sort()).toEqual(["route", "status", "t"]);
    }
  });

  it("still serves the next request after a refused one", async () => {
    const viewer = await startViewer(root());
    await post(viewer.origin, "{not json");
    await post(viewer.origin, "[]");
    expect((await viewer.rpc("tools/list")).status).toBe(200);
  });
});

describe("no response carries a CORS header", () => {
  const origin = { Origin: "https://evil.example" };

  it("in any mode, on any route", async () => {
    writeProject(root());
    mkdirSync(join(root(), "images"));
    writeFileSync(join(root(), "images", "a.jpg"), "x", "utf8");
    for (const local of [false, true]) {
      const viewer = await startViewer(root(), { local });
      const { url } = (await viewer.call("read_project_view", { part: "image", id: "images/a.jpg" })).structuredContent;
      const image = await fetch(`${viewer.origin}${url.slice(PUBLIC_URL.length)}`, { headers: origin });
      const mcp = await fetch(`${viewer.origin}/${SECRET}/mcp`, {
        method: "POST",
        headers: { ...origin, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      const page = await fetch(`${viewer.origin}/${SECRET}/`, { headers: origin });
      expect([image.status, mcp.status, page.status]).toEqual([200, 200, local ? 200 : 404]);
      const responses = [
        image,
        mcp,
        page,
        await fetch(`${viewer.origin}/`, { headers: origin }),
        await fetch(`${viewer.origin}/${SECRET}/mcp`, { headers: origin }),
        await fetch(`${viewer.origin}/${SECRET}/mcp`, {
          method: "OPTIONS",
          headers: { ...origin, "Access-Control-Request-Method": "POST" },
        }),
      ];
      for (const response of responses) {
        expect([...response.headers.keys()].filter((name) => name.startsWith("access-control-"))).toEqual([]);
      }
    }
  });
});

describe("a real client", () => {
  it("initializes, lists and calls through the SDK, and the log records what it declared", async () => {
    writeProject(root());
    const viewer = await startViewer(root());
    const client = new Client(
      { name: "probe-host", version: "1.2.3" },
      { capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } },
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(`${viewer.origin}/${SECRET}/mcp`)));
    try {
      expect(client.getServerVersion()).toMatchObject({ title: "Genealogy Viewer" });
      expect(client.getServerCapabilities()).toMatchObject({
        tools: {},
        resources: {},
        extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } },
      });
      const result = await client.callTool({ name: "show_project", arguments: { show: "setup" } });
      expect(result.isError).toBeUndefined();
    } finally {
      await client.close();
    }
    const lines = await viewer.logged(3);
    expect(lines.find((line) => line.method === "initialize")).toMatchObject({
      route: "mcp",
      status: 200,
      clientInfo: { name: "probe-host", version: "1.2.3" },
      extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } },
    });
  });
});
