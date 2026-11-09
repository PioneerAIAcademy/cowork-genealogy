// What the two entries do, kept here so importing it starts nothing.
import http from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getProjectStore } from "../src/store/project-store.js";
import { parseCliArgs, parseStdioArgs, UsageError } from "./args.js";
import { createViewer } from "./http.js";
import { createMcpServer } from "./mcp.js";
import { logExchanges, logLine } from "./request-log.js";

/** Only the entries read the page; the factories take its HTML as a parameter. */
export const PAGE_PATH = fileURLToPath(new URL("./page/viewer.html", import.meta.url));

const HOST = "127.0.0.1";

async function openRoot(root: string): Promise<string> {
  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    throw new UsageError(`--root cannot be opened: ${root}`);
  }
  if ((await getProjectStore().projectDirState(rootReal)) !== "directory") {
    throw new UsageError(`--root is not a folder: ${root}`);
  }
  return rootReal;
}

async function readPage(pagePath: string): Promise<string> {
  try {
    return await readFile(pagePath, "utf-8");
  } catch {
    throw new UsageError(`The viewer page is missing at ${pagePath}. Run make mcp-viewer-build first.`);
  }
}

export interface HttpDeps {
  pagePath: string;
  /** Gets the request log, and with --local the page URL, one line at a time. */
  out: (line: string) => void;
  openBrowser: (url: string) => Promise<unknown>;
}

export async function startHttp(argv: string[], deps: HttpDeps): Promise<http.Server> {
  const args = parseCliArgs(argv);
  const rootReal = await openRoot(args.root);
  const pageHtml = await readPage(deps.pagePath);
  const secret = args.local ? randomBytes(32).toString("base64url") : args.secret;
  const publicUrl = args.local ? `http://${HOST}:${args.port}` : args.publicUrl;
  const server = http.createServer(
    createViewer({ pageHtml, rootReal, secret, publicUrl, local: args.local, log: deps.out, now: Date.now }),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(args.port, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  if (!args.local) {
    deps.out(logLine({ listening: args.port }));
    return server;
  }
  // The URL goes out whether or not a browser opens, for someone who has none.
  const pageUrl = `${publicUrl}/${secret}/`;
  deps.out(pageUrl);
  if (args.open) await deps.openBrowser(pageUrl).catch(() => deps.out("Could not open a browser."));
  return server;
}

export interface StdioDeps {
  pagePath: string;
  /** Gets one JSON line per exchange. Never stdout, which is the protocol channel. */
  log: (line: string) => void;
}

export async function startStdio(argv: string[], deps: StdioDeps): Promise<void> {
  const { root } = parseStdioArgs(argv);
  const rootReal = await openRoot(root);
  const pageHtml = await readPage(deps.pagePath);
  const server = createMcpServer({ pageHtml, rootReal });
  const transport = new StdioServerTransport();
  logExchanges(transport, (fields) => deps.log(logLine({ t: new Date().toISOString(), ...fields })));
  await server.connect(transport);
}

/** An entry's last resort: a refusal to start exits 2, anything else 1. */
export function exitWith(error: unknown): never {
  process.stderr.write(`viewer: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(error instanceof UsageError ? 2 : 1);
}
