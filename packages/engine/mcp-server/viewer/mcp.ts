// One MCP Server per request: the two tools and the page resource.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  DISPLAY_NAME,
  PAGE_MIME_TYPE,
  pageResourceList,
  pageResourceRead,
  pageUri,
  pointAtPage,
  requirePageUri,
  UI_EXTENSION,
} from "../src/tools/project-view.js";
import { callTool, toolSchemas, type ToolContext } from "./tools.js";

export interface McpOptions extends ToolContext {
  pageHtml: string;
  /** The origin images load from. */
  publicUrl: string;
}

export function createMcpServer(options: McpOptions): Server {
  const server = new Server(
    { name: "genealogy-viewer", title: DISPLAY_NAME, version: "0.1.0" },
    // ext-apps' helpers set the tool _meta but not this; hosts look for it on the wire.
    { capabilities: { tools: {}, resources: {}, extensions: { [UI_EXTENSION]: { mimeTypes: [PAGE_MIME_TYPE] } } } },
  );
  const uri = pageUri(options.pageHtml);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: pointAtPage(toolSchemas, uri) }));
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    callTool(options, request.params.name, request.params.arguments ?? {}),
  );
  server.setRequestHandler(ListResourcesRequestSchema, async () => pageResourceList(uri));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    requirePageUri(request.params.uri);
    return pageResourceRead(request.params.uri, options.pageHtml, options.publicUrl);
  });
  return server;
}
