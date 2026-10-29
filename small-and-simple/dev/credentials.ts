/**
 * Credentials for the developer scripts (demos and evals), never for a
 * solution: solutions take them as arguments. Each value comes from the
 * environment, else from the files the engine's login tool writes.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function fromHomeFile(file: string, field: string): string | undefined {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".familysearch-mcp", file), "utf-8"))[field];
  } catch {
    return undefined;
  }
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Set ${name}.`);
  return value;
}

export function loadCredentials() {
  return {
    fsToken: required("FS_TOKEN", process.env.FS_TOKEN ?? fromHomeFile("tokens.json", "accessToken")),
    openRouterApiKey: required(
      "OPENROUTER_API_KEY",
      process.env.OPENROUTER_API_KEY ?? fromHomeFile("config.json", "openRouterApiKey"),
    ),
    openRouterModel: process.env.OPENROUTER_MODEL,
  };
}
