// One MCP Server: the two tools and the page resource. HTTP builds one per
// request; stdio builds one for the process.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { callTool, PAGE_URI, toolSchemas, type ToolContext } from "./tools.js";

export const PAGE_MIME_TYPE = "text/html;profile=mcp-app";
export const DISPLAY_NAME = "Genealogy Viewer";

export interface McpOptions extends ToolContext {
  pageHtml: string;
  /** The origin images load from. Absent on stdio. */
  publicUrl?: string;
}

export function createMcpServer(options: McpOptions): Server {
  const server = new Server(
    { name: "genealogy-viewer", title: DISPLAY_NAME, version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolSchemas }));
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    callTool(options, request.params.name, request.params.arguments ?? {}),
  );
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: PAGE_URI, name: DISPLAY_NAME, mimeType: PAGE_MIME_TYPE }],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== PAGE_URI) throw new McpError(ErrorCode.InvalidParams, "Unknown resource.");
    const resourceDomains = options.publicUrl ? [options.publicUrl] : [];
    return {
      contents: [
        {
          uri: PAGE_URI,
          mimeType: PAGE_MIME_TYPE,
          text: options.pageHtml,
          _meta: { ui: { csp: { resourceDomains } } },
        },
      ],
    };
  });
  return server;
}
