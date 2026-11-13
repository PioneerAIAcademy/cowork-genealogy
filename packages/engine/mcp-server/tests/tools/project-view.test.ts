import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  callProjectView,
  connectorProjectView,
  connectorProjectViewSchemas,
  deriveProject,
  MAX_META_BYTES,
  PAGE_URI,
  pageResourceRead,
  pageUri,
  pointAtPage,
  requirePageUri,
  PROJECT_META_KEY,
  READ_PROJECT_VIEW,
  SHOW_PROJECT,
} from "../../src/tools/project-view.js";
import { IMAGE_TOKEN_TTL_MS, processImageTokens } from "../../src/utils/image-tokens.js";

// The moved core of the viewer's two tools, through the context the connector door
// builds. It reads through `getProjectStore()`, so `make engine-test-pg` runs it on
// PgS3ProjectStore too.

const FOLDER = "proj_0123456789abcdef";
const RESEARCH = { project: { title: "Stub project" } };
const TREE = { persons: [{ id: "I1" }] };
const STARTING_TREE = { persons: [] };
const COLLECTIONS = { places: { Ohio: [] } };

const context = connectorProjectView({ webPublicUrl: " https://beta.example/ " });

let base: string;
let project: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "project-view-test-"));
  project = join(base, FOLDER);
  await mkdir(project);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** `derived` for documents with no questions, log or evaluations; its content is
 *  tested in derived.test.ts. */
const bareDerived = (folderName: string, startingTree: unknown = null, tree: unknown = null) =>
  deriveProject({ folderName, research: RESEARCH, tree, startingTree, evaluationBodies: {} });
const wholeDerived = (folderName: string) => bareDerived(folderName, STARTING_TREE, TREE);

const writeDocument = (name: string, doc: unknown) => writeFile(join(project, name), JSON.stringify(doc), "utf8");

async function writeWholeProject(): Promise<void> {
  await writeDocument("research.json", RESEARCH);
  await writeDocument("tree.gedcomx.json", TREE);
  await writeDocument("starting-tree.gedcomx.json", STARTING_TREE);
  await writeDocument("external-collections.json", COLLECTIONS);
}

const metaOf = (result: Awaited<ReturnType<typeof callProjectView>>) => result._meta?.[PROJECT_META_KEY] as any;

