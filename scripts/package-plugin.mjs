#!/usr/bin/env node
// Packages the Cowork plugin at releases/genealogy-plugin.zip.
//
// Cross-platform (Node) replacement for the former package-plugin.sh, so it
// runs natively wherever Node does -- no bash, and no `zip` binary (Git Bash
// on Windows ships neither reliably). The .zip is written with a tiny built-in
// writer (zlib deflate + a hand-built ZIP container), so there is nothing for
// a Windows genealogist to install beyond Node itself.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = join(ROOT, "packages", "engine", "plugin");
const RELEASES = join(ROOT, "releases");
const OUT = join(RELEASES, "genealogy-plugin.zip");
// Mirrors the old `zip -r` include list (and order).
const INCLUDE = [".claude-plugin", "agents", "skills"];

// Gate: validate skill + agent frontmatter (description <=1024 chars, no angle
// brackets, valid name) BEFORE building a zip Cowork would reject at install
// time. Same check the CI gate runs (.github/workflows/check-runlogs.yml).
// Best-effort: if no Python is available we warn and continue, since CI still
// enforces it.
validateFrontmatter();

console.log("Packaging Cowork plugin...");
const files = INCLUDE.flatMap((d) => walk(join(PLUGIN, d)));
const entries = files.map((abs) => ({
  name: relative(PLUGIN, abs).split(sep).join("/"),
  data: readFileSync(abs),
  mtime: statSync(abs).mtime,
}));
mkdirSync(RELEASES, { recursive: true });
writeFileSync(OUT, buildZip(entries));
console.log(`Done. Created ${OUT} (${entries.length} files)`);

// ---- helpers --------------------------------------------------------------

function walk(dir) {
  const out = [];
  const sorted = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const e of sorted) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function validateFrontmatter() {
  const script = join(ROOT, "eval", "harness", "scripts", "check_skill_frontmatter.py");
  // Try real interpreters in order. The `--version` probe first launches the
  // candidate harmlessly, which skips the Windows Store `python3` alias (it
  // "runs" but isn't Python and would otherwise look like a failed check).
  const candidates = [["python3"], ["python"], ["py", "-3"], ["uv", "run", "python"]];
  for (const [cmd, ...pre] of candidates) {
    try {
      execFileSync(cmd, [...pre, "--version"], { stdio: "ignore" });
    } catch {
      continue; // not installed (or Store alias) -> try the next
    }
    console.log("Validating skill + agent frontmatter...");
    try {
      execFileSync(cmd, [...pre, script], { stdio: "inherit", cwd: ROOT });
    } catch {
      console.error("\nPlugin frontmatter validation failed (see above) -- not packaging.");
      process.exit(1);
    }
    return;
  }
  console.warn(
    "WARNING: no Python found -- skipping plugin frontmatter validation (CI still enforces it).",
  );
}

// Minimal ZIP writer: method 8 (deflate), no data descriptors, no zip64.
// Produces a standard archive (verified with `unzip -t`).
function buildZip(items) {
  const table = crcTable();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, data, mtime } of items) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data, table);
    const comp = deflateRawSync(data);
    const [dosTime, dosDate] = dosDateTime(mtime);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    nameBuf.copy(local, 30);
    parts.push(local, comp);

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0); // central dir header signature
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(8, 10); // method
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    // extra(30), comment(32), disk start(34), internal attrs(36) all 0
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // local header offset
    nameBuf.copy(cd, 46);
    central.push(cd);

    offset += local.length + comp.length;
  }

  const centralDir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(items.length, 8); // entries on this disk
  eocd.writeUInt16LE(items.length, 10); // total entries
  eocd.writeUInt32LE(centralDir.length, 12); // central dir size
  eocd.writeUInt32LE(offset, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...parts, centralDir, eocd]);
}

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}

function crc32(buf, t) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const y = d.getFullYear();
  if (y < 1980) return [0, 0x21]; // floor at 1980-01-01
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time & 0xffff, date & 0xffff];
}
