// probe-readonly-project-files — does keeping the two project files read-only
// on disk survive Windows?
//
// WHY. The raw-write lockdown matches tool NAMES, and `device_bash` walks past
// it: on 2026-08-17 a `python open(path,'w')` through the device bridge appended
// an invalid entry to a real `research.json`, which then failed schema
// validation on nine counts AND blocked every sanctioned writer, because they
// all validate the whole project before persisting. One shell write locked the
// project out of the tools that would have kept it valid.
//
// A command-text matcher cannot fix that: `cat research.json` and
// `cat > research.json` are indistinguishable without parsing a shell, and 37 of
// the 40 shell touches of a protected file in the committed corpus are reads the
// system depends on. So the candidate fix makes the FILE the unit rather than the
// command — keep both project files read-only, and have the shared write layer
// re-apply the mode after each write.
//
// Measured on macOS (2026-08-17): `> file`, `>> file`, `tee` and
// `python open(w)` are all blocked by mode 444, reads still work, and
// `atomicWriteJson` / `atomicWriteBoth` still SUCCEED because they rename a temp
// over the target and POSIX rename ignores the target's mode. The mode does not
// survive the rename (it becomes 644), so the write layer must re-apply it.
//
// THE OPEN QUESTION, AND WHY THIS SCRIPT EXISTS. Windows `MoveFileEx` over an
// existing READ-ONLY target is widely reported to fail with EPERM/EACCES, unlike
// POSIX. If that holds, this design does not merely weaken on Windows — it
// BREAKS every sanctioned write there, on the platform the genealogist team runs.
// This repo has already been bitten by exactly that asymmetry once: the
// lockdown's own path splitting was a silent no-op on Windows until someone
// noticed. So measure it rather than reason about it.
//
// RUN IT ON WINDOWS:
//   cd packages/engine/mcp-server
//   npx tsx dev/probe-readonly-project-files.ts
//
// Report the whole output. The line that decides the design is "fs.rename over a
// read-only target".

import { mkdtemp, writeFile, chmod, rm, rename, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const results: Array<[string, string]> = [];

async function attempt(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    results.push([label, "SUCCEEDED"]);
  } catch (e) {
    const code = (e as { code?: string }).code ?? (e as Error).message;
    results.push([label, `failed (${code})`]);
  }
}

const dir = await mkdtemp(join(tmpdir(), "readonly-probe-"));
const target = join(dir, "research.json");

const reset = async (): Promise<void> => {
  await chmod(target, 0o644).catch(() => {});
  await writeFile(target, "{}");
  await chmod(target, 0o444);
};

// The one that decides it: the sanctioned write path is write-temp-then-rename.
await reset();
const tmp = join(dir, "research.json.tmp");
await writeFile(tmp, '{"log":[]}');
await attempt("fs.rename over a read-only target", () => rename(tmp, target));

// What the mode is after a successful rename — if protection does not survive,
// the write layer has to re-apply it.
try {
  const mode = ((await stat(target)).mode & 0o777).toString(8);
  results.push(["mode after rename", mode]);
} catch {
  results.push(["mode after rename", "target unreadable"]);
}

// The shapes the guard is meant to stop.
await reset();
await attempt("open for write ( 'w' )", () => writeFile(target, "x", { flag: "w" }));
await reset();
await attempt("open for append ( 'a' )", () => writeFile(target, "x", { flag: "a" }));

// The read path, which must keep working — it is 37 of 40 corpus touches.
await reset();
await attempt("read", async () => {
  const { readFile } = await import("fs/promises");
  await readFile(target, "utf-8");
});

// Can the mode simply be taken off? On POSIX yes, and that is accepted: it turns
// a one-step accident into a two-step deliberate act.
await reset();
await attempt("chmod 644 then write", async () => {
  await chmod(target, 0o644);
  await writeFile(target, "x", { flag: "w" });
});

// THE PROPOSED FIX, measured on both platforms rather than reasoned about.
// Windows reported `fs.rename over a read-only target` as EPERM (2026-08-17),
// where POSIX succeeds — so the write layer cannot simply rename and re-apply
// the mode. It has to CLEAR the attribute first, rename, then re-apply:
//
//     chmod(target, 0o644)   // no-op if absent
//     writeFile(tmp)
//     rename(tmp, target)
//     chmod(target, 0o444)
//
// This section runs that sequence end to end and then checks the file is
// protected again afterwards. Both lines must pass on every platform for the
// file-mode approach to be shippable.
await reset();
const tmp2 = join(dir, "research.json.tmp2");
await attempt("FIX: unlock, rename, re-lock", async () => {
  await chmod(target, 0o644).catch(() => {});
  await writeFile(tmp2, '{"log":[{"id":"log_001"}]}');
  await rename(tmp2, target);
  await chmod(target, 0o444);
});
await attempt("FIX: still blocks a shell-style write after", async () => {
  // Inverted on purpose: this SUCCEEDS only if the write was refused.
  try {
    await writeFile(target, "x", { flag: "w" });
  } catch {
    return;
  }
  throw new Error("write was allowed — protection did not survive the fix");
});

await rm(dir, { recursive: true, force: true });

console.log(`platform: ${process.platform}  node: ${process.version}\n`);
for (const [label, outcome] of results) {
  console.log(`  ${label.padEnd(36)} ${outcome}`);
}
console.log(
  "\nMEASURED SO FAR:\n" +
    "  macOS  2026-08-17 — rename over a read-only target SUCCEEDS.\n" +
    "  win32  2026-08-17 — rename over a read-only target FAILS (EPERM), so a\n" +
    "         plain rename-and-re-apply design breaks every sanctioned write there.\n" +
    "\nBOTH 'FIX:' LINES MUST PASS for the file-mode approach to be shippable: the\n" +
    "first proves the sanctioned write still works, the second that protection\n" +
    "survives it. A pass on one platform proves nothing about the other — that\n" +
    "asymmetry is the whole reason this probe exists.",
);
