import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error -- plain .mjs build helper, no type declarations (tsconfig
// only compiles src/**, so this import is never typechecked).
import { BUILD_VERSION_RE, buildVersion, gitStamp } from "../../../../../scripts/build-stamp.mjs";
import { readBuildInfo } from "../../src/utils/build-info.js";

/**
 * The build stamp (#2126). Every version field in the repo was frozen at the
 * value it was created with and no build script or tool return carried a
 * build id, so nothing could say which .mcpb a tester had installed. These
 * pin the helper the three build scripts share and the runtime reader.
 */

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");

describe("BUILD_VERSION_RE — the one shape every check accepts", () => {
  // scripts/verify-mcpb.sh carries an inline copy of the regex (the unpacked
  // bundle cannot import build-stamp.mjs), and that script is the only guard
  // for a build that stops stamping. Two copies with nothing holding them
  // together would let the guard's acceptance drift silently — the same shape
  // test_write_lockdown_parity.py pins for the lockdown predicate.
  it("verify-mcpb.sh's inline copy matches the exported regex", () => {
    const sh = readFileSync(join(repoRoot, "scripts", "verify-mcpb.sh"), "utf8");
    const m = sh.match(/const BUILD_VERSION_RE = (\/.*\/);/);
    expect(m, "verify-mcpb.sh no longer declares BUILD_VERSION_RE").not.toBeNull();
    expect(m![1]).toBe(BUILD_VERSION_RE.toString());
  });

  it.each(["0.1.0+dev", "0.1.0+2026-09-17.abc12345", "0.1.0+2026-09-17.abc12345.dirty", "12.0.3+2026-01-01.0123456"])(
    "accepts %s",
    (v) => expect(v).toMatch(BUILD_VERSION_RE),
  );
  // `0.1.0` is the frozen-forever value this card exists to retire; the other
  // three are what a broken stamp helper produces (undefined / empty / no sha).
  it.each(["0.1.0", "0.1.0+", "0.1.0+undefined", "0.1.0+2026-09-17.", "0.1.0+2026-09-17.ABC12345", "0.1.0+2026-09-17.abc12345.clean"])(
    "rejects %s",
    (v) => expect(v).not.toMatch(BUILD_VERSION_RE),
  );
});

describe("buildVersion", () => {
  it("renders date.sha, adds .dirty, and matches the regex", () => {
    const clean = buildVersion("0.1.0", { sha: "abc12345", dirty: false, date: "2026-09-17" });
    const dirty = buildVersion("0.1.0", { sha: "abc12345", dirty: true, date: "2026-09-17" });
    expect(clean).toBe("0.1.0+2026-09-17.abc12345");
    expect(dirty).toBe("0.1.0+2026-09-17.abc12345.dirty");
    expect(clean).toMatch(BUILD_VERSION_RE);
    expect(dirty).toMatch(BUILD_VERSION_RE);
  });

  it("falls back to +dev when there is no sha, and never to a bare base", () => {
    expect(buildVersion("0.1.0", { sha: null, dirty: false, date: "2026-09-17" })).toBe("0.1.0+dev");
    expect(buildVersion("0.1.0", undefined)).toBe("0.1.0+dev");
    expect(buildVersion("0.1.0", { sha: "", dirty: true, date: "2026-09-17" })).toBe("0.1.0+dev");
  });

  it("refuses a non-semver base rather than stamping garbage", () => {
    expect(() => buildVersion("0.1.0+2026-09-17.abc12345", { sha: "abc12345", dirty: false, date: "x" })).toThrow(/x\.y\.z/);
    expect(() => buildVersion(undefined, null)).toThrow(/x\.y\.z/);
  });
});

describe("gitStamp — never throws", () => {
  it("yields sha: null (not an exception) outside a git checkout", () => {
    const dir = mkdtempSync(join(tmpdir(), "build-stamp-nogit-"));
    try {
      const stamp = gitStamp(dir);
      expect(stamp.sha).toBeNull();
      expect(stamp.dirty).toBe(false);
      expect(stamp.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasGit())("reads the sha and flags an untracked file as dirty", () => {
    const dir = mkdtempSync(join(tmpdir(), "build-stamp-git-"));
    try {
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: dir, stdio: "ignore", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
      git("init", "-q");
      git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
      const clean = gitStamp(dir);
      expect(clean.sha).toMatch(/^[0-9a-f]{7,40}$/);
      expect(clean.dirty).toBe(false);

      writeFileSync(join(dir, "untracked.txt"), "x");
      expect(gitStamp(dir).dirty).toBe(true);

      // No commits yet: `git rev-parse HEAD` exits 128 — must read as dev, not throw.
      const empty = mkdtempSync(join(tmpdir(), "build-stamp-empty-"));
      try {
        execFileSync("git", ["init", "-q"], { cwd: empty, stdio: "ignore" });
        expect(gitStamp(empty).sha).toBeNull();
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readBuildInfo — the runtime reader", () => {
  it("falls back to <package.json base>+dev when the file is missing, without throwing", () => {
    const info = readBuildInfo(join(tmpdir(), "definitely-missing-build-info.json"));
    expect(info.version).toBe("0.1.0+dev");
    expect(info.base).toBe("0.1.0");
    expect(info.sha).toBe("dev");
    expect(info.dirty).toBe(false);
  });

  it("returns the file's values when present, and ignores a malformed file", () => {
    const dir = mkdtempSync(join(tmpdir(), "build-info-"));
    try {
      const good = join(dir, "good.json");
      writeFileSync(good, JSON.stringify({ version: "0.1.0+2026-09-17.abc12345.dirty", base: "0.1.0", sha: "abc12345", date: "2026-09-17", dirty: true }));
      expect(readBuildInfo(good)).toEqual({ version: "0.1.0+2026-09-17.abc12345.dirty", base: "0.1.0", sha: "abc12345", date: "2026-09-17", dirty: true });

      const bad = join(dir, "bad.json");
      writeFileSync(bad, JSON.stringify({ version: "0.1.0" })); // no `+`, no other fields
      expect(readBuildInfo(bad).version).toBe("0.1.0+dev");

      const garbage = join(dir, "garbage.json");
      writeFileSync(garbage, "{ not json");
      expect(readBuildInfo(garbage).version).toBe("0.1.0+dev");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the default read is a build stamp (whatever this checkout's build wrote, or dev)", () => {
    expect(readBuildInfo().version).toMatch(BUILD_VERSION_RE);
    expect(readBuildInfo()).toBe(readBuildInfo()); // cached
  });
});
