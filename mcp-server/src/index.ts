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
import { placeCollectionsTool, placeCollectionsToolSchema, type PlaceCollectionsToolInput } from "./tools/place-collections.js";
import { wikiSearch, wikiSearchSchema, type WikiSearchInput } from "./tools/wiki-search.js";
import { placeDistanceTool, placeDistanceToolSchema, type PlaceDistanceInput } from "./tools/distance.js";
import { populationTool, populationToolSchema, type PopulationToolInput } from "./tools/place-population.js";
import { placeExternalLinksTool, placeExternalLinksToolSchema, type PlaceExternalLinksToolInput } from "./tools/place-external-links.js";
import { imageReadTool, imageReadToolSchema, type ImageReadInput } from "./tools/image-read.js";
import { recordSearchTool, recordSearchToolSchema } from "./tools/record-search.js";
import type { RecordSearchInput } from "./types/record-search.js";
import { matchTwoExamples, matchTwoExamplesSchema } from "./tools/matchTwoExamples.js";
import type { MatchTwoExamplesInput } from "./types/matchTwoExamples.js";
import { treeReadTool, treeReadToolSchema, type TreeReadToolInput } from "./tools/tree-read.js";
import { fulltextSearchTool, fulltextSearchToolSchema } from "./tools/fulltext-search.js";
import type { FulltextSearchInput } from "./types/fulltext-search.js";
import { wikiReadTool, wikiReadSchema, type WikiReadInput } from "./tools/wiki-read.js";
import {
  wikiCountryHomeTool,
  wikiCountryHomeSchema,
  wikiCountryGettingStartedTool,
  wikiCountryGettingStartedSchema,
  wikiCountryOnlineRecordsTool,
  wikiCountryOnlineRecordsSchema,
  wikiCountryResearchTipsTool,
  wikiCountryResearchTipsSchema,
  type WikiCountryInput,
} from "./tools/wiki-country-page.js";

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
    placeCollectionsToolSchema,
    wikiSearchSchema,
    placeDistanceToolSchema,
    populationToolSchema,
    placeExternalLinksToolSchema,
    imageReadToolSchema,
    recordSearchToolSchema,
    matchTwoExamplesSchema,
    treeReadToolSchema,
    fulltextSearchToolSchema,
    wikiReadSchema,
    wikiCountryHomeSchema,
    wikiCountryGettingStartedSchema,
    wikiCountryOnlineRecordsSchema,
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
      const args = request.params.arguments as unknown as PlaceCollectionsToolInput;
      const result = await placeCollectionsTool(args);
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
      const args = request.params.arguments as unknown as WikiSearchInput;
      const result = await wikiSearch(args);
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
      const args = request.params.arguments as unknown as PlaceExternalLinksToolInput;
      const result = await placeExternalLinksTool(args);
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
  if (request.params.name === "match_two_examples") {
    try {
      const args = request.params.arguments as unknown as MatchTwoExamplesInput;
      const result = await matchTwoExamples(args);
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
  if (request.params.name === "fulltext_search") {
    try {
      const args = request.params.arguments as unknown as FulltextSearchInput;
      const result = await fulltextSearchTool(args);
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
      const args = request.params.arguments as unknown as WikiReadInput;
      const result = await wikiReadTool(args);
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
      const result = await wikiCountryOnlineRecordsTool(args);
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
