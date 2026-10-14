// replay_fetch.mjs — the fetch hook behind `make replay-sizes` (replay mode)
// and `make replay-record` (record mode). See eval/fixtures/replay/README.md.
//
// Loaded with `node --import <bootstrap.mjs>` OUTSIDE the engine: the bootstrap
// imports this file and calls `install(config)`, which swaps
// `globalThis.fetch`. Every engine upstream call goes through the global fetch
// in `src/utils/http.ts` (pinned by tests/packaging/no-bare-fetch.test.ts), so
// no engine source changes.
//
// config:
//   mode         "record" | "replay"
//   log          JSONL file this hook appends one line per exchange to
//   wikiBase     the configured wiki base URL; canonicalised to {WIKI}
//   replay:  cassettes  [dir, ...] — each holds cassettes/*.jsonl; first match wins
//   record:  python, privacyScript, floor, allowedIds — the privacy filter
//            upstream (tests only) — a module whose default export stands in
//            for the real fetch, so the recorder runs offline under test
//
// A request header is never written. In record mode a body is written only as
// the privacy filter returned it; a filter failure writes nothing and throws.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { STATUS_CODES } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PERSISTENT_PLACEHOLDER = "ark:/61903/1:1:XXXX-XXX";
const PERSISTENT = "http://gedcomx.org/Persistent";
const MATCH_PATH = "/service/search/record/collections/match/matchTwoExamples";
const TOKEN_HOST = "ident.familysearch.org";
const FILTER_TIMEOUT_MS = 60_000;
const NULL_BODY = new Set([101, 204, 205, 304]);

function trimBase(base) {
  return String(base || "").replace(/\/+$/, "");
}

/** Canonical URL: the wiki base becomes {WIKI}; query params sorted by name. */
export function canonicalUrl(raw, wikiBase) {
  const u = new URL(String(raw));
  const params = [...u.searchParams].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const query = params.length ? "?" + new URLSearchParams(params).toString() : "";
  if (wikiBase) {
    const b = new URL(trimBase(wikiBase));
    const bpath = b.pathname.replace(/\/+$/, "");
    if (
      u.protocol === b.protocol && u.host === b.host &&
      (bpath === "" || u.pathname === bpath || u.pathname.startsWith(bpath + "/"))
    ) {
      return "{WIKI}" + u.pathname.slice(bpath.length) + query;
    }
  }
  return `${u.protocol}//${u.host}${u.pathname}${query}`;
}

function maskPersistent(node) {
  if (Array.isArray(node)) return node.map(maskPersistent);
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "identifiers" && v && typeof v === "object" && Array.isArray(v[PERSISTENT])) {
        out[k] = { ...maskPersistent(v), [PERSISTENT]: v[PERSISTENT].map(() => PERSISTENT_PLACEHOLDER) };
      } else {
        out[k] = maskPersistent(v);
      }
    }
    return out;
  }
  return node;
}

/** The body the key hashes. matchTwoExamples bodies carry randomly minted
 *  Persistent ARKs (`randomFsId`, `toValidFsArk`), so every one is masked. */
export function canonicalBody(method, url, body) {
  const text = typeof body === "string" ? body : body == null ? "" : String(body);
  if (method === "POST" && new URL(String(url)).pathname === MATCH_PATH && text) {
    try {
      return JSON.stringify(maskPersistent(JSON.parse(text)));
    } catch {
      return text;
    }
  }
  return text;
}

function describe(input, init) {
  const isRequest = typeof Request !== "undefined" && input instanceof Request;
  const rawUrl = isRequest ? input.url : String(input);
  const method = String(init?.method ?? (isRequest ? input.method : "GET")).toUpperCase();
  const headers = new Headers(init?.headers ?? (isRequest ? input.headers : undefined));
  const body = init?.body;
  return { rawUrl, method, accept: headers.get("accept") ?? "", body };
}

/** METHOD␠canonical-URL␠accept␠sha256(canonical body). */
export function canonicalKey(method, rawUrl, accept, body, wikiBase) {
  const url = canonicalUrl(rawUrl, wikiBase);
  const bodySha = createHash("sha256").update(canonicalBody(method, rawUrl, body), "utf8").digest("hex");
  return { key: `${method} ${url} ${accept} ${bodySha}`, url, accept, body_sha256: bodySha };
}

function logLine(file, obj) {
  appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
}

