import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Which build this is. `npm run build` writes build/build-info.json after tsc
// (scripts/write-build-info.mjs); the .mcpb stage and the E2B image both carry
// build/ verbatim, so the same file answers in every artifact. The path resolves
// to build/build-info.json from the compiled build/utils/ and to the (absent)
// src/build-info.json under vitest/tsx — same ../ pattern as name-variants.ts.
//
// Never throws: a missing or malformed file yields `<base>+dev`, so a dev
// checkout that has not run the build still boots, it just says so.
const DEFAULT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../build-info.json");
const PACKAGE_JSON_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json");

export interface BuildInfo {
  /** `<base>+<YYYY-MM-DD>.<sha>[.dirty]`, or `<base>+dev` — what serverInfo.version and buildId carry. */
  version: string;
  /** The tracked package.json version the stamp was built on. */
  base: string;
  sha: string;
  date: string;
  dirty: boolean;
}

function fallback(): BuildInfo {
  let base = "0.0.0";
  try {
    const v = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")).version;
    if (typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v)) base = v;
  } catch {
    // no package.json either — keep 0.0.0 rather than fail the boot
  }
  return { version: `${base}+dev`, base, sha: "dev", date: "dev", dirty: false };
}

let cached: BuildInfo | null = null;

/** The stamp for this build; `path` overrides the default location (tests) and bypasses the cache. */
export function readBuildInfo(path?: string): BuildInfo {
  if (path === undefined && cached) return cached;
  let info: BuildInfo;
  try {
    const raw = JSON.parse(readFileSync(path ?? DEFAULT_PATH, "utf8"));
    if (
      raw &&
      typeof raw.version === "string" &&
      raw.version.includes("+") &&
      typeof raw.base === "string" &&
      typeof raw.sha === "string" &&
      typeof raw.date === "string" &&
      typeof raw.dirty === "boolean"
    ) {
      info = { version: raw.version, base: raw.base, sha: raw.sha, date: raw.date, dirty: raw.dirty };
    } else {
      info = fallback();
    }
  } catch {
    info = fallback();
  }
  if (path === undefined) cached = info;
  return info;
}
