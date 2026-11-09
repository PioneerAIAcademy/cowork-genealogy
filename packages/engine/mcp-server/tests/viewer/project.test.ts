import { mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_PROJECT_MESSAGE_READ } from "../../src/utils/project-io.js";
import { realFoldersOnly, refusal, RESEARCH, startViewer, tempFolders, writeProject } from "./harness.js";

realFoldersOnly();
const { base, root } = tempFolders();

const document = (projectPath?: string) => ({
  part: "document",
  ...(projectPath === undefined ? {} : { projectPath }),
});

async function refused(args: Record<string, unknown>): Promise<string> {
  const viewer = await startViewer(root());
  const text = refusal(await viewer.call("read_project_view", args));
  expect(text).not.toContain(base());
  return text;
}

describe("refused", () => {
  it("a project outside --root", async () => {
    const outside = writeProject(join(base(), "outside", "proj"));
    expect(await refused(document(outside))).toMatch(/"proj"/);
  });

  it("a sibling whose name starts with the root's", async () => {
    const sibling = writeProject(`${root()}-x/proj`);
    expect(await refused(document(sibling))).toMatch(/"proj"/);
  });

  it("a symlinked project folder pointing out of --root, by name and by path", async () => {
    const outside = writeProject(join(base(), "outside", "proj"));
    symlinkSync(outside, join(root(), "link"));
    expect(await refused(document("link"))).toMatch(/"link"/);
    expect(await refused(document(join(root(), "link")))).toMatch(/"link"/);
  });

  it("the parent of --root", async () => {
    writeProject(base());
    await refused(document(base()));
  });

  it("gives one answer whether or not the folder outside exists", async () => {
    writeProject(join(base(), "outside", "proj"));
    const present = await refused(document(join(base(), "outside", "proj")));
    const absent = await refused(document(join(base(), "elsewhere", "proj")));
    expect(present).toBe(absent);
  });

  it.each(["..", ".", "", "a/b", "./proj", "../proj", "proj/", "a\\b", "../../etc"])(
    "%j, which is not one path segment",
    async (projectPath) => {
      writeProject(join(root(), "proj"));
      expect(await refused(document(projectPath))).toMatch(/absolute path or one folder name/);
    },
  );

  it("a projectPath that is not a string", async () => {
    expect(await refused({ part: "document", projectPath: 7 })).toMatch(/must be a string/);
  });

  it("a name with no such folder", async () => {
    expect(await refused(document("missing"))).toMatch(/"missing"/);
  });

  it("a file where a folder should be", async () => {
    writeFileSync(join(root(), "notes.txt"), "x", "utf8");
    expect(await refused(document("notes.txt"))).toMatch(/"notes.txt"/);
  });

  it("a folder that holds no project, in the existing wording", async () => {
    mkdirSync(join(root(), "empty"));
    expect(await refused(document("empty"))).toBe(NO_PROJECT_MESSAGE_READ);
    expect(await refused(document(join(root(), "empty")))).toBe(NO_PROJECT_MESSAGE_READ);
  });

  it("a folder that holds only a tree, as a broken project rather than as no project", async () => {
    mkdirSync(join(root(), "half"));
    writeFileSync(join(root(), "half", "tree.gedcomx.json"), "{}", "utf8");
    expect(await refused(document("half"))).toMatch(/research\.json not found/);
  });

  it("both tools by the same rule", async () => {
    const outside = writeProject(join(base(), "outside", "proj"));
    expect(await refused({ part: "document", projectPath: outside })).toBe(
      refusal(await (await startViewer(root())).call("show_project", { show: "setup", projectPath: outside })),
    );
  });
});

describe("accepted", () => {
  const folderName = async (projectPath?: string): Promise<string> => {
    const viewer = await startViewer(root());
    const result = await viewer.call("read_project_view", document(projectPath));
    expect(result.isError).toBeUndefined();
    return result.structuredContent.derived.folderName;
  };

  it("a bare folder name", async () => {
    writeProject(join(root(), "proj"));
    expect(await folderName("proj")).toBe("proj");
  });

  it("an absolute path inside --root", async () => {
    writeProject(join(root(), "proj"));
    expect(await folderName(join(root(), "proj"))).toBe("proj");
  });

  it("a project reached through a symlink to the root", async () => {
    writeProject(join(root(), "proj"));
    symlinkSync(root(), join(base(), "alias"));
    expect(await folderName(join(base(), "alias", "proj"))).toBe("proj");
  });

  it("a symlink inside --root to another folder inside it", async () => {
    writeProject(join(root(), "proj"));
    symlinkSync(join(root(), "proj"), join(root(), "alias"));
    expect(await folderName("alias")).toBe("proj");
  });

  it("--root itself, by its absolute path", async () => {
    writeProject(root());
    expect(await folderName(root())).toBe("root");
  });
});

describe("an omitted projectPath", () => {
  it("resolves to --root when it holds research.json", async () => {
    writeProject(root());
    const viewer = await startViewer(root());
    const { structuredContent } = await viewer.call("read_project_view", document());
    expect(structuredContent.research).toEqual(RESEARCH);
    expect(structuredContent.derived.folderName).toBe("root");
  });

  it("is refused with the project folders otherwise, and only those", async () => {
    writeProject(join(root(), "alpha"));
    writeProject(join(root(), "beta"));
    mkdirSync(join(root(), "not-a-project"));
    writeFileSync(join(root(), "loose.txt"), "x", "utf8");
    symlinkSync(writeProject(join(base(), "outside", "gone")), join(root(), "escape"));
    const text = await refused(document());
    expect(text).toMatch(/alpha, beta/);
    expect(text).not.toMatch(/not-a-project|loose|escape/);
  });

  it("is refused plainly when there are none", async () => {
    expect(await refused(document())).toMatch(/holds no project folders/);
  });

  it("is refused by both tools once --root has become a symlink out of itself", async () => {
    writeProject(root());
    const outside = writeProject(join(base(), "outside"), { project: { title: "Outside project" } });
    const viewer = await startViewer(root());
    const calls = () => [viewer.call("read_project_view", document()), viewer.call("show_project", { show: "setup" })];
    for (const result of await Promise.all(calls())) expect(result.isError).toBeUndefined();
    renameSync(root(), join(base(), "moved"));
    symlinkSync(outside, root());
    for (const result of await Promise.all(calls())) {
      expect(refusal(result)).toBe('No project folder "root" can be reached from this viewer.');
    }
  });

  it("does not follow a folder removed since the list", async () => {
    const gone = writeProject(join(root(), "gone"));
    rmSync(gone, { recursive: true });
    expect(await refused(document("gone"))).toMatch(/"gone"/);
  });
});
