import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { wikipediaSearch, wikipediaSearchSchema, type WikipediaSearchInput } from "./tools/wikipedia.js";
import { placeSearchTool, placeSearchToolSchema, type PlaceSearchToolInput } from "./tools/place-search.js";
import { loginTool, loginToolSchema, type LoginToolInput } from "./tools/login.js";
import { logoutTool, logoutToolSchema, type LogoutToolInput } from "./tools/logout.js";
import { authStatusTool, authStatusToolSchema, type AuthStatusToolInput } from "./tools/auth-status.js";
import { collectionsTool, collectionsToolSchema, type CollectionsToolInput } from "./tools/collections.js";
import { searchWiki, searchWikiSchema, type SearchWikiInput } from "./tools/searchWiki.js";
import { placeDistanceTool, placeDistanceToolSchema, type PlaceDistanceInput } from "./tools/distance.js";
import { populationTool, populationToolSchema, type PopulationToolInput } from "./tools/place-population.js";
import { externalLinksTool, externalLinksToolSchema, type ExternalLinksToolInput } from "./tools/external-links.js";
import { imageReadTool, imageReadToolSchema, type ImageReadInput } from "./tools/image-read.js";
import { recordSearchTool, recordSearchToolSchema } from "./tools/record-search.js";
import type { RecordSearchInput } from "./types/record-search.js";
import { treeReadTool, treeReadToolSchema, type TreeReadToolInput } from "./tools/tree-read.js";
import { wikiFetchPageTool, wikiFetchPageSchema, type WikiFetchPageInput } from "./tools/wikiFetchPage.js";
import {
  wikiCountryHomeTool,
  wikiCountryHomeSchema,
  wikiCountryGettingStartedTool,
  wikiCountryGettingStartedSchema,
  wikiCountryRecordsTool,
  wikiCountryRecordsSchema,
  wikiCountryResearchTipsTool,
  wikiCountryResearchTipsSchema,
  type WikiCountryInput,
} from "./tools/wikiCountryPage.js";

const server = new Server(
  { name: "genealogy-mcp", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    wikipediaSearchSchema,
    placeSearchToolSchema,
    loginToolSchema,
    logoutToolSchema,
    authStatusToolSchema,
    collectionsToolSchema,
    searchWikiSchema,
    placeDistanceToolSchema,
    populationToolSchema,
    externalLinksToolSchema,
    imageReadToolSchema,
    recordSearchToolSchema,
    treeReadToolSchema,
    wikiFetchPageSchema,
    wikiCountryHomeSchema,
    wikiCountryGettingStartedSchema,
    wikiCountryRecordsSchema,
    wikiCountryResearchTipsSchema,
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
  if (request.params.name === "place_search") {
    try {
      const args = request.params.arguments as unknown as PlaceSearchToolInput;
      const result = await placeSearchTool(args);
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
  if (request.params.name === "place_collections") {
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
  if (request.params.name === "wiki_search") {
    try {
      const args = request.params.arguments as unknown as SearchWikiInput;
      const result = await searchWiki(args);
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
  if (request.params.name === "place_distance") {
    try {
      const args = request.params.arguments as unknown as PlaceDistanceInput;
      const result = await placeDistanceTool(args);
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
  if (request.params.name === "place_population") {
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
  if (request.params.name === "place_external_links") {
    try {
      const args = request.params.arguments as unknown as ExternalLinksToolInput;
      const result = await externalLinksTool(args);
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
  if (request.params.name === "image_read") {
    try {
      const args = request.params.arguments as unknown as ImageReadInput;
      const { imageData, metadata } = await imageReadTool(args);
      return {
        content: [
          { type: "image", data: imageData, mimeType: metadata.mimeType },
          { type: "text", text: JSON.stringify(metadata, null, 2) },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
  if (request.params.name === "record_search") {
    try {
      const args = request.params.arguments as unknown as RecordSearchInput;
      const result = await recordSearchTool(args);
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
  if (request.params.name === "tree_read") {
    try {
      const args = request.params.arguments as unknown as TreeReadToolInput;
      const result = await treeReadTool(args);
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
  if (request.params.name === "wiki_read") {
    try {
      const args = request.params.arguments as unknown as WikiFetchPageInput;
      const result = await wikiFetchPageTool(args);
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
  if (request.params.name === "wiki_country_home") {
    try {
      const args = request.params.arguments as unknown as WikiCountryInput;
      const result = await wikiCountryHomeTool(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "wiki_country_getting_started") {
    try {
      const args = request.params.arguments as unknown as WikiCountryInput;
      const result = await wikiCountryGettingStartedTool(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "wiki_country_online_records") {
    try {
      const args = request.params.arguments as unknown as WikiCountryInput;
      const result = await wikiCountryRecordsTool(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "wiki_country_research_tips") {
    try {
      const args = request.params.arguments as unknown as WikiCountryInput;
      const result = await wikiCountryResearchTipsTool(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  throw new Error(`Unknown tool: ${request.params.name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
