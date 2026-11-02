import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The engine's bundled data: the tables under mcp-server/config/, which ship
// beside build/ in the .mcpb, the tools image and the Beanstalk tools bundle.
// The path resolves to config/ from src/utils/ under tsx and vitest and from
// build/utils/ once compiled — same ../../config pattern as
// BUNDLED_CLIENT_CONFIG_PATH in auth/config.ts. This is the bundled-data reader
// tests/packaging/no-fs-outside-store.test.ts exempts: a table is read through
// it, never with an fs import of its own.
const CONFIG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../config");

/** The absolute path of the bundled file `name` under config/. */
export function bundledDataPath(name: string): string {
  return resolve(CONFIG_DIR, name);
}

/** A bundled file's text. Throws when it is missing or unreadable. */
export function readBundledText(path: string): string {
  return readFileSync(path, "utf-8");
}