describe("show_project", () => {
  it("returns one line for the model, and the documents in the result's _meta only", async () => {
    await writeWholeProject();
    const args = { show: "conclusion", questionId: "q_001", page: "case", projectPath: project };
    const result = await callProjectView(context, SHOW_PROJECT, args);
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "The researcher sees the conclusion card; do not restate it." }]);
    expect(result).not.toHaveProperty("structuredContent");
    expect(metaOf(result)).toEqual({
      research: RESEARCH,
      tree: TREE,
      startingTree: STARTING_TREE,
      collections: COLLECTIONS,
      derived: wholeDerived(FOLDER),
      echo: args,
    });
  });

  it("gives null for each file the project does not have", async () => {
    await writeDocument("research.json", RESEARCH);
    const meta = metaOf(await callProjectView(context, SHOW_PROJECT, { show: "latest", projectPath: project }));
    expect(meta.tree).toBeNull();
    expect(meta.startingTree).toBeNull();
    expect(meta.collections).toBeNull();
  });

  describe("the cut at MAX_META_BYTES", () => {
    const args = () => ({ show: "latest", projectPath: project });

    /** The note that takes the whole `_meta` to exactly `bytes`, mostly in two-byte
     *  characters, so a limit counted in characters lands somewhere else. */
    function noteOfMetaSize(bytes: number): string {
      const meta = {
        research: { note: "" },
        tree: null,
        startingTree: null,
        collections: null,
        derived: bareDerived(FOLDER),
        echo: args(),
      };
      const room = bytes - Buffer.byteLength(JSON.stringify(meta), "utf8");
      return "é".repeat(Math.floor(room / 2)) + "x".repeat(room % 2);
    }

    it("keeps the documents at exactly the limit", async () => {
      const note = noteOfMetaSize(MAX_META_BYTES);
      await writeDocument("research.json", { note });
      const meta = metaOf(await callProjectView(context, SHOW_PROJECT, args()));
      expect(meta.research).toEqual({ note });
      expect(Buffer.byteLength(JSON.stringify(meta), "utf8")).toBe(MAX_META_BYTES);
    });

    it("carries only derived and echo one byte past it", async () => {
      await writeDocument("research.json", { note: noteOfMetaSize(MAX_META_BYTES + 1) });
      const result = await callProjectView(context, SHOW_PROJECT, args());
      expect(metaOf(result)).toEqual({ derived: bareDerived(FOLDER), echo: args() });
      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
    });

    it("counts bytes, not characters", async () => {
      const note = "é".repeat(MAX_META_BYTES - 1_000);
      await writeDocument("research.json", { note });
      const meta = metaOf(await callProjectView(context, SHOW_PROJECT, args()));
      expect(JSON.stringify({ note }).length).toBeLessThan(MAX_META_BYTES);
      expect(meta).not.toHaveProperty("research");
    });

    it("keeps projectPath in echo, the id a card with no tool input has left", async () => {
      await writeDocument("research.json", { note: "x".repeat(MAX_META_BYTES) });
      const meta = metaOf(await callProjectView(context, SHOW_PROJECT, args()));
      expect(meta.echo.projectPath).toBe(project);
    });
  });

  it.each([
    ["no show", {}, /show must be one of/],
    ["a bad show", { show: "everything" }, /show must be one of/],
    ["a bad page", { show: "file", page: "index" }, /page must be one of/],
    ["an id that is not a string", { show: "setup", questionId: 1 }, /questionId must be a string/],
    ["an unknown argument", { show: "setup", question_id: "q_001" }, /no argument question_id/],
  ])("refuses %s", async (_name, args, message) => {
    await writeDocument("research.json", RESEARCH);
    await expect(callProjectView(context, SHOW_PROJECT, { ...args, projectPath: project })).rejects.toThrow(message);
  });
});

