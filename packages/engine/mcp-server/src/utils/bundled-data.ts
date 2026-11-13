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
const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(HERE, "../../config");

/** The absolute path of the bundled file `name` under config/. */
export function bundledDataPath(name: string): string {
  return resolve(CONFIG_DIR, name);
}

/** The built viewer page, beside build/ in the tools image and nowhere in the `.mcpb`. */
export function viewerPagePath(): string {
  return resolve(HERE, "../../viewer/page/viewer.html");
}

/** A bundled file's text. Throws when it is missing or unreadable. */
export function readBundledText(path: string): string {
  return readFileSync(path, "utf-8");
}
