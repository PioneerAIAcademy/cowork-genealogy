import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsProjectStore } from "../../src/store/fs-project-store.js";
import { setProjectStore } from "../../src/store/project-store.js";
import { deriveProject } from "../../src/tools/project-view.js";
import { PUBLIC_URL, realFoldersOnly, refusal, RESEARCH, startViewer, tempFolders, writeProject } from "./harness.js";

realFoldersOnly();
const { base, root } = tempFolders();

const TREE = { persons: [{ id: "I1" }] };
const STARTING_TREE = { persons: [] };
const COLLECTIONS = { places: { Ohio: [] } };

function writeWholeProject(dir: string): void {
  writeProject(dir);
  writeFileSync(join(dir, "tree.gedcomx.json"), JSON.stringify(TREE), "utf8");
  writeFileSync(join(dir, "starting-tree.gedcomx.json"), JSON.stringify(STARTING_TREE), "utf8");
  writeFileSync(join(dir, "external-collections.json"), JSON.stringify(COLLECTIONS), "utf8");
}

describe("show_project", () => {
  it("returns one line for the model, and the documents in the result's _meta only", async () => {
    writeWholeProject(root());
    const viewer = await startViewer(root());
    const args = { show: "conclusion", questionId: "q_001", page: "case" };
    const result = await viewer.call("show_project", args);
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).not.toMatch(/\n/);
    expect(result.content[0].text.endsWith("CANARY-CONTENT-K7Q2")).toBe(true);
    expect(result).not.toHaveProperty("structuredContent");
    expect(result._meta["genealogy/project"]).toEqual({
      research: RESEARCH,
      tree: TREE,
      startingTree: STARTING_TREE,
      collections: COLLECTIONS,
      derived: deriveProject({ folderName: "root", research: RESEARCH, tree: TREE, startingTree: STARTING_TREE, evaluationBodies: {} }),
      echo: args,
      canary: "CANARY-META-M4X9",
    });
  });

  it("returns structuredContent only when the probe asks for it", async () => {
    writeProject(root());
    const viewer = await startViewer(root());
    const result = await viewer.call("show_project", { show: "setup", structuredCanary: true });
    expect(result.structuredContent).toEqual({ canary: "CANARY-STRUCTURED-Z8R1" });
    const off = await viewer.call("show_project", { show: "setup", structuredCanary: false });
    expect(off).not.toHaveProperty("structuredContent");
  });

  it("gives null for each file the project does not have", async () => {
    writeProject(root());
    const viewer = await startViewer(root());
    const project = (await viewer.call("show_project", { show: "latest" }))._meta["genealogy/project"];
    expect(project.tree).toBeNull();
    expect(project.startingTree).toBeNull();
    expect(project.collections).toBeNull();
    expect(project).not.toHaveProperty("pad");
  });

  it("still shows the card when external-collections.json is malformed", async () => {
    writeProject(root());
    writeFileSync(join(root(), "external-collections.json"), "{ not json", "utf8");
    const viewer = await startViewer(root());
    const result = await viewer.call("show_project", { show: "latest" });
    expect(result.isError).toBeUndefined();
    expect(result._meta["genealogy/project"].collections).toBeNull();
  });

  it("carries pad at exactly the size asked", async () => {
    writeProject(root());
    const viewer = await startViewer(root());
    const { pad } = (await viewer.call("show_project", { show: "setup", pad: 25_000 }))._meta["genealogy/project"];
    expect(pad).toHaveLength(25_000);
  });

  it("carries the largest pad through HTTP whole", async () => {
    writeProject(root());
    const viewer = await startViewer(root());
    const { pad } = (await viewer.call("show_project", { show: "setup", pad: 8_000_000 }))._meta["genealogy/project"];
    expect(pad).toHaveLength(8_000_000);
  });

  it.each([
    ["no show", {}, /show must be one of/],
    ["a bad show", { show: "everything" }, /show must be one of/],
    ["a bad page", { show: "file", page: "index" }, /page must be one of/],
    ["a pad below zero", { show: "setup", pad: -1 }, /pad must be/],
    ["a pad over the limit", { show: "setup", pad: 8_000_001 }, /pad must be/],
    ["a pad that is not whole", { show: "setup", pad: 1.5 }, /pad must be/],
    ["a pad that is a string", { show: "setup", pad: "10" }, /pad must be/],
    ["an id that is not a string", { show: "setup", questionId: 1 }, /questionId must be a string/],
    ["a canary that is not boolean", { show: "setup", structuredCanary: "yes" }, /structuredCanary must be/],
    ["an unknown argument", { show: "setup", question_id: "q_001" }, /no argument question_id/],
  ])("refuses %s", async (_name, args, message) => {
    writeProject(root());
    const viewer = await startViewer(root());
    expect(refusal(await viewer.call("show_project", args))).toMatch(message);
  });

  it("refuses a project whose research.json is not JSON", async () => {
    writeProject(root());
    writeFileSync(join(root(), "research.json"), "{broken", "utf8");
    const viewer = await startViewer(root());
    expect(refusal(await viewer.call("show_project", { show: "setup" }))).toMatch(/research\.json is not valid JSON/);
  });
});

