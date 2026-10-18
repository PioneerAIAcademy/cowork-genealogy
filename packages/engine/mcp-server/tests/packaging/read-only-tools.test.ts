import { describe, it, expect } from "vitest";
import { READ_ONLY } from "../../src/tool-schemas.js";
import { listTools } from "../helpers/list-tools.js";

// Pins the tools Claude Code may run side by side: it treats an MCP tool as
// concurrency-safe only when the tool carries annotations.readOnlyHint === true.
// Changing the set is a concurrency decision — read the tool's implementation
// against the rule stated at READ_ONLY, then update this list with it.
const PINNED = [
  "auth_status",
  "catalog_search",
  "census_children_gap",
  "collections_search",
  "convert_calendar",
  "external_links_search",
  "fulltext_search",
  "get_name_variants",
  "image_read",
  "image_search",
  "image_transcribe",
  "merge_warnings",
  "person_ancestors",
  "person_person_matches",
  "person_quality",
  "person_read",
  "person_record_matches",
  "person_search",
  "person_warnings",
  "place_distance",
  "place_population",
  "place_search",
  "place_search_all",
  "project_context",
  "rank_search_matches",
  "record_person_matches",
  "record_read",
  "record_record_matches",
  "record_search",
  "research_query",
  "sidecar_read",
  "source_attachments",
  "tree_gaps",
  "validate_research_schema",
  "volume_bisect",
  "volume_search",
  "wiki_place_page",
  "wiki_read",
  "wiki_search",
  "wikipedia_search",
];

// Never concurrency-safe, whatever the pin above says: each writes research.json
// or the tree, or leaves an effect a later call in the same batch can depend on.
const WRITERS = [
  "build_external_search_url", // writes a research.json log entry
  "extraction_append",
  "login",
  "logout",
  "materialize_facts",
  "merge_tree_persons",
  "project_create",
  "research_append",
  "research_log_append",
  "same_person", // records the match score research_append's link gate reads
  "tree_correct",
  "tree_edit",
  "tree_forget",
  // Not a writer: it ends the turn, so it must run after every call before it.
  "research_delivered",
];

describe("READ_ONLY", () => {
  it("is exactly the pinned set, and tools/list marks exactly those tools", async () => {
    expect([...READ_ONLY].sort()).toEqual(PINNED);
    const tools = await listTools();
    const marked = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name).sort();
    expect(marked).toEqual(PINNED);
  });

  it("never marks a writer", async () => {
    const listed = new Map((await listTools()).map((t) => [t.name, t]));
    for (const name of WRITERS) {
      expect(listed.has(name), `${name} is not an advertised tool`).toBe(true);
      expect(listed.get(name)?.annotations?.readOnlyHint, name).not.toBe(true);
    }
  });
});
