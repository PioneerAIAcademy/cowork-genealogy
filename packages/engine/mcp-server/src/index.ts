import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { wikipediaSearch, type WikipediaSearchInput } from "./tools/wikipedia.js";
import {
  placeSearchTool,
  placeSearchAllTool,
  type PlaceSearchToolInput,
  type PlaceSearchAllToolInput,
} from "./tools/place-search.js";
import { loginTool, type LoginToolInput } from "./tools/login.js";
import { logoutTool, type LogoutToolInput } from "./tools/logout.js";
import { authStatusTool, type AuthStatusToolInput } from "./tools/auth-status.js";
import { collectionsSearchTool, type CollectionsSearchInput } from "./tools/collections-search.js";
import { collectionReadTool, type CollectionReadInput } from "./tools/collection-read.js";
import { wikiSearch, type WikiSearchInput } from "./tools/wiki-search.js";
import { placeDistanceTool, type PlaceDistanceInput } from "./tools/distance.js";
import { populationTool, type PopulationToolInput } from "./tools/place-population.js";
import { externalLinksSearchTool, type ExternalLinksSearchInput } from "./tools/external-links-search.js";
import { imageReadTool, type ImageReadInput } from "./tools/image-read.js";
import { recordSearchTool } from "./tools/record-search.js";
import type { RecordSearchInput } from "./types/record-search.js";
import { personSearchTool, type PersonSearchInput } from "./tools/person-search.js";
import { samePerson } from "./tools/same-person.js";
import type { SamePersonInput } from "./types/same-person.js";
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
  wikiPlacePageTool,
  type WikiPlacePageInput,
} from "./tools/wiki-place-page.js";
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
import { personWarningsTool } from "./tools/person-warnings.js";
import type { PersonWarningsInput } from "./types/person-warnings.js";
import { mergeWarnings } from "./tools/merge-warnings.js";
import type { MergeWarningsInput } from "./types/merge-warnings.js";
import { volumeSearchTool } from "./tools/volume-search.js";
import type { VolumeSearchInput } from "./types/volume-search.js";
import {
  mergeRecordIntoTree,
  type MergeRecordIntoTreeInput,
} from "./tools/merge-record-into-tree.js";
import {
  mergeTreePersons,
  type MergeTreePersonsInput,
} from "./tools/merge-tree-persons.js";
import {
  researchLogAppend,
  type ResearchLogAppendInput,
} from "./tools/research-log-append.js";
import {
  convertCalendar,
  type ConvertCalendarInput,
} from "./tools/convert-calendar.js";
import { treeEdit, type TreeEditInput } from "./tools/tree-edit.js";
import {
  researchAppend,
  type ResearchAppendInput,
} from "./tools/research-append.js";
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
  if (request.params.name === "place_search_all") {
    try {
      const args = request.params.arguments as unknown as PlaceSearchAllToolInput;
      const result = await placeSearchAllTool(args);
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
  if (request.params.name === "collections_search") {
    try {
      const args = request.params.arguments as unknown as CollectionsSearchInput;
      const result = await collectionsSearchTool(args);
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
  if (request.params.name === "collection_read") {
    try {
      const args = request.params.arguments as unknown as CollectionReadInput;
      const result = await collectionReadTool(args);
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
  if (request.params.name === "external_links_search") {
    try {
      const args = request.params.arguments as unknown as ExternalLinksSearchInput;
      const result = await externalLinksSearchTool(args);
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
  if (request.params.name === "same_person") {
    try {
      const args = request.params.arguments as unknown as SamePersonInput;
      const result = await samePerson(args);
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
  if (request.params.name === "wiki_place_page") {
    try {
      const args = request.params.arguments as unknown as WikiPlacePageInput;
      const result = await wikiPlacePageTool(args);
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
  if (request.params.name === "person_warnings") {
    try {
      const args = request.params.arguments as unknown as PersonWarningsInput;
      const result = await personWarningsTool(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "merge_warnings") {
    try {
      const args = request.params.arguments as unknown as MergeWarningsInput;
      const result = await mergeWarnings(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "volume_search") {
    try {
      const args = request.params.arguments as unknown as VolumeSearchInput;
      const result = await volumeSearchTool(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "merge_record_into_tree") {
    try {
      const args = request.params.arguments as unknown as MergeRecordIntoTreeInput;
      const result = await mergeRecordIntoTree(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "merge_tree_persons") {
    try {
      const args = request.params.arguments as unknown as MergeTreePersonsInput;
      const result = await mergeTreePersons(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "research_log_append") {
    try {
      const args = request.params.arguments as unknown as ResearchLogAppendInput;
      const result = await researchLogAppend(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "convert_calendar") {
    try {
      const args = request.params.arguments as unknown as ConvertCalendarInput;
      const result = convertCalendar(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "tree_edit") {
    try {
      const args = request.params.arguments as unknown as TreeEditInput;
      const result = await treeEdit(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  }
  if (request.params.name === "research_append") {
    try {
      const args = request.params.arguments as unknown as ResearchAppendInput;
      const result = await researchAppend(args);
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
