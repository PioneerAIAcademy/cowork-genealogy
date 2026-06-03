#!/usr/bin/env bash
set -euo pipefail

# Verifies the packed releases/genealogy-mcp.mcpb against the bundle
# contract in docs/specs/mcpb-package-spec.md: required files present,
# forbidden files (source/tests/devDeps) absent, and the packed server
# actually boots and advertises all its tools over stdio.
#
# This is the programmatic stand-in for an end-user install. The manual
# Claude Desktop install is a layer in
# docs/testing-guides/mcpb-install-testing-guide.md.

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
MCPB="$ROOT/releases/genealogy-mcp.mcpb"

if [ ! -f "$MCPB" ]; then
  echo "ERROR: $MCPB not found. Run ./scripts/build-mcpb.sh first." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Unpacking $(basename "$MCPB") ..."
unzip -q "$MCPB" -d "$TMP"

fail=0
require() {
  if [ -e "$TMP/$1" ]; then echo "  ok    present: $1"; else echo "  FAIL  missing: $1"; fail=1; fi
}
forbid() {
  if [ -e "$TMP/$1" ]; then echo "  FAIL  present (should be absent): $1"; fail=1; else echo "  ok    absent:  $1"; fi
}

echo "Checking bundle contents..."
require manifest.json
require package.json
require build/index.js
require config/familysearch.json
require node_modules/@modelcontextprotocol/sdk

forbid src
forbid tests
forbid dev
forbid tsconfig.json
forbid vitest.config.ts
forbid node_modules/typescript
forbid node_modules/vitest
forbid node_modules/@anthropic-ai/mcpb

if [ "$fail" -ne 0 ]; then
  echo "Bundle content checks FAILED." >&2
  exit 1
fi
echo "Bundle content checks passed."

echo "Booting packed server (initialize + tools/list over stdio)..."
cat > "$TMP/handshake.mjs" <<'EOF'
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const expected = (manifest.tools ?? []).map((t) => t.name).sort();

const child = spawn("node", ["build/index.js"], {
  cwd: dir,
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
const request = (id, method, params) =>
  new Promise((resolve) => {
    pending.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
  });

const timeout = setTimeout(() => {
  console.error("  FAIL  timed out waiting for the server");
  child.kill();
  process.exit(1);
}, 15000);

try {
  const init = await request(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "verify-mcpb", version: "1.0.0" },
  });
  if (init.error) throw new Error("initialize failed: " + JSON.stringify(init.error));

  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const list = await request(2, "tools/list", {});
  if (list.error) throw new Error("tools/list failed: " + JSON.stringify(list.error));

  clearTimeout(timeout);
  child.kill();

  const got = (list.result?.tools ?? []).map((t) => t.name).sort();
  const missing = expected.filter((n) => !got.includes(n));
  const extra = got.filter((n) => !expected.includes(n));
  if (missing.length || extra.length || got.length !== expected.length) {
    console.error(`  FAIL  tool mismatch (manifest ${expected.length}, server ${got.length})`);
    if (missing.length) console.error("        missing from server:", missing.join(", "));
    if (extra.length) console.error("        extra on server:", extra.join(", "));
    process.exit(1);
  }
  console.log(`  ok    server booted; tools/list returned all ${got.length} tools`);
  process.exit(0);
} catch (e) {
  clearTimeout(timeout);
  child.kill();
  console.error("  FAIL ", e.message);
  process.exit(1);
}
EOF

node "$TMP/handshake.mjs" "$TMP"
echo "Verification passed."
