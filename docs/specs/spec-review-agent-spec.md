# Specification: Spec Review Subagent

## Purpose

A Claude Code subagent that reviews implementation code against its documented specification. It systematically checks whether the implementation fulfills each requirement in the spec and verifies test coverage.

---

## Invocation

Users invoke the agent via @-mention or natural language:

```
@"spec-review (agent)" wikipedia-tool-spec
@"spec-review (agent)" oauth-auth-spec with verbose output
@"spec-review (agent)" oauth-auth-spec using opus model
```

Or naturally:
```
Review the wikipedia tool implementation against its spec
Check if oauth-auth-spec was implemented correctly
```

**Input conventions:**

| Input | Resolved path |
|-------|---------------|
| `wikipedia-tool-spec` | `docs/specs/wikipedia-tool-spec.md` |
| `oauth-auth-spec` | `docs/specs/oauth-auth-spec.md` |

The agent prepends `docs/specs/` and appends `.md` if not provided.

**Model override:** Default is `sonnet`. User can request `opus` for thorough review via prompt.

**Verbose mode:** User can request verbose output for line-by-line checks.

---

## File to Create

| File | Purpose |
|------|---------|
| `.claude/agents/spec-review.md` | Subagent definition with YAML frontmatter and review methodology |

---

## Agent Definition

### Frontmatter

```yaml
---
name: spec-review
description: Reviews implementation code against documented specs in docs/specs/. Use when verifying that code correctly implements a specification, checking for alignment between spec requirements and actual implementation, or validating test coverage matches spec requirements.
tools: Read, Grep, Glob
model: sonnet
---
```

### Description Field (Critical)

The description determines when Claude auto-delegates. It should trigger on:
- "review implementation against spec"
- "check if spec was implemented correctly"
- "verify spec alignment"
- "compare implementation to specification"

---

## Review Methodology

The subagent follows this process:

### Step 1: Parse the Spec

Read the spec file from `docs/specs/{name}.md` and extract:

1. **Files to create/modify** — Table listing implementation files
2. **Input schema** — Expected input types and fields
3. **Output schema** — Expected output types and fields
4. **Error handling** — Expected error conditions and messages
5. **Patterns to follow** — Code style and structural requirements
6. **Testing plan** — Expected test files and test cases

### Step 2: Resolve Implementation Paths (Context-Aware)

Specs list relative paths like `src/tools/wikipedia.ts`. The agent must determine the root directory by examining project context:

**Resolution algorithm:**

1. Extract paths from the spec's "Files to Create/Modify" section
2. For each candidate root directory in the project (`mcp-server/`, `plugin/`, `./`):
   - Check if the relative paths resolve to existing files or valid parent directories
3. Select the root where paths resolve correctly
4. If multiple roots match, use hints from spec content:
   - Mentions "MCP server", "TypeScript", `package.json` → `mcp-server/`
   - Mentions "skills", "SKILL.md", "plugin" → `plugin/`
