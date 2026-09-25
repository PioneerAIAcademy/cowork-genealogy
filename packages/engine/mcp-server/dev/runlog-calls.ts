/**
 * Shared walker for the dev/measure-*.ts replays: every tracked run log, every
 * MCP tool call in it, a call's response as an object, and a research_log_append
 * call's ops. Offline; reads committed files only. Not shipped in any artifact.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** Tracked run-log files under `eval/runlogs/<subdir>`, calibration `.ann.json` excluded. */
export function runLogFiles(subdir = ""): string[] {
  return execFileSync("git", ["ls-files", join("eval/runlogs", subdir)], { cwd: repoRoot, encoding: "utf-8" })
    .split("\n")
    .filter((f) => f.endsWith(".json") && !f.endsWith(".ann.json"));
}

/** A run-log file parsed, or undefined when it is not JSON. */
export function readRunLog(file: string): unknown {
  try {
    return JSON.parse(readFileSync(join(repoRoot, file), "utf-8"));
  } catch {
    return undefined;
  }
}

/** Every `{ tool, args }` node under `node`, in document order. */
export function* toolCalls(node: unknown): Generator<any> {
  if (!node || typeof node !== "object") return;
  const o = node as any;
  if (typeof o.tool === "string" && o.args && typeof o.args === "object") {
    yield o;
    return;
  }
  for (const v of Array.isArray(o) ? o : Object.values(o)) yield* toolCalls(v);
}

/** The bare tool name, whatever server prefix the run exposed it under. */
export const bareName = (call: any): string => String(call.tool).split("__").pop()!;

/** A research_log_append call's ops: its `ops` array (parsed if stringified), else the call itself. */
export const opsOf = (args: any): any[] => {
  let ops = args.ops;
  if (typeof ops === "string") {
    try {
      ops = JSON.parse(ops);
    } catch {
      ops = undefined;
    }
  }
  return Array.isArray(ops) ? ops : [args];
};

/** A tool call's response as an object: the structured one, or the parsed e2e summary. */
export function responseOf(call: any): any {
  if (call.response && typeof call.response === "object") return call.response;
  if (typeof call.response_summary !== "string") return undefined;
  try {
    let r = JSON.parse(call.response_summary);
    if (Array.isArray(r)) r = r[0];
    if (r && typeof r.text === "string") r = JSON.parse(r.text);
    return r;
  } catch {
    return undefined; // truncated or not JSON
  }
}
