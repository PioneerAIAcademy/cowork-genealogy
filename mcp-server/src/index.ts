import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { wikipediaSearch, wikipediaSearchSchema, type WikipediaSearchInput } from "./tools/wikipedia.js";
import { placesTool, placesToolSchema, type PlacesToolInput } from "./tools/places.js";

const server = new Server(
  { name: "genealogy-mcp", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [wikipediaSearchSchema, placesToolSchema]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "wikipedia_search") {
    try {
      const args = request.params.arguments as unknown as WikipediaSearchInput;
      const result = await wikipediaSearch(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true
      };
    }
  }
  if (request.params.name === "places") {
    try {
      const args = request.params.arguments as unknown as PlacesToolInput;
      const result = await placesTool(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true
      };
    }
  }
  throw new Error(`Unknown tool: ${request.params.name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
