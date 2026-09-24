import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, chmod, symlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import {
  sidecarRead,
  fitPage,
  SIDECAR_READ_MAX_CHARS,
} from "../../src/tools/sidecar-read.js";
import { writerToolResult } from "../../src/tool-result.js";
import { setProjectStore, type ProjectStore } from "../../src/store/project-store.js";
import { NO_PROJECT_MESSAGE_READ } from "../../src/utils/project-io.js";

/** The CLI spills any tool result longer than this to a file (spec §4). */
const CLI_SPILL_CHARS = 50_000;

/** A ProjectStore stub whose readText returns `text` and records its calls. */
function storeReturning(text: string, calls: Array<[string, string]> = []): ProjectStore {
  return {
    withTransaction: (_p, fn) => fn(),
    classifyProject: async () => "project",
    projectDirState: async () => "directory",
    findNestingAncestor: async () => null,
    exists: async () => {
      throw new Error("sidecar_read must not use exists()");
    },
    readText: async (projectPath, ref) => {
      calls.push([projectPath, ref]);
      return text;
    },
    readBytes: async () => {
      throw new Error("sidecar_read must not use readBytes()");
    },
    list: async () => [],
    writeJson: async () => {},
    writeJsonBoth: async () => {},
    writeBytes: async () => {},
    appendText: async () => {},
    remove: async () => {},
  };
}

