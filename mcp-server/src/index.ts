import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { wikipediaSearch, type WikipediaSearchInput } from "./tools/wikipedia.js";
import { placeSearchTool, type PlaceSearchToolInput } from "./tools/place-search.js";
import { loginTool, type LoginToolInput } from "./tools/login.js";
import { logoutTool, type LogoutToolInput } from "./tools/logout.js";
import { authStatusTool, type AuthStatusToolInput } from "./tools/auth-status.js";
import { placeCollectionsTool, type PlaceCollectionsToolInput } from "./tools/place-collections.js";
import { wikiSearch, type WikiSearchInput } from "./tools/wiki-search.js";
import { placeDistanceTool, type PlaceDistanceInput } from "./tools/distance.js";
import { populationTool, type PopulationToolInput } from "./tools/place-population.js";
import { placeExternalLinksTool, type PlaceExternalLinksToolInput } from "./tools/place-external-links.js";
import { imageReadTool, type ImageReadInput } from "./tools/image-read.js";
import { recordSearchTool } from "./tools/record-search.js";
import type { RecordSearchInput } from "./types/record-search.js";
import { personSearchTool, type PersonSearchInput } from "./tools/person-search.js";
import { matchTwoExamples } from "./tools/match-two-examples.js";
import type { MatchTwoExamplesInput } from "./types/match-two-examples.js";
import { personReadTool, type PersonReadToolInput } from "./tools/person-read.js";
import {
  personAncestorsTool,
  type PersonAncestorsInput,
} from "./tools/person-ancestors.js";
import { recordReadTool, type RecordReadInput } from "./tools/record-read.js";
import { fulltextSearchTool } from "./tools/fulltext-search.js";
import type { FulltextSearchInput } from "./types/fulltext-search.js";
import { wikiReadTool, type WikiReadInput } from "./tools/wiki-read.js";
import {
  wikiCountryHomeTool,
  wikiCountryGettingStartedTool,
  wikiCountryOnlineRecordsTool,
  wikiCountryResearchTipsTool,
  type WikiCountryInput,
} from "./tools/wiki-country-page.js";
import {
  validateResearchSchema,
  type ValidateResearchSchemaInput,
} from "./tools/validate-research-schema.js";
import {
  personRecordMatches,
  recordPersonMatches,
  personPersonMatches,
  recordRecordMatches,
} from "./tools/match-by-id.js";
import type { MatchByIdInput } from "./types/match-by-id.js";
import { sourceAttachmentsTool } from "./tools/source-attachments.js";
import type { SourceAttachmentsInput } from "./types/source-attachments.js";
import { imageSearchTool } from "./tools/image-search.js";
import type { ImageSearchInput } from "./types/image-search.js";
import { allToolSchemas } from "./tool-schemas.js";

const server = new Server(
  { name: "genealogy-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allToolSchemas,
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
  if (request.params.name === "person_search") {
    try {
      const args = request.params.arguments as unknown as PersonSearchInput;
      const result = await personSearchTool(args);
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
  if (request.params.name === "person_record_matches") {
    try {
      const args = request.params.arguments as unknown as MatchByIdInput;
      const result = await personRecordMatches(args);
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
  if (request.params.name === "record_person_matches") {
    try {
      const args = request.params.arguments as unknown as MatchByIdInput;
      const result = await recordPersonMatches(args);
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
  if (request.params.name === "person_person_matches") {
    try {
      const args = request.params.arguments as unknown as MatchByIdInput;
      const result = await personPersonMatches(args);
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
  if (request.params.name === "record_record_matches") {
    try {
      const args = request.params.arguments as unknown as MatchByIdInput;
      const result = await recordRecordMatches(args);
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
  if (request.params.name === "person_read") {
    try {
      const args = request.params.arguments as unknown as PersonReadToolInput;
      const result = await personReadTool(args);
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
  if (request.params.name === "person_ancestors") {
    try {
      const args = request.params.arguments as unknown as PersonAncestorsInput;
      const result = await personAncestorsTool(args);
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
  if (request.params.name === "record_read") {
    try {
      const args = request.params.arguments as unknown as RecordReadInput;
      const result = await recordReadTool(args);
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
  if (request.params.name === "validate_research_schema") {
    try {
      const args = request.params.arguments as unknown as ValidateResearchSchemaInput;
      const result = await validateResearchSchema(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "source_attachments") {
    try {
      const args = request.params.arguments as unknown as SourceAttachmentsInput;
      const result = await sourceAttachmentsTool(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "image_search") {
    try {
      const args = request.params.arguments as unknown as ImageSearchInput;
      const result = await imageSearchTool(args);
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
