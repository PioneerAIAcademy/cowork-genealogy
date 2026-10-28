import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// A 401 from FamilySearch means the session was rejected. On the hosted app the
// `login` tool is a dead end, so the answer must come from
// `rejectedTokenMessage(principal, ...)` (src/auth/config.ts), which sends a
// hosted researcher to the Reconnect button and keeps each tool's own desktop
// text. A 401 branch that names the login tool without it is the defect this
// test exists to stop coming back: seventeen sites in fourteen files had it.

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** The line numbers of each 401 branch whose next eight lines name the login
 *  tool without going through `rejectedTokenMessage`. */
export function loginOn401(source: string): number[] {
  const lines = source.split("\n");
  const found: number[] = [];
  lines.forEach((line, i) => {
    if (!/[=!]==?\s*401\b/.test(line)) return;
    const branch = lines.slice(i, i + 8).join("\n");
    if (/login/i.test(branch) && !branch.includes("rejectedTokenMessage")) found.push(i + 1);
  });
  return found;
}

describe("a 401 answers through rejectedTokenMessage", () => {
  it("flags a 401 branch that names the login tool on its own", () => {
    const bare = `  if (response.status === 401) {\n    throw new Error(\n      "FamilySearch session not accepted; call the login tool to re-authenticate."\n    );\n  }`;
    expect(loginOn401(bare)).toEqual([1]);
    const combined = `  if (res.status === 401 || res.status === 403) {\n    throw new Error(\`rejected: \${res.status}. Call the login tool.\`);\n  }`;
    expect(loginOn401(combined)).toEqual([1]);
  });

  it("passes a 401 branch that goes through the helper, whatever its desktop text says", () => {
    const helper = `  if (response.status === 401) {\n    throw new Error(await rejectedTokenMessage(principal, "call the login tool"));\n  }`;
    expect(loginOn401(helper)).toEqual([]);
    const reflowed = `    if (res.status === 401) {\n      throw new Error(\n        (await rejectedTokenMessage(\n          principal,\n          "FamilySearch session not accepted; call the login tool to re-authenticate.",\n        )) + detail,\n      );`;
    expect(loginOn401(reflowed)).toEqual([]);
    expect(loginOn401(`  if (res.status === 401 || res.status === 403) {\n    res = await fsFetch(principal, url);\n  }`)).toEqual([]);
  });

  it("no source file answers a 401 with the login tool on its own", () => {
    const offenders = collectTsFiles(srcRoot).flatMap((file) =>
      loginOn401(readFileSync(file, "utf8")).map((n) => `${relative(srcRoot, file)}:${n}`),
    );
    expect(offenders, `a 401 names the login tool without rejectedTokenMessage:\n${offenders.join("\n")}`).toEqual([]);
  });
});