function makeResponse(status, statusText, contentType, body, extra = {}) {
  const headers = { ...extra };
  if (contentType) headers["content-type"] = contentType;
  return new Response(NULL_BODY.has(status) ? null : body, { status, statusText, headers });
}

// ─── replay ──────────────────────────────────────────────────────────────────

export function loadCassettes(dirs) {
  const table = new Map();
  for (const dir of dirs) {
    const cdir = join(dir, "cassettes");
    if (!existsSync(cdir)) continue;
    for (const name of readdirSync(cdir).filter((n) => n.endsWith(".jsonl")).sort()) {
      for (const raw of readFileSync(join(cdir, name), "utf8").split("\n")) {
        if (!raw.trim()) continue;
        const line = JSON.parse(raw);
        if (!table.has(line.key)) table.set(line.key, line);
      }
    }
  }
  return table;
}

function replayFetch(config) {
  const table = loadCassettes(config.cassettes ?? []);
  return async function fetch(input, init) {
    const { rawUrl, method, accept, body } = describe(input, init);
    const k = canonicalKey(method, rawUrl, accept, body, config.wikiBase);
    const hit = table.get(k.key);
    // Every access is logged — the harness dedupes misses per call (an engine
    // retry re-issues the same key) and refuses any access by a local tool.
    logLine(config.log, { event: hit ? "hit" : "miss", key: k.key });
    if (!hit) throw new Error(`replay: cassette miss ${k.key}`);
    return makeResponse(hit.status, STATUS_CODES[hit.status] ?? "", hit.content_type, hit.body);
  };
}

// ─── record ──────────────────────────────────────────────────────────────────

function runFilter(config, envelope) {
  return new Promise((resolve, reject) => {
    const args = ["-I", config.privacyScript, "filter", "--floor", String(config.floor),
      "--allowed-ids", config.allowedIds];
    const child = spawn(config.python, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("privacy filter timed out"));
    }, FILTER_TIMEOUT_MS);
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`privacy filter exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-500)}`));
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(out).toString("utf8"));
        if (parsed.action !== "store" && parsed.action !== "withhold") throw new Error("no action");
        if (parsed.action === "store" && typeof parsed.body !== "string") throw new Error("no body");
        resolve(parsed);
      } catch (e) {
        reject(new Error(`privacy filter output did not parse: ${e.message}`));
      }
    });
    child.stdin.end(Buffer.from(JSON.stringify(envelope), "utf8"));
  });
}

function recordFetch(config, original) {
  let inflight = 0;
  return async function fetch(input, init) {
    const { rawUrl, method, accept, body } = describe(input, init);
    if (new URL(rawUrl).host === TOKEN_HOST) return original(input, init);
    const k = canonicalKey(method, rawUrl, accept, body, config.wikiBase);
    inflight++;
    let res;
    try {
      res = await original(input, init);
    } catch (e) {
      inflight--;
      const timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
      logLine(config.log, { event: "error", key: k.key, kind: timeout ? "timeout" : "network", inflight });
      throw e;
    }
    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    let filtered;
    try {
      filtered = await runFilter(config, { method, url: k.url, status: res.status, body: text });
    } catch (e) {
      inflight--;
      logLine(config.log, { event: "abort", reason: "privacy-filter-failed", detail: String(e?.message ?? e), inflight });
      throw new Error(`replay-record: privacy filter failed — ${e?.message ?? e}`);
    }
    inflight--;
    if (filtered.action === "store") {
      logLine(config.log, {
        event: "exchange", group: filtered.group, key: k.key, method, url: k.url, accept,
        body_sha256: k.body_sha256, status: res.status, content_type: contentType,
        body: filtered.body, rewrites: filtered.rewrites ?? {}, inflight,
      });
    } else {
      logLine(config.log, { event: "withhold", reason: filtered.reason, status: res.status, inflight });
    }
    const extra = {};
    const retryAfter = res.headers.get("retry-after");
    if (retryAfter) extra["retry-after"] = retryAfter;
    const outBody = filtered.action === "store" ? filtered.body : text;
    return makeResponse(res.status, res.statusText, contentType, outBody, extra);
  };
}

export async function install(config) {
  if (config.mode === "replay") {
    globalThis.fetch = replayFetch(config);
    return;
  }
  if (config.mode === "record") {
    let original = globalThis.fetch;
    if (config.upstream) original = (await import(pathToFileURL(config.upstream).href)).default;
    globalThis.fetch = recordFetch(config, original);
    return;
  }
  throw new Error(`replay_fetch: unknown mode ${config.mode}`);
}
