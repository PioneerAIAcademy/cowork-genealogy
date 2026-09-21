import { join } from "node:path";
import { FsProjectStore } from "../../src/store/fs-project-store.js";
import type {
  JsonWrite,
  ProjectDirState,
  ProjectEntry,
  ProjectPathClass,
  ProjectStore,
  WriteJsonBothOptions,
} from "../../src/store/project-store.js";

/** The one `projectPath` a scoped store answers for, as the Pg store's anchor. */
export const SCOPED_ANCHOR = "/project";

/**
 * A `ProjectStore` scoped to one project id over the file backend — the shape
 * `PgS3ProjectStore` has (one project per instance, the anchor `projectPath`
 * as a check rather than a key) without the compose stack. The HTTP server
 * test's `bindStore` builds one per request, so two requests with different
 * ids land in two directories under `root` and a request that names no id
 * reaches nothing.
 *
 * The anchor `/project` maps to `join(root, projectId)`; any other
 * `projectPath` maps to a path under `root/__missing__` that nothing creates,
 * so `classifyProject` answers `missing_dir` exactly as the Pg store does for
 * a wrong path. Writes off the anchor throw the Pg store's message instead of
 * creating that path. `FsProjectStore.writeJson*` creates missing parents, so
 * the project directory needs no pre-creation.
 */
export class ScopedFsStore implements ProjectStore {
  private readonly inner = new FsProjectStore();

  constructor(
    private readonly root: string,
    readonly projectId: string,
  ) {}

  private isAnchor(projectPath: unknown): boolean {
    return projectPath === SCOPED_ANCHOR;
  }

  private map(projectPath: string): string {
    if (this.isAnchor(projectPath)) return join(this.root, this.projectId);
    return join(this.root, "__missing__", projectPath.replace(/[^A-Za-z0-9._-]/g, "_") || "_");
  }

  private assertAnchor(projectPath: unknown): void {
    if (!this.isAnchor(projectPath)) {
      throw new Error(`projectPath '${String(projectPath)}' is not this store's project (${SCOPED_ANCHOR})`);
    }
  }

  async withTransaction<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
    this.assertAnchor(projectPath);
    return this.inner.withTransaction(this.map(projectPath), fn);
  }

  classifyProject(projectPath: unknown): Promise<ProjectPathClass> {
    if (typeof projectPath !== "string") return this.inner.classifyProject(projectPath);
    return this.inner.classifyProject(this.map(projectPath));
  }

  projectDirState(projectPath: string): Promise<ProjectDirState> {
    return this.inner.projectDirState(this.map(projectPath));
  }

  findNestingAncestor(projectPath: string): Promise<string | null> {
    return this.inner.findNestingAncestor(this.map(projectPath));
  }

  exists(projectPath: string, ref: string): Promise<boolean> {
    return this.inner.exists(this.map(projectPath), ref);
  }

  readText(projectPath: string, ref: string): Promise<string> {
    return this.inner.readText(this.map(projectPath), ref);
  }

  readBytes(projectPath: string, ref: string): Promise<Uint8Array> {
    return this.inner.readBytes(this.map(projectPath), ref);
  }

  list(projectPath: string, dirRef: string): Promise<ProjectEntry[]> {
    return this.inner.list(this.map(projectPath), dirRef);
  }

  async writeJson(projectPath: string, ref: string, data: unknown): Promise<void> {
    this.assertAnchor(projectPath);
    return this.inner.writeJson(this.map(projectPath), ref, data);
  }

  async writeJsonBoth(projectPath: string, writes: JsonWrite[], options?: WriteJsonBothOptions): Promise<void> {
    this.assertAnchor(projectPath);
    return this.inner.writeJsonBoth(this.map(projectPath), writes, options);
  }

  async writeBytes(projectPath: string, ref: string, bytes: Uint8Array): Promise<void> {
    this.assertAnchor(projectPath);
    return this.inner.writeBytes(this.map(projectPath), ref, bytes);
  }

  async appendText(projectPath: string, ref: string, text: string): Promise<void> {
    this.assertAnchor(projectPath);
    return this.inner.appendText(this.map(projectPath), ref, text);
  }

  async remove(projectPath: string, ref: string): Promise<void> {
    this.assertAnchor(projectPath);
    return this.inner.remove(this.map(projectPath), ref);
  }
}
