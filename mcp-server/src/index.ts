import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { wikipediaSearch, wikipediaSearchSchema, type WikipediaSearchInput } from "./tools/wikipedia.js";
import { placesTool, placesToolSchema, type PlacesToolInput } from "./tools/places.js";
import { loginTool, loginToolSchema, type LoginToolInput } from "./tools/login.js";
import { logoutTool, logoutToolSchema, type LogoutToolInput } from "./tools/logout.js";
import { authStatusTool, authStatusToolSchema, type AuthStatusToolInput } from "./tools/auth-status.js";
import { collectionsTool, collectionsToolSchema, type CollectionsToolInput } from "./tools/collections.js";
import { populationTool, populationToolSchema, type PopulationToolInput } from "./tools/population.js";
import { externalLinks, externalLinksSchema, type ExternalLinksToolInput } from "./tools/external-links.js";

const server = new Server(
  { name: "genealogy-mcp", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    wikipediaSearchSchema,
    placesToolSchema,
    loginToolSchema,
    logoutToolSchema,
    authStatusToolSchema,
    collectionsToolSchema,
    populationToolSchema,
    externalLinksSchema,
  ],
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
  if (request.params.name === "login") {
    try {
      const args = (request.params.arguments ?? {}) as unknown as LoginToolInput;
      const result = await loginTool(args);
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
  if (request.params.name === "logout") {
    try {
      const args = (request.params.arguments ?? {}) as unknown as LogoutToolInput;
      const result = await logoutTool(args);
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
  if (request.params.name === "auth_status") {
    try {
      const args = (request.params.arguments ?? {}) as unknown as AuthStatusToolInput;
      const result = await authStatusTool(args);
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
  if (request.params.name === "collections") {
    try {
      const args = request.params.arguments as unknown as CollectionsToolInput;
      const result = await collectionsTool(args);
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
  if (request.params.name === "population") {
    try {
      const args = request.params.arguments as unknown as PopulationToolInput;
      const result = await populationTool(args);
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
  if (request.params.name === "external_links") {
    try {
      const args = request.params.arguments as unknown as ExternalLinksToolInput;
      const result = await externalLinks(args);
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