describe("read_project_view", () => {
  it("document: the documents in structuredContent", async () => {
    writeWholeProject(root());
    const viewer = await startViewer(root());
    const result = await viewer.call("read_project_view", { part: "document" });
    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
    expect(result.structuredContent).toEqual({
      research: RESEARCH,
      tree: TREE,
      startingTree: STARTING_TREE,
      collections: COLLECTIONS,
      derived: deriveProject({ folderName: "root", research: RESEARCH, tree: TREE, startingTree: STARTING_TREE, evaluationBodies: {} }),
    });
  });

  it("document: carries pad, and nothing else takes it", async () => {
    writeProject(root());
    const viewer = await startViewer(root());
    const result = await viewer.call("read_project_view", { part: "document", pad: 30_000 });
    expect(result.structuredContent.pad).toHaveLength(30_000);
    expect(refusal(await viewer.call("read_project_view", { part: "results", id: "log_1", pad: 1 }))).toMatch(
      /only accepted with part document/,
    );
    expect(refusal(await viewer.call("read_project_view", { part: "image", id: "images/a.jpg", pad: 1 }))).toMatch(
      /only accepted with part document/,
    );
  });

  it("results: the parsed file", async () => {
    writeProject(root());
    mkdirSync(join(root(), "results"));
    writeFileSync(join(root(), "results", "log_001.json"), JSON.stringify({ hits: [1] }), "utf8");
    const viewer = await startViewer(root());
    const result = await viewer.call("read_project_view", { part: "results", id: "log_001" });
    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
    expect(result.structuredContent).toEqual({ found: true, results: { hits: [1] } });
  });

  it("results: an absent file is an answer, not an error", async () => {
    writeProject(root());
    const viewer = await startViewer(root());
    const result = await viewer.call("read_project_view", { part: "results", id: "log_404" });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ found: false });
  });

  it.each(["../.tree-before-forget.gedcomx", ".staging/x", "log_", "log_a/b", "research", "log_1\n", ""])(
    "results: refuses the id %j",
    async (id) => {
      writeProject(root());
      const viewer = await startViewer(root());
      expect(refusal(await viewer.call("read_project_view", { part: "results", id }))).toMatch(/must be a log id/);
    },
  );

  it("results: refuses no id", async () => {
    writeProject(root());
    const viewer = await startViewer(root());
    expect(refusal(await viewer.call("read_project_view", { part: "results" }))).toMatch(/must be a log id/);
  });

  it("image: signs a matching ref whether or not the file exists", async () => {
    writeProject(root());
    const now = () => 1_000_000;
    const viewer = await startViewer(root(), { now });
    const result = await viewer.call("read_project_view", { part: "image", id: "images/absent.jpg" });
    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
    expect(Object.keys(result.structuredContent).sort()).toEqual(["expiresAt", "url"]);
    expect(result.structuredContent.url.startsWith(`${PUBLIC_URL}/img/`)).toBe(true);
    expect(result.structuredContent.expiresAt).toBe(1_000_000 + 10 * 60_000);
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
  ])("image: refuses the id %j", async (id) => {
    writeProject(root());
    const viewer = await startViewer(root());
    expect(refusal(await viewer.call("read_project_view", { part: "image", id }))).toMatch(/must be an image ref/);
  });

  it("image: signs nothing for a project outside the root", async () => {
    const outside = writeProject(join(base(), "outside"));
    const viewer = await startViewer(root());
    const args = { part: "image", id: "images/a.jpg", projectPath: outside };
    expect(refusal(await viewer.call("read_project_view", args))).toMatch(/"outside"/);
  });

  it.each([
    ["no part", {}, /part must be one of/],
    ["a bad part", { part: "recordSearch", id: "x" }, /part must be one of/],
    ["an unknown argument", { part: "document", section: "x" }, /no argument section/],
  ])("refuses %s", async (_name, args, message) => {
    writeProject(root());
    const viewer = await startViewer(root());
    expect(refusal(await viewer.call("read_project_view", args))).toMatch(message);
  });
});

describe("failures", () => {
  afterEach(() => {
    setProjectStore(null);
  });

  it("an unknown tool is a tool failure", async () => {
    const viewer = await startViewer(root());
    expect(refusal(await viewer.call("nope"))).toMatch(/Unknown tool/);
  });

  it("a folder that vanishes mid-call does not put the root's path in the message", async () => {
    writeProject(join(root(), "proj"));
    class Vanishing extends FsProjectStore {
      private calls = 0;
      override async classifyProject(projectPath: unknown) {
        this.calls += 1;
        return this.calls === 1 ? "project" : "missing_dir";
      }
    }
    setProjectStore(new Vanishing());
    const viewer = await startViewer(root());
    const text = refusal(await viewer.call("read_project_view", { part: "document", projectPath: "proj" }));
    expect(text).toMatch(/does not exist/);
    expect(text).not.toContain(base());
  });
});