5. If no root matches (files don't exist yet), infer from spec context

**Example:**
```
Spec lists: "src/tools/wikipedia.ts"

Agent checks:
  ./src/tools/               → does not exist
  mcp-server/src/tools/      → exists ✓
  plugin/src/tools/          → does not exist

Root resolved: mcp-server/
Full path: mcp-server/src/tools/wikipedia.ts
```

### Step 3: Locate Implementation Files

Using the resolved root:
- Build full paths for each file in the spec
- Verify each file exists
- Note any files listed in spec but missing in implementation

### Step 4: Check Implementation Alignment

For each requirement category:

**Types alignment:**
- Compare interface/type definitions against spec
- Check field names, types, and optionality match

**Input schema alignment:**
- Verify tool schema matches spec's input definition
- Check required fields, types, descriptions

**Output schema alignment:**
- Verify returned object shape matches spec
- Check all specified fields are present

**Error handling alignment:**
- Verify error conditions are handled
- Check error messages match spec (exact or semantic match)

**Pattern alignment:**
- Verify code follows specified patterns (e.g., "use encodeURIComponent")
- Check structural requirements (e.g., "export function + schema")

### Step 5: Check Test Coverage

From the spec's "Testing Plan" section:
- Locate test files (typically in `tests/` directory under the resolved root)
- Check each specified test case has a corresponding test
- Note missing or extra tests

### Step 6: Classify Findings

| Classification | Criteria |
|----------------|----------|
| **Aligned** | Requirement is correctly implemented |
| **Minor Misalignment** | Cosmetic differences, slightly different wording, extra functionality not in spec, test named differently |
| **Major Misalignment** | Missing required functionality, wrong types/schema, missing/incorrect error handling, missing critical test coverage |

---

## Output Format

Console output with the following structure:

```
═══════════════════════════════════════════════════════════════
SPEC REVIEW: {spec-name}
═══════════════════════════════════════════════════════════════

STATUS: {ALIGNED | MINOR MISALIGNMENTS | MAJOR MISALIGNMENTS}

Root: mcp-server/

───────────────────────────────────────────────────────────────
FILES
───────────────────────────────────────────────────────────────
✓ src/types/wikipedia.ts
✓ src/tools/wikipedia.ts
✓ src/index.ts (modified)

───────────────────────────────────────────────────────────────
IMPLEMENTATION CHECKLIST
───────────────────────────────────────────────────────────────
Types:
  ✓ WikipediaAPIResponse interface defined
  ✓ WikipediaSearchResult interface defined

Input Schema:
  ✓ Tool name: "wikipedia_search"
  ✓ Required field: query (string)

Output Schema:
  ✓ Returns: title, extract, url

Error Handling:
  ✓ 404 → "No Wikipedia article found for '{query}'"
  ✓ Other errors → "Wikipedia API error: {status}"

Patterns:
  ✓ Uses encodeURIComponent for query
  ✓ Includes User-Agent header
  ✓ Exports function + schema

───────────────────────────────────────────────────────────────
TEST COVERAGE
───────────────────────────────────────────────────────────────
Specified: 5 tests
Found: 5 tests
Coverage: 100%

  ✓ returns article summary for valid query
  ✓ throws error when article not found (404)
  ✓ throws error on API failure
  ✓ encodes query parameter correctly
  ✓ includes User-Agent header

───────────────────────────────────────────────────────────────
FINDINGS
───────────────────────────────────────────────────────────────
No misalignments found.

═══════════════════════════════════════════════════════════════
```

### When Misalignments Exist

```
───────────────────────────────────────────────────────────────
FINDINGS
───────────────────────────────────────────────────────────────
MAJOR:
  ✗ Error handling: 404 case throws "Article not found" but spec
    requires "No Wikipedia article found for '{query}'"
    Location: src/tools/wikipedia.ts:25

MINOR:
  ~ Tool description slightly differs from spec (acceptable)
    Spec: "Search Wikipedia and return an article summary"
    Actual: "Search Wikipedia for an article summary"

═══════════════════════════════════════════════════════════════
```

### Verbose Mode

When user requests verbose output, include line-by-line checks:

```
───────────────────────────────────────────────────────────────
DETAILED CHECKS (verbose)
───────────────────────────────────────────────────────────────
[Types] Checking WikipediaAPIResponse...
  - title: string ✓
  - extract: string ✓
  - content_urls.desktop.page: string ✓

[Types] Checking WikipediaSearchResult...
  - title: string ✓
  - extract: string ✓
  - url: string ✓

[Schema] Checking tool registration...
  - name: "wikipedia_search" ✓
  - inputSchema.properties.query exists ✓
  - inputSchema.required includes "query" ✓
...
```

---

## Status Determination

| Status | Condition |
|--------|-----------|
| **ALIGNED** | Zero major misalignments, zero or few minor misalignments |
| **MINOR MISALIGNMENTS** | Zero major misalignments, one or more minor misalignments |
| **MAJOR MISALIGNMENTS** | One or more major misalignments |

---

## Edge Cases

| Condition | Behavior |
|-----------|----------|
| Spec file not found | Error: `Spec not found: docs/specs/{name}.md` |
| Cannot resolve root | Warning: `Could not determine root directory. Checking paths as-is.` |
| Implementation file missing | Major misalignment: `File not found: {path}` |
| Test file missing | Major misalignment: `Test file not found: {path}` |
| Spec has no testing section | Skip test coverage check, note in output |
| Spec format unrecognized | Warning + best-effort parse |

---

## Tools Required

| Tool | Purpose |
|------|---------|
| `Read` | Read spec and implementation files |
| `Glob` | Find files, check directory existence, locate test files |
| `Grep` | Search for specific patterns in code |

---

## Implementation Notes

1. **Spec parsing is heuristic** — Specs follow a consistent markdown structure but the agent should handle variations gracefully

2. **Semantic vs exact matching** — For error messages, check semantic equivalence (same meaning) not just exact string match

3. **Trust but verify** — Start by trusting the spec's file list, but note if implementation has extra files not mentioned

4. **No code execution** — The agent reads and analyzes code statically; it does not run tests

5. **Conservative classification** — When uncertain whether something is a misalignment, classify as minor rather than major

6. **Context-aware path resolution** — Never hardcode root directories; always infer from project structure and spec content