describe("read_project_view", () => {
  it("document: the documents in structuredContent", async () => {
    await writeWholeProject();
    const result = await callProjectView(context, READ_PROJECT_VIEW, { part: "document", projectPath: project });
    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
    expect(result.structuredContent).toEqual({
      research: RESEARCH,
      tree: TREE,
      startingTree: STARTING_TREE,
      collections: COLLECTIONS,
      derived: wholeDerived(FOLDER),
    });
  });

  it("results: the parsed file, and an absent one is an answer", async () => {
    await writeDocument("research.json", RESEARCH);
    await mkdir(join(project, "results"));
    await writeFile(join(project, "results", "log_001.json"), JSON.stringify({ hits: [1] }), "utf8");
    const args = { part: "results", projectPath: project };
    const found = await callProjectView(context, READ_PROJECT_VIEW, { ...args, id: "log_001" });
    expect(found.structuredContent).toEqual({ found: true, results: { hits: [1] } });
    const absent = await callProjectView(context, READ_PROJECT_VIEW, { ...args, id: "log_404" });
    expect(absent.isError).toBeUndefined();
    expect(absent.structuredContent).toEqual({ found: false });
  });

  describe("recordSearch: the record search whose kept results hold a record", () => {
    const rowsOf = (...ids: string[]) => ({ tool: "record_search", payload: { results: ids.map((recordId) => ({ recordId })) } });
    const seed = async () => {
      await writeDocument("research.json", {
        ...RESEARCH,
        log: [
          { id: "log_001", tool: "fulltext_search", results_ref: "results/log_001.json" },
          { id: "log_002", tool: "record_search", results_ref: "results/log_002.json" },
          { id: "log_003", tool: "record_search", results_ref: "results/log_003.json" },
          { id: "log_004", tool: "record_search", results_ref: "results/log_004.json" },
        ],
      });
      await mkdir(join(project, "results"));
      await writeFile(join(project, "results", "log_001.json"), JSON.stringify(rowsOf("ark:/61903/1:1:AAAA-BBB")), "utf8");
      await writeFile(join(project, "results", "log_002.json"), "{ not json", "utf8");
      await writeFile(join(project, "results", "log_003.json"), JSON.stringify(rowsOf("ark:/61903/1:1:QPRC-WPBZ")), "utf8");
      await writeFile(join(project, "results", "log_004.json"), JSON.stringify(rowsOf("ark:/61903/1:1:QPRC-WPBZ")), "utf8");
    };
    const find = (id: string) => callProjectView(context, READ_PROJECT_VIEW, { part: "recordSearch", id, projectPath: project });

    it.each(["ark:/61903/1:1:QPRC-WPBZ", "QPRC-WPBZ", "https://www.familysearch.org/ark:/61903/1:1:QPRC-WPBZ?lang=en"])(
      "finds the first record search holding %s, skipping a file it cannot read",
      async (id) => {
        await seed();
        expect((await find(id)).structuredContent).toEqual({ found: true, logId: "log_003" });
      },
    );

    it("a record no record search holds is an answer, not an error; a full-text hit does not count", async () => {
      await seed();
      for (const id of ["ark:/61903/1:1:ZZZZ-ZZZ", "AAAA-BBB"]) {
        const result = await find(id);
        expect(result.isError).toBeUndefined();
        expect(result.structuredContent).toEqual({ found: false });
      }
    });

    it.each(["", "log_001", "../research.json", "lowercase-id"])("refuses the id %j", async (id) => {
      await seed();
      await expect(find(id)).rejects.toThrow("With part recordSearch, id must be a record id");
    });
  });

  it.each(["../.tree-before-forget.gedcomx", ".staging/x", "log_", "log_a/b", "research", "log_1\n", ""])(
    "results: refuses the id %j",
    async (id) => {
      await writeDocument("research.json", RESEARCH);
      await expect(
        callProjectView(context, READ_PROJECT_VIEW, { part: "results", id, projectPath: project }),
      ).rejects.toThrow(/must be a log id/);
    },
  );

  describe("image", () => {
    /** The connector's signing, on a path the door would admit. */
    const signing = { ...context, resolveProject: async () => `/${FOLDER}` };

    it("signs a link at the public origin, with the token in the query", async () => {
      vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      try {
        const result = await callProjectView(signing, READ_PROJECT_VIEW, { part: "image", id: "images/page.jpg" });
        const { url, expiresAt } = result.structuredContent as { url: string; expiresAt: number };
        expect(url.startsWith("https://beta.example/img?t=")).toBe(true);
        expect(expiresAt).toBe(1_000_000 + IMAGE_TOKEN_TTL_MS);
        const token = new URL(url).searchParams.get("t");
        expect(processImageTokens.verify(token!)).toEqual({ project: FOLDER, ref: "images/page.jpg", expiresAt });
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("is refused where no public origin is set", async () => {
      const noRoute = connectorProjectView({});
      expect(noRoute.signImage).toBeUndefined();
      await writeDocument("research.json", RESEARCH);
      await expect(
        callProjectView(noRoute, READ_PROJECT_VIEW, { part: "image", id: "images/page.jpg", projectPath: project }),
      ).rejects.toThrow(/no route to page images/);
    });

    it.each([
      "../research.json",
      "research.json",
      "images/x.png",
      "images/../research.jpg",
      "images/a/b.jpg",
      "/images/x.jpg",
      "images/x.jpg\n",
      "images/.jpg",
      "",
    ])("signs nothing for the id %j", async (id) => {
      const signImage = vi.fn(signing.signImage!);
      await expect(
        callProjectView({ ...signing, signImage }, READ_PROJECT_VIEW, { part: "image", id }),
      ).rejects.toThrow(/must be an image ref/);
      expect(signImage).not.toHaveBeenCalled();
    });

    it("signs nothing for a project the context refuses", async () => {
      const signImage = vi.fn(signing.signImage!);
      await expect(
        callProjectView({ ...context, signImage }, READ_PROJECT_VIEW, { part: "image", id: "images/a.jpg" }),
      ).rejects.toThrow(/project_list/);
      expect(signImage).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["no part", {}, /part must be one of/],
    ["a bad part", { part: "people", id: "x" }, /part must be one of/],
    ["an unknown argument", { part: "document", section: "x" }, /no argument section/],
  ])("refuses %s", async (_name, args, message) => {
    await writeDocument("research.json", RESEARCH);
    await expect(callProjectView(context, READ_PROJECT_VIEW, { ...args, projectPath: project })).rejects.toThrow(message);
  });
});

describe.each([
  [SHOW_PROJECT, { show: "setup" }],
  [READ_PROJECT_VIEW, { part: "document" }],
])("%s on the connector", (name, args) => {
  it("names project_list when the call names no project", async () => {
    await expect(callProjectView(context, name, args)).rejects.toThrow(/named no project.*project_list/);
  });

  it("names project_list for a fresh id", async () => {
    await expect(callProjectView(context, name, { ...args, projectPath: project })).rejects.toThrow(/project_list/);
  });

  it("names project_list for a path with no folder behind it", async () => {
    const projectPath = join(base, "never-made");
    await expect(callProjectView(context, name, { ...args, projectPath })).rejects.toThrow(/project_list/);
  });
});

describe("the probes stay on the thin server", () => {
  it("neither tool's schema offers pad or structuredCanary, and both state the connector's rule", () => {
    expect(connectorProjectViewSchemas.map((tool) => tool.name)).toEqual([SHOW_PROJECT, READ_PROJECT_VIEW]);
    for (const tool of connectorProjectViewSchemas) {
      const properties = Object.keys(tool.inputSchema.properties);
      expect(properties).not.toContain("pad");
      expect(properties).not.toContain("structuredCanary");
      expect(tool.description).toContain("/proj_<16 hex>");
      expect(tool.description).toContain("project_list");
      expect(tool.description).not.toContain("root");
    }
  });

  it.each([
    [SHOW_PROJECT, { show: "setup", pad: 10 }, /no argument pad/],
    [SHOW_PROJECT, { show: "setup", structuredCanary: true }, /no argument structuredCanary/],
    [READ_PROJECT_VIEW, { part: "document", pad: 10 }, /no argument pad/],
  ])("%s refuses %j", async (name, args, message) => {
    await writeDocument("research.json", RESEARCH);
    await expect(callProjectView(context, name, { ...args, projectPath: project })).rejects.toThrow(message);
  });

  it("no result carries a canary", async () => {
    await writeWholeProject();
    const shown = await callProjectView(context, SHOW_PROJECT, { show: "setup", projectPath: project });
    const read = await callProjectView(context, READ_PROJECT_VIEW, { part: "document", projectPath: project });
    expect(JSON.stringify([shown, read])).not.toMatch(/canary/i);
    expect(metaOf(shown)).not.toHaveProperty("pad");
    expect(read.structuredContent).not.toHaveProperty("pad");
  });
});

describe("the page's URI carries the page", () => {
  it("is the plain URI with no page, and a hash of the page otherwise, changing with it", () => {
    expect(pageUri(null)).toBe(PAGE_URI);
    expect(pageUri("<p>one</p>")).toMatch(/^ui:\/\/genealogy\/viewer-[0-9a-f]{12}\.html$/);
    expect(pageUri("<p>one</p>")).toBe(pageUri("<p>one</p>"));
    expect(pageUri("<p>two</p>")).not.toBe(pageUri("<p>one</p>"));
  });

  it("points show_project at it and leaves read_project_view alone", () => {
    const uri = pageUri("<p>one</p>");
    const [show, read] = pointAtPage(connectorProjectViewSchemas, uri);
    expect(show._meta).toEqual({ ui: { resourceUri: uri }, "ui/resourceUri": uri });
    expect(read).toBe(connectorProjectViewSchemas[1]);
  });

  it("reads any version, so a card that cached an older one gets today's page, and nothing else", () => {
    expect(() => requirePageUri(PAGE_URI)).not.toThrow();
    expect(() => requirePageUri(pageUri("<p>old</p>"))).not.toThrow();
    for (const uri of ["ui://genealogy/viewer-XYZ.html", "ui://genealogy/other.html", "ui://genealogy/viewer-0123456789ab.htm"]) {
      expect(() => requirePageUri(uri)).toThrow("Unknown resource.");
    }
    expect(pageResourceRead(PAGE_URI, "<p>now</p>").contents[0]).toMatchObject({ uri: PAGE_URI, text: "<p>now</p>" });
  });
});
