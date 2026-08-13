import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A UTF-8 BOM sits before the opening `---` of the frontmatter, so the
// frontmatter stops parsing: no name, no description, no allowed-tools. The
// eval harness derives its allowlist from allowed-tools and denies every
// genealogy tool it didn't grant, so the run completes, makes zero tool calls,
// and reports that its tools are gated. Invisible in an editor and in a diff —
// a Windows "UTF-8 with BOM" save is all it takes (PR #1461).
//
// Frontmatter only, on purpose. A BOM in a JSON fixture or a .bat announces
// itself with a parse error the first time anything reads it; this is the one
// place it fails silently and costs a paid run to find.
//
// Compared as bytes, not as a "﻿" string literal, so this file cannot
// carry an invisible copy of the character it is checking for.
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, "..", "..", "..", "plugin");

const files = [
  ...readdirSync(join(pluginRoot, "skills"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join("skills", e.name, "SKILL.md")),
  ...readdirSync(join(pluginRoot, "agents"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => join("agents", f)),
];

describe("no UTF-8 BOM in plugin markdown", () => {
  it("finds skills and agents to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)("%s starts with its frontmatter, not a BOM", (rel) => {
    expect(readFileSync(join(pluginRoot, rel)).subarray(0, 3).equals(BOM)).toBe(false);
  });
});
