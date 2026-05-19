"""Tests for harness.tool_catalog — parse the production tool schemas
from mcp-server/src/tools/*.ts so the mock can advertise real descriptions.
"""

from pathlib import Path

from harness.tool_catalog import (
    default_tools_dir,
    load_tool_catalog,
    parse_tool_file,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
TOOLS_DIR = REPO_ROOT / "mcp-server" / "src" / "tools"


def test_default_tools_dir_resolves_to_real_path():
    d = default_tools_dir()
    assert d.is_dir(), f"expected tool source dir at {d}"


def test_parse_single_line_description():
    src = '''
export const fooSchema = {
  name: "foo",
  description: "do the foo thing.",
  inputSchema: { type: "object" as const, properties: {} },
};
'''
    out = parse_tool_file(src)
    assert out == {"foo": "do the foo thing."}


def test_parse_multiline_single_string_description():
    """`places.ts`-style: description on its own line, single string."""
    src = '''
export const placesSchema = {
  name: "places",
  description:
    "Look up place information for genealogy research.",
  inputSchema: { type: "object" as const, properties: {} },
};
'''
    out = parse_tool_file(src)
    assert out == {"places": "Look up place information for genealogy research."}


def test_parse_concatenated_multiline_description():
    """`external-links.ts`-style: description as a string-concat chain."""
    src = '''
export const externalLinksSchema = {
  name: "external_links",
  description:
    "Return FamilySearch-curated third-party genealogy resource URLs. " +
    "Use when the user wants links to external record collections. " +
    "Requires a place ID.",
  inputSchema: { type: "object" as const, properties: {} },
};
'''
    out = parse_tool_file(src)
    assert "external_links" in out
    desc = out["external_links"]
    assert desc.startswith("Return FamilySearch-curated")
    assert "external record collections" in desc
    assert desc.endswith("Requires a place ID.")
    # No stray + or quote characters in the joined string.
    assert "+" not in desc
    assert '"' not in desc


def test_parse_skips_property_descriptions_inside_inputSchema():
    """Properties inside inputSchema have their own `description:` lines;
    we must not pick them up as tool descriptions."""
    src = '''
export const fooSchema = {
  name: "foo",
  description: "tool-level description.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "param-level description" },
    },
  },
};
'''
    out = parse_tool_file(src)
    assert out["foo"] == "tool-level description."
    # No bogus extra entry from the param description.
    assert list(out.keys()) == ["foo"]


def test_parse_handles_multiple_schemas_in_one_file():
    src = '''
export const aSchema = {
  name: "a_tool",
  description: "first tool.",
  inputSchema: {},
};

export const bSchema = {
  name: "b_tool",
  description:
    "second tool description, multi-line " +
    "with concatenation.",
  inputSchema: {},
};
'''
    out = parse_tool_file(src)
    assert set(out.keys()) == {"a_tool", "b_tool"}
    assert out["a_tool"] == "first tool."
    assert out["b_tool"].startswith("second tool description")


def test_parse_returns_empty_when_no_schema_found():
    """Files that don't define a tool schema (utility modules) return
    empty without raising."""
    src = '''
export function helper(x: number): number {
  return x + 1;
}
'''
    assert parse_tool_file(src) == {}


def test_load_real_catalog_includes_known_tools():
    """Integration: pulls real descriptions from the live tools dir."""
    catalog = load_tool_catalog(TOOLS_DIR)
    # Known tools that should always be present.
    assert "wikipedia_search" in catalog
    assert "search_wiki" in catalog
    # Descriptions are non-empty and look like real prose, not stubs.
    for name in ("wikipedia_search", "search_wiki"):
        desc = catalog[name]
        assert len(desc) > 20
        assert "Mock" not in desc


def test_load_catalog_missing_dir_returns_empty():
    """Graceful degradation: if the tools dir doesn't exist we get {}
    so the mock falls back to its generic stub."""
    catalog = load_tool_catalog(Path("/does/not/exist"))
    assert catalog == {}