describe("sidecar_read", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sidecar-read-test-"));
    // A project: both files present, so classifyProjectPath says "project".
    await writeFile(join(dir, "research.json"), "{}", "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), "{}", "utf-8");
  });
  afterEach(async () => {
    setProjectStore(null);
    await rm(dir, { recursive: true, force: true });
  });

  async function put(ref: string, body: string | Buffer) {
    const abs = join(dir, ...ref.split("/"));
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, body);
  }

  // ── happy paths ─────────────────────────────────────────────────────────────

  it("reads a verdict body under evaluations/", async () => {
    const verdict = JSON.stringify({ focus: "proof-critique", verdict: "not craft", notes: "x" });
    await put("evaluations/proof-critique-ps_001-2026-09-14.json", verdict);
    const r = await sidecarRead({ projectPath: dir, ref: "evaluations/proof-critique-ps_001-2026-09-14.json" });
    expect(r).toEqual({
      ok: true,
      ref: "evaluations/proof-critique-ps_001-2026-09-14.json",
      totalChars: verdict.length,
      offset: 0,
      content: verdict,
      truncated: false,
    });
  });

  it("reads a text upload whose name carries a space", async () => {
    await put("uploads/Grandma's notes 1923.txt", "born in Kraków\n");
    const r = await sidecarRead({ projectPath: dir, ref: "uploads/Grandma's notes 1923.txt" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toBe("born in Kraków\n");
  });

  it("reads an upload with a 121-character name (the hosted upload-name ceiling)", async () => {
    // _UPLOAD_NAME_RE in apps/server/app/sessions.py: one leading alnum + up to 120 more.
    const name = "a" + "b".repeat(116) + ".txt";
    expect(name).toHaveLength(121);
    await put(`uploads/${name}`, "ok");
    const r = await sidecarRead({ projectPath: dir, ref: `uploads/${name}` });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toBe("ok");
  });

  it("accepts nested refs under both prefixes", async () => {
    await put("uploads/scans/page-1.txt", "one");
    await put("evaluations/2026/09/v.json", "{}");
    const a = await sidecarRead({ projectPath: dir, ref: "uploads/scans/page-1.txt" });
    const b = await sidecarRead({ projectPath: dir, ref: "evaluations/2026/09/v.json" });
    expect(a.ok && a.content).toBe("one");
    expect(b.ok && b.content).toBe("{}");
  });

  it("strips a leading BOM and does not count it", async () => {
    await put("uploads/bom.txt", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("abc", "utf-8")]));
    const r = await sidecarRead({ projectPath: dir, ref: "uploads/bom.txt" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toBe("abc");
    expect(r.totalChars).toBe(3);
  });

  // ── pagination ──────────────────────────────────────────────────────────────

  it("pages with offset/maxChars and reports truncated + nextOffset", async () => {
    await put("uploads/abc.txt", "abcdefghij"); // 10 chars
    const p1 = await sidecarRead({ projectPath: dir, ref: "uploads/abc.txt", maxChars: 4 });
    expect(p1).toEqual({
      ok: true, ref: "uploads/abc.txt", totalChars: 10, offset: 0,
      content: "abcd", truncated: true, nextOffset: 4,
    });
    const p2 = await sidecarRead({ projectPath: dir, ref: "uploads/abc.txt", offset: 4, maxChars: 4 });
    expect(p2.ok && p2.content).toBe("efgh");
    expect(p2.ok && p2.nextOffset).toBe(8);
    const p3 = await sidecarRead({ projectPath: dir, ref: "uploads/abc.txt", offset: 8, maxChars: 4 });
    expect(p3).toEqual({
      ok: true, ref: "uploads/abc.txt", totalChars: 10, offset: 8,
      content: "ij", truncated: false,
    });
    expect(p3).not.toHaveProperty("nextOffset");
  });

  it("returns an empty, un-truncated page for an offset at or past the end", async () => {
    await put("uploads/abc.txt", "abc");
    for (const offset of [3, 4, 1_000_000]) {
      const r = await sidecarRead({ projectPath: dir, ref: "uploads/abc.txt", offset });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.content).toBe("");
      expect(r.truncated).toBe(false);
      expect(r).not.toHaveProperty("nextOffset");
    }
  });

  it("never splits a surrogate pair across two pages", async () => {
    // "ab" + U+1F600 (a two-unit pair) + "c": a 3-unit page would end on the high surrogate.
    await put("uploads/emoji.txt", "ab\u{1F600}c");
    const p1 = await sidecarRead({ projectPath: dir, ref: "uploads/emoji.txt", maxChars: 3 });
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    expect(p1.content).toBe("ab");
    expect(p1.truncated).toBe(true);
    expect(p1.nextOffset).toBe(2);
    const p2 = await sidecarRead({ projectPath: dir, ref: "uploads/emoji.txt", offset: 2, maxChars: 3 });
    expect(p2.ok && p2.content).toBe("\u{1F600}c");
    expect(p2.ok && p2.truncated).toBe(false);
  });

  it("moves the boundary forward, not to an empty page, when the page is one high surrogate", async () => {
    // maxChars: 1 on a pair, and an offset landing on a pair: backing off would
    // leave content "" with nextOffset === offset, and a caller paging until
    // truncated is false would never terminate. The pair is kept whole instead.
    await put("uploads/pair.txt", "\u{1F600}b");
    const p1 = await sidecarRead({ projectPath: dir, ref: "uploads/pair.txt", maxChars: 1 });
    expect(p1).toEqual({
      ok: true, ref: "uploads/pair.txt", totalChars: 3, offset: 0,
      content: "\u{1F600}", truncated: true, nextOffset: 2,
    });
    await put("uploads/apair.txt", "a\u{1F600}b");
    const p2 = await sidecarRead({ projectPath: dir, ref: "uploads/apair.txt", offset: 1, maxChars: 1 });
    expect(p2.ok && p2.content).toBe("\u{1F600}");
    expect(p2.ok && p2.nextOffset).toBe(3);
  });

  it("every page makes progress, whatever offset and maxChars a caller passes", () => {
    const text = "a\u{1F600}\u{1F601}b\uD83D";
    for (let offset = 0; offset < text.length; offset++) {
      for (const maxChars of [1, 2, 3, 4, 40]) {
        const page = fitPage(text, offset, maxChars);
        expect(page.length, `offset ${offset} maxChars ${maxChars}`).toBeGreaterThan(0);
      }
    }
  });

  it("leaves a lone high surrogate alone — only a PAIR is kept together", async () => {
    // A stub store, because a file cannot carry a lone surrogate through UTF-8.
    setProjectStore(storeReturning("ab\uD83D"));
    const r = await sidecarRead({ projectPath: "k", ref: "uploads/x.txt" });
    expect(r).toEqual({
      ok: true, ref: "uploads/x.txt", totalChars: 3, offset: 0,
      content: "ab\uD83D", truncated: false,
    });
    setProjectStore(storeReturning("\uD83D"));
    const lone = await sidecarRead({ projectPath: "k", ref: "uploads/x.txt" });
    expect(lone.ok && lone.content).toBe("\uD83D");
    expect(lone.ok && lone.truncated).toBe(false);
  });

  it("clamps maxChars above the cap instead of rejecting it", async () => {
    const text = "x".repeat(SIDECAR_READ_MAX_CHARS + 10);
    await put("uploads/big.txt", text);
    const r = await sidecarRead({ projectPath: dir, ref: "uploads/big.txt", maxChars: 10_000_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toHaveLength(SIDECAR_READ_MAX_CHARS);
    expect(r.truncated).toBe(true);
    expect(r.nextOffset).toBe(SIDECAR_READ_MAX_CHARS);
  });

  it("rejects a stringified or negative offset loudly rather than coercing it", async () => {
    await put("uploads/abc.txt", "abc");
    await expect(sidecarRead({ projectPath: dir, ref: "uploads/abc.txt", offset: "2" as any }))
      .rejects.toThrow(/offset must be a whole number.*got "2"/);
    await expect(sidecarRead({ projectPath: dir, ref: "uploads/abc.txt", offset: -1 }))
      .rejects.toThrow(/offset must be a whole number/);
    await expect(sidecarRead({ projectPath: dir, ref: "uploads/abc.txt", maxChars: 0 }))
      .rejects.toThrow(/maxChars must be a whole number/);
  });

  // ── the serialized-envelope bound (spec §4) ─────────────────────────────────

  it("a 40,000-char all-quote file serializes under the CLI spill cap through writerToolResult", async () => {
    // Every `"` doubles under JSON.stringify: 40,000 raw would be 80,002 serialized,
    // and the CLI spills anything over 50,000. The page must shrink until the
    // serialized form fits, and report the rest as a next page.
    const quotes = '"'.repeat(40_000);
    await put("uploads/quotes.txt", quotes);
    const r = await sidecarRead({ projectPath: dir, ref: "uploads/quotes.txt" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const envelope = writerToolResult(r);
    expect(envelope.isError).toBeUndefined();
    expect(envelope.content[0].text.length).toBeLessThan(CLI_SPILL_CHARS);
    expect(JSON.stringify(r.content).length - 2).toBeLessThanOrEqual(SIDECAR_READ_MAX_CHARS);
    expect(r.truncated).toBe(true);
    expect(r.nextOffset).toBe(r.content.length);
    expect(r.content.length).toBeGreaterThan(0);
    // Paging from nextOffset reaches the rest — nothing is lost to the shrink.
    let seen = r.content.length;
    let offset = r.nextOffset!;
    for (let guard = 0; guard < 10 && offset < quotes.length; guard++) {
      const next = await sidecarRead({ projectPath: dir, ref: "uploads/quotes.txt", offset });
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      seen += next.content.length;
      if (!next.truncated) break;
      offset = next.nextOffset!;
    }
    expect(seen).toBe(quotes.length);
  });

  it("fitPage holds the bound on backslash-heavy and control-character text too", () => {
    for (const text of ["\\".repeat(45_000), "\n".repeat(45_000), "\u0001".repeat(45_000)]) {
      const page = fitPage(text, 0, SIDECAR_READ_MAX_CHARS);
      expect(JSON.stringify(page).length - 2).toBeLessThanOrEqual(SIDECAR_READ_MAX_CHARS);
      expect(page.length).toBeGreaterThan(0);
    }
    // Plain text needs no shrink at all: the page is exactly maxChars.
    expect(fitPage("x".repeat(45_000), 0, SIDECAR_READ_MAX_CHARS)).toHaveLength(SIDECAR_READ_MAX_CHARS);
  });

  // ── invalid_ref ─────────────────────────────────────────────────────────────

  const INVALID: Array<[string, RegExp]> = [
    ["/etc/passwd", /absolute/],
    ["C:/Users/x/uploads/a.txt", /absolute/],
    ["uploads/../research.json", /'\.\.' segment/],
    ["uploads/./a.txt", /'\.' segment/],
    ["uploads\\a.txt", /backslash/],
    ["uploads//a.txt", /empty path segment/],
    ["uploads/", /empty path segment/],
    ["uploads", /directory itself/],
    ["evaluations", /directory itself/],
    ["research.json", /research_query/],
    ["tree.gedcomx.json", /project_context/],
    ["results/log_001.json", /record_read/],
    ["images/x.jpg", /image_read/],
    ["notes.txt", /not under evaluations\/ or uploads\//],
    ["", /ref is required/],
  ];
  for (const [ref, pattern] of INVALID) {
    it(`rejects ref ${JSON.stringify(ref)} as invalid_ref`, async () => {
      const r = await sidecarRead({ projectPath: dir, ref });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("invalid_ref");
      expect(r.errors.join(" ")).toMatch(pattern);
    });
  }

  it("rejects a ref that names an existing directory as invalid_ref, not not_found", async () => {
    await put("uploads/scans/page-1.txt", "one");
    const r = await sidecarRead({ projectPath: dir, ref: "uploads/scans" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("invalid_ref");
    expect(r.errors[0]).toMatch(/names a directory/);
  });

  it("reports an escaping ref as invalid_ref before the store ever sees it", async () => {
    // A traversal is caught by the tool's own rule; were it to reach the store,
    // assertInsideProject would throw a plain Error and the arm would go loud.
    const r = await sidecarRead({ projectPath: dir, ref: "uploads/../../etc/passwd" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("invalid_ref");
  });

  it.skipIf(process.platform === "win32")(
    "a symlink under uploads/ that leaves the project goes loud, never returns the target",
    async () => {
      // The tool's own §3 rule sees a clean ref; the store's real-path check is
      // the line that catches this one, and it throws rather than returning bytes.
      const outside = await mkdtemp(join(tmpdir(), "sidecar-read-outside-"));
      try {
        await writeFile(join(outside, "hosts"), "## Host Database", "utf-8");
        await mkdir(join(dir, "uploads"), { recursive: true });
        await symlink(join(outside, "hosts"), join(dir, "uploads", "link-file.txt"));
        await expect(sidecarRead({ projectPath: dir, ref: "uploads/link-file.txt" }))
          .rejects.toThrow(/escapes the project/);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    },
  );

  // ── not_found / not_text / no_project ───────────────────────────────────────

  it("reports a missing file as not_found and says where a ref comes from", async () => {
    const r = await sidecarRead({ projectPath: dir, ref: "evaluations/nope.json" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not_found");
    expect(r.errors[0]).toMatch(/research_query/);
    expect(r.errors[0]).toMatch(/does not list directories/);
  });

  it("a path THROUGH a regular file (ENOTDIR) is not_found, not a raw fs error", async () => {
    await put("uploads/x.txt", "a file, not a directory");
    const r = await sidecarRead({ projectPath: dir, ref: "uploads/x.txt/more.txt" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not_found");
  });

  it.skipIf(process.platform === "win32")(
    "a segment longer than the filesystem allows (ENAMETOOLONG) is invalid_ref, not loud",
    async () => {
      // The parent must exist, or realpath fails with ENOENT on `uploads` first.
      await put("uploads/ok.txt", "ok");
      const r = await sidecarRead({ projectPath: dir, ref: "uploads/" + "a".repeat(300) });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("invalid_ref");
      expect(r.errors[0]).toMatch(/longer than the filesystem allows/);
    },
  );

  const BINARY: Array<[string, Buffer]> = [
    ["NUL bytes", Buffer.from("ab\u0000cd", "utf-8")],
    ["a JPEG header", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])],
    ["UTF-16LE text", Buffer.from("hello world", "utf16le")],
    ["a run of invalid UTF-8", Buffer.from(Array.from({ length: 200 }, (_, i) => (i % 5 === 0 ? 0xff : 0x61)))],
  ];
  for (const [label, bytes] of BINARY) {
    it(`refuses ${label} as not_text`, async () => {
      await put("uploads/blob.bin", bytes);
      const r = await sidecarRead({ projectPath: dir, ref: "uploads/blob.bin" });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("not_text");
      // The refusal now points at the tool that CAN read an uploaded image or PDF (#2048).
      expect(r.errors[0]).toMatch(/image_transcribe\(\{ file/);
    });
  }

  it("tolerates a single damaged byte in an otherwise UTF-8 file (the 1% rule)", async () => {
    const good = Buffer.from("a".repeat(2_000), "utf-8");
    await put("uploads/mostly.txt", Buffer.concat([good, Buffer.from([0xff]), good]));
    const r = await sidecarRead({ projectPath: dir, ref: "uploads/mostly.txt" });
    expect(r.ok).toBe(true);
  });

  it("a single U+FFFD never trips not_text, even in a file under 100 characters (the floor)", async () => {
    // Below 100 chars, 1% is under one, so without the floor one damaged byte
    // — or the literal U+FFFD in valid UTF-8 — would refuse the whole note.
    const note = Buffer.from("born 1852 in Kraków, see note", "utf-8"); // 29 chars
    await put("uploads/short.txt", Buffer.concat([note, Buffer.from([0xff])]));
    const damaged = await sidecarRead({ projectPath: dir, ref: "uploads/short.txt" });
    expect(damaged.ok).toBe(true);
    if (!damaged.ok) return;
    expect(damaged.content).toBe("born 1852 in Kraków, see note\uFFFD");
    await put("uploads/literal.txt", Buffer.from([0xef, 0xbf, 0xbd])); // U+FFFD itself
    const literal = await sidecarRead({ projectPath: dir, ref: "uploads/literal.txt" });
    expect(literal.ok && literal.content).toBe("\uFFFD");
    // Two in a short file is still refused: the floor is one, not a blank cheque.
    await put("uploads/two.txt", Buffer.from([0x61, 0xff, 0x62, 0xff]));
    const two = await sidecarRead({ projectPath: dir, ref: "uploads/two.txt" });
    expect(two.ok).toBe(false);
    if (two.ok) return;
    expect(two.reason).toBe("not_text");
  });

  it("answers no_project (the read sentence) in a folder holding neither project file", async () => {
    const empty = await mkdtemp(join(tmpdir(), "sidecar-read-empty-"));
    try {
      const r = await sidecarRead({ projectPath: empty, ref: "uploads/a.txt" });
      expect(r).toEqual({ ok: false, reason: "no_project", errors: [NO_PROJECT_MESSAGE_READ] });
      expect(writerToolResult(r).isError).toBeUndefined();
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("marks every other ok:false as isError through writerToolResult", async () => {
    const r = await sidecarRead({ projectPath: dir, ref: "evaluations/nope.json" });
    expect(writerToolResult(r).isError).toBe(true);
  });

  // ── unreadable is not absent ────────────────────────────────────────────────

  // chmod 0 does not deny read to uid 0, so under a root runner the read would
  // succeed and this would fail for the wrong reason.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "an unreadable file stays loud — it is NOT reported as not_found",
    async () => {
      // `store.exists` swallows EACCES as "absent"; a verdict that exists but
      // cannot be read must not make the mentor think there is no verdict.
      await put("evaluations/locked.json", "{}");
      await chmod(join(dir, "evaluations", "locked.json"), 0o000);
      try {
        await expect(sidecarRead({ projectPath: dir, ref: "evaluations/locked.json" }))
          .rejects.toThrow(/EACCES|permission denied/i);
      } finally {
        await chmod(join(dir, "evaluations", "locked.json"), 0o600);
      }
    },
  );

  // ── store seam ──────────────────────────────────────────────────────────────

  it("reads through the installed ProjectStore with a project-relative ref", async () => {
    const calls: Array<[string, string]> = [];
    setProjectStore(storeReturning("from the store", calls));
    const r = await sidecarRead({ projectPath: "opaque-key", ref: "uploads/x.txt" });
    expect(r.ok && r.content).toBe("from the store");
    expect(calls).toEqual([["opaque-key", "uploads/x.txt"]]);
  });
});
