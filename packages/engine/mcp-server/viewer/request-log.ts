// What the request log may say about a JSON-RPC exchange. Method and tool names are
// logged only when this server knows them or they have a method's shape. clientInfo,
// the declared extensions and the user agent are client text, logged as sent, because
// they are what M0 is here to record. Only a caller holding the secret reaches them.
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { READ_PROJECT_VIEW, SHOW_PROJECT } from "../src/tools/project-view.js";

export type LogFields = Record<string, unknown>;

const KNOWN_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/read",
  "resources/templates/list",
]);
const KNOWN_TOOLS = new Set([SHOW_PROJECT, READ_PROJECT_VIEW]);
/** An unknown method worth naming: M0 needs to see what a host tries. Letters and one
 *  slash, so it cannot carry a path with a leading slash or the hex secret. */
const METHOD_SHAPE = /^[a-z]+\/[a-zA-Z]{1,40}$/;
const VERSION_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const USER_AGENT_SHAPE = /^[\w .,;:()/+-]{1,120}$/;

/** The protocol version and client a request's headers name, when each looks like one.
 *  A stateless call carries no clientInfo, so this is the only way to tell who made it. */
export function headerFields(headers: { "mcp-protocol-version"?: unknown; "user-agent"?: unknown }): LogFields {
  const version = headers["mcp-protocol-version"];
  const agent = headers["user-agent"];
  return {
    ...(typeof version === "string" && VERSION_SHAPE.test(version) ? { protocolVersion: version } : {}),
    ...(typeof agent === "string" && USER_AGENT_SHAPE.test(agent) ? { userAgent: agent } : {}),
  };
}

interface RpcShape {
  method?: unknown;
  params?: { name?: unknown; clientInfo?: unknown; capabilities?: { extensions?: unknown } };
}

/** Written in place of a line that cannot be built. It repeats nothing a client sent. */
const UNWRITABLE_LINE = JSON.stringify({ logError: "these fields could not be written" });

/** One log line, which never throws. `fields` can hold client data nested too deep
 *  to stringify, and the HTTP log runs outside any catch: a throw there ends the process. */
export function logLine(fields: LogFields): string {
  try {
    return JSON.stringify(fields);
  } catch {
    return UNWRITABLE_LINE;
  }
}

/** The log fields for one JSON-RPC message. */
export function describeRpc(body: unknown): LogFields {
  const message = body as RpcShape | null | undefined;
  const method = typeof message?.method === "string" && KNOWN_METHODS.has(message.method) ? message.method : "other";
  const params = message?.params;
  if (method === "other" && typeof message?.method === "string" && METHOD_SHAPE.test(message.method)) {
    return { method, name: message.method };
  }
  if (method === "tools/call") {
    const name = params?.name;
    return { method, tool: typeof name === "string" && KNOWN_TOOLS.has(name) ? name : "other" };
  }
  if (method === "initialize") {
    return { method, clientInfo: params?.clientInfo, extensions: params?.capabilities?.extensions };
  }
  return { method };
}

/** Calls `onSend` with each message `transport` sends and its size in bytes. */
export function observeSends(transport: Transport, onSend: (message: JSONRPCMessage, bytes: number) => void): void {
  const send = transport.send.bind(transport);
  transport.send = (message, options) => {
    onSend(message, Buffer.byteLength(JSON.stringify(message), "utf8"));
    return send(message, options);
  };
}

/**
 * One log line per message on a long-lived transport, written when the response
 * goes out so it carries the size. Set before `server.connect`, which chains this
 * `onmessage` ahead of its own.
 */
export function logExchanges(transport: Transport, write: (fields: LogFields) => void): void {
  const pending = new Map<string | number, LogFields>();
  transport.onmessage = (message) => {
    const fields = describeRpc(message);
    if ("id" in message && message.id !== undefined) pending.set(message.id, fields);
    else write(fields);
  };
  observeSends(transport, (message, bytes) => {
    if (!("id" in message) || message.id === undefined) return;
    const fields = pending.get(message.id);
    if (!fields) return;
    pending.delete(message.id);
    write({ ...fields, resultBytes: bytes });
  });
}
