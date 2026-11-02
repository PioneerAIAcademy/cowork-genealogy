// Raw writes a test makes to a protected project file (research.json,
// tree.gedcomx.json, …) to plant a state the tools would never write. The store
// leaves those files read-only (issue #1499), so a raw write after any tool call
// needs the mode lifted first — exactly what a shell writer would have to do.
import { chmodSync, writeFileSync } from "node:fs";
import { chmod, writeFile } from "node:fs/promises";

function ignoreMissing(error: unknown): void {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

export async function writeProjectFile(path: string, data: string, encoding: BufferEncoding = "utf-8"): Promise<void> {
  await chmod(path, 0o644).catch(ignoreMissing);
  await writeFile(path, data, encoding);
}

export function writeProjectFileSync(path: string, data: string, encoding: BufferEncoding = "utf-8"): void {
  try {
    chmodSync(path, 0o644);
  } catch (error) {
    ignoreMissing(error);
  }
  writeFileSync(path, data, encoding);
}
