import { describe, it, expect } from "vitest";
import { srcFiles, srcSource, withoutComments } from "./src-files.js";

// Every FamilySearch credential read takes a Principal (src/auth/principal.ts)
// and goes through getValidToken(principal). A module that imports the token
// file layer directly bypasses that: at n=1 it works, and with two patrons in
// one process it answers as whichever user last wrote ~/.familysearch-mcp —
// the cross-patron impersonation the principal exists to prevent. This bans
// the import outside src/auth/ and the two desktop session tools that own a
// token-file operation (each of which answers a bearer principal before it
// touches the file). What it proves is that the import stays put; whether an
// exempt tool keeps its bearer guard is tests/auth/principal.test.ts's job.

const CREDENTIAL_EXEMPT = new Set(["tools/auth-status.ts", "tools/logout.ts"]);

const TOKEN_FILE_IMPORT = /\bfrom\s*["'][^"']*tokenManager\.js["']/;

function readsTokenFile(source: string): boolean {
  return TOKEN_FILE_IMPORT.test(withoutComments(source));
}

describe("credential reads stay in src/auth", () => {
  it("flags an import of the token file layer, however spelled", () => {
    for (const source of [
      `import { loadTokens } from "../auth/tokenManager.js";`,
      `import {\n  loadTokens,\n  isExpired,\n} from '../auth/tokenManager.js';`,
      `import * as tokens from "./tokenManager.js";`,
    ]) {
      expect(readsTokenFile(source), source).toBe(true);
    }
  });

  it("accepts the principal-taking entry point and comments", () => {
    for (const source of [
      `import { getValidToken } from "../auth/refresh.js";`,
      `import type { Principal } from "../auth/principal.js";`,
      `// never import "../auth/tokenManager.js" from a tool`,
    ]) {
      expect(readsTokenFile(source), source).toBe(false);
    }
  });

  it("only auth and the session tools import the token file layer", () => {
    const offenders = srcFiles()
      .filter(({ rel }) => !rel.startsWith("auth/") && !CREDENTIAL_EXEMPT.has(rel))
      .filter(({ source }) => readsTokenFile(source))
      .map(({ rel }) => rel);
    expect(
      offenders,
      `token file read outside src/auth/ — take a Principal and call ` +
        `getValidToken(principal) instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("every credential exemption still reads the token file", () => {
    // An exemption for a file that no longer imports the layer is a hole
    // nothing tests. Fail so the list shrinks when the tool stops needing it.
    const stale = [...CREDENTIAL_EXEMPT].filter((rel) => !readsTokenFile(srcSource(rel)));
    expect(stale, `exempt files that no longer read tokens: ${stale.join(", ")}`).toEqual([]);
  });
});
