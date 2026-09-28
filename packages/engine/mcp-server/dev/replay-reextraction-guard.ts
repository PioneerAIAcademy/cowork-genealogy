// Replay the committed e2e corpus against the §3.4.3 re-extraction guard.
//
//   npx tsx dev/replay-reextraction-guard.ts [--verbose]
//
// For every eval/runlogs/e2e/<fixture>/run-*.json, walks the recorded writer
// calls (research_append / extraction_append, any server spelling, single-op
// and ops[] forms) in log order, simulates the research.json assertion and
// source sets the tool would have held BEFORE each call, and reports every
// call the guard would refuse. The key is the tool's own `reextractionKey` —
// never re-implemented here.
//
// The gate: the tool runs the guard only when the batch's §3.4.1 source-reuse
// fold returned `sourceReuse.action === "updated_existing"` (exactly one
// sources append with no explicit gedcomx_source_description_id, ≥1 assertions
// append with a record_id, and an existing source covering that record with the
// same normalized repository). The replay takes the response's recorded
// sourceReuse.action when present, else its own simulation of the fold. Calls
// the gate skips are reported separately as "spared" when the ungated key would
// have collided. For folded calls it also reports the MISSES: ops that collide
// on the key with log_entry_id blanked but not with it — a re-extraction under
// a NEW log entry, split by whether that log entry is an image pass.
//
// Outcome of a call: `is_error: true` or `"ok": false` in the response → failed
// (nothing enters the simulated set); `"ok": true` → succeeded; no recorded
// response at all (every run before 2026-07-29) → counted as "no outcome" and
// treated as succeeded.
//
// Stamping, per assertion append:
//   id        — the response's per-op entryIds when present, else next a_NNN.
//   source_id — explicit on the entry; else the response's sourceReuse.srcId /
//               sources-append entryId; else simulated §3.4.1 (same record +
//               same repository → fold onto the existing src_; otherwise the
//               single sources append's next src_NNN).
//   record_persona_id — when the entry omits it, the tool may auto-fill it from
//               the log entry's search sidecar (D2), which is not in the run
//               log; it is taken from the run's final-research.json sibling,
//               matched by assertion id (checked against record/role/fact) or,
//               failing that, by content in order within the run.
// Assertion `update` ops that succeeded are applied to the simulated set, so a
// later update of log_entry_id/fact_type/source_id moves the key as it would.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { reextractionKey } from "../src/tools/research-append.js";
import { arkToBareId } from "../src/utils/ark.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const E2E = join(HERE, "..", "..", "..", "..", "eval", "runlogs", "e2e");
const VERBOSE = process.argv.includes("--verbose");

type Outcome = "succeeded" | "failed" | "none";

interface SimAssertion {
  id: string;
  entry: any;
  call: number;
  outcome: Outcome;
}

const stats = {
  runs: 0,
  runsWithFinal: 0,
  writerCalls: 0,
  callsWithAssertionAppends: 0,
  replayed: 0,
  noOutcome: 0,
  noOutcomeWithAssertionAppends: 0,
  failed: 0,
  succeeded: 0,
  emptyArgs: 0,
  assertionAppendsSimulated: 0,
  idFromResponse: 0,
  idFromCounter: 0,
  responseIdCounterMismatch: 0,
  srcFromEntry: 0,
  srcFromResponse: 0,
  srcSimFold: 0,
  srcSimNext: 0,
  srcUnresolved: 0,
  finalMatchById: 0,
  finalMatchByContent: 0,
  finalUnmatched: 0,
  finalSourceAgree: 0,
  finalSourceDisagree: 0,
  personaFilledFromFinal: 0,
  keyUndefined: 0,
  refusalsOnFailedCalls: 0,
  imagePassAppends: 0,
  imagePassCalls: 0,
  imagePassRuns: 0,
};

interface Refusal {
  fixture: string;
  run: string;
  callIndex: number;
  tool: string;
  agent: string | null;
  outcome: Outcome;
  opIndex: number;
  newId: string;
  record: string;
  source: string;
  log: string;
  logTool: string;
  who: string;
  factType: string;
  collided: { id: string; call: number; outcome: Outcome; log: string }[];
  sharesLog: boolean;
  newValue: string;
  collidedValues: string[];
  /** assertions in final-research.json holding this key */
  finalCount: number;
  /** ops in the refused call holding this same key */
  sameKeyInCall: number;
  /** this op's value equals one of the collided assertions' values */
  identicalValue: boolean;
  /** why the §3.4.1 fold did (or did not) return updated_existing */
  gateReason: string;
}
const refusals: Refusal[] = [];
/** ungated key hits on calls the gate skips (no updated_existing fold) */
const spared: Refusal[] = [];
/** folded calls: key hits only once log_entry_id is blanked on both sides */
const misses: Refusal[] = [];
const gate = {
  foldedCalls: 0,
  foldedFromResponse: 0,
  foldedFromSim: 0,
  foldedFailed: 0,
  imageFolded: 0,
  imageFoldedWithLog: 0,
  imageFoldedWithoutLogOnly: 0,
  imageFoldedNeither: 0,
};
const IMAGE_TOOLS = ["image_transcribe", "image_read"];
function withoutLog(e: any): any {
  return { ...e, log_entry_id: undefined };
}

function readJson(p: string): any {
  return JSON.parse(readFileSync(p, { encoding: "utf-8" }));
}

function num(id: unknown, prefix: string): number {
  if (typeof id !== "string") return 0;
  const m = id.match(new RegExp(`^${prefix}(\\d+)$`));
  return m ? Number(m[1]) : 0;
}
function nextId(ids: Iterable<string>, prefix: string): string {
  let max = 0;
  for (const id of ids) max = Math.max(max, num(id, prefix));
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

/** Unescape the harness's nested JSON-in-JSON text until quotes are bare. */
function flatten(s: string): string {
  let out = s;
  for (let i = 0; i < 4 && out.includes('\\"'); i++) out = out.replace(/\\\\/g, "\\").replace(/\\"/g, '"');
  return out;
}

function outcomeOf(t: any): { outcome: Outcome; text: string } {
  const raw = t.response_summary;
  if (t.is_error === true) return { outcome: "failed", text: typeof raw === "string" ? flatten(raw) : "" };
  if (raw === undefined || raw === null) return { outcome: "none", text: "" };
  const text = flatten(typeof raw === "string" ? raw : JSON.stringify(raw));
  const m = text.match(/"ok"\s*:\s*(true|false)/);
  if (m) return { outcome: m[1] === "true" ? "succeeded" : "failed", text };
  // A response with no ok flag and is_error not true: an MCP-level error string
  // (e.g. "Error: ...") or unparseable. Treat an explicit is_error:false as success.
  if (/^\s*(\[\s*\{\s*"type"\s*:\s*"text"\s*,\s*"text"\s*:\s*")?\s*(MCP error|Error)/i.test(text)) {
    return { outcome: "failed", text };
  }
  return { outcome: t.is_error === false ? "succeeded" : "none", text };
}

function opsOf(args: any): any[] {
  if (!args || typeof args !== "object") return [];
  if (Array.isArray(args.ops)) return args.ops;
  if (typeof args.ops === "string") {
    try {
      const p = JSON.parse(args.ops);
      if (Array.isArray(p)) return p;
    } catch {
      /* fall through */
    }
  }
  if (typeof args.section === "string") {
    return [{ section: args.section, op: args.op, entry: args.entry, entryId: args.entryId, fields: args.fields }];
  }
  return [];
}

function norm(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}
function bare(v: unknown): string {
  return typeof v === "string" ? arkToBareId(v) : "";
}
function valueStr(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v ?? null);
}

function isWriter(tool: unknown): tool is string {
  return typeof tool === "string" && /(^|__)(research_append|extraction_append)$/.test(tool);
}

function replayRun(fixture: string, runFile: string): void {
  const runPath = join(E2E, fixture, runFile);
  const log = readJson(runPath);
  const base = runFile.replace(/\.json$/, "");
  const finalPath = join(E2E, fixture, `${base}.final-research.json`);
  const final = existsSync(finalPath) ? readJson(finalPath) : null;
  stats.runs++;
  if (final) stats.runsWithFinal++;
  const finalAssertions: any[] = Array.isArray(final?.assertions) ? final.assertions : [];
  const finalById = new Map<string, any>(finalAssertions.map((a) => [a.id, a]));
  const finalLogById = new Map<string, any>(
    (Array.isArray(final?.log) ? final.log : []).map((l: any) => [l?.id, l]),
  );
  const usedFinal = new Set<string>();
  const finalKeyCount = new Map<string, number>();
  const finalKeyCountNoLog = new Map<string, number>();
  for (const a of finalAssertions) {
    const k = reextractionKey(a);
    if (k !== undefined) finalKeyCount.set(k, (finalKeyCount.get(k) ?? 0) + 1);
    const k2 = reextractionKey(withoutLog(a));
    if (k2 !== undefined) finalKeyCountNoLog.set(k2, (finalKeyCountNoLog.get(k2) ?? 0) + 1);
  }

  const assertions = new Map<string, SimAssertion>();
  const sources = new Map<string, any>();
  let runHasImagePass = false;

  const calls: any[] = Array.isArray(log.tool_calls) ? log.tool_calls : [];
  calls.forEach((t, callIndex) => {
    if (!isWriter(t.tool)) return;
    stats.writerCalls++;
    const args = t.args;
    if (!args || (typeof args === "object" && Object.keys(args).length === 0)) stats.emptyArgs++;
    const ops = opsOf(args).map((o) => (o && typeof o === "object" ? structuredClone(o) : o));
    const assertionAppendIdx = ops
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o?.section === "assertions" && o?.op === "append" && o.entry && typeof o.entry === "object")
      .map(({ i }) => i);
    const { outcome, text } = outcomeOf(t);
    stats.replayed++;
    if (outcome === "none") stats.noOutcome++;
    if (outcome === "failed") stats.failed++;
    if (outcome === "succeeded") stats.succeeded++;
    if (assertionAppendIdx.length > 0) {
      stats.callsWithAssertionAppends++;
      if (outcome === "none") stats.noOutcomeWithAssertionAppends++;
    }

    // ── ids the response reported, in op order ──
    const respAssertionIds = [...text.matchAll(/"section"\s*:\s*"assertions"\s*,\s*"op"\s*:\s*"append"\s*,\s*"entryId"\s*:\s*"(a_\d+)"/g)].map((m) => m[1]);
    const respSourceAppendIds = [...text.matchAll(/"section"\s*:\s*"sources"\s*,\s*"op"\s*:\s*"append"\s*,\s*"entryId"\s*:\s*"(src_\d+)"/g)].map((m) => m[1]);
    const reuse = text.match(/"sourceReuse"\s*:\s*\{\s*"action"\s*:\s*"(\w+)"\s*,\s*"srcId"\s*:\s*"(src_\d+)"/);

    // ── source stamping (mirrors prepareOps steps 0 and 3) ──
    const sourceAppends = ops.map((o, i) => ({ o, i })).filter(({ o }) => o?.section === "sources" && o?.op === "append");
    let batchSrc: string | undefined;
    let batchSrcHow: "response" | "fold" | "next" | undefined;
    let foldedOnto: string | undefined;
    let foldHow: "response" | "sim" | undefined;
    if (sourceAppends.length === 1) {
      const srcEntry = sourceAppends[0].o.entry ?? {};
      if (reuse) {
        batchSrc = reuse[2];
        batchSrcHow = "response";
        if (reuse[1] === "updated_existing") {
          foldedOnto = reuse[2];
          foldHow = "response";
        }
      } else if (respSourceAppendIds.length === 1) {
        batchSrc = respSourceAppendIds[0];
        batchSrcHow = "response";
      } else {
        // simulate §3.4.1 fold
        const recordKeys = new Set(
          assertionAppendIdx.map((i) => ops[i].entry.record_id).filter((v: unknown) => typeof v === "string" && v !== "").map(bare),
        );
        if (srcEntry.gedcomx_source_description_id == null && recordKeys.size > 0) {
          const srcIds = new Set<string>();
          for (const a of assertions.values()) {
            if (typeof a.entry.record_id === "string" && typeof a.entry.source_id === "string" && recordKeys.has(bare(a.entry.record_id))) {
              srcIds.add(a.entry.source_id);
            }
          }
          const want = norm(srcEntry.repository);
          const same = want !== "" ? [...sources.values()].find((s) => srcIds.has(s.id) && norm(s.repository) === want) : undefined;
          if (same) {
            batchSrc = same.id;
            batchSrcHow = "fold";
            foldedOnto = same.id;
            foldHow = "sim";
          }
        }
        if (!batchSrc) {
          batchSrc = nextId(sources.keys(), "src_");
          batchSrcHow = "next";
        }
      }
    }

    // ── assertion ids + stamped entries ──
    const idsInSet = () => [...assertions.keys()];
    const counterBase = num(nextId(idsInSet(), "a_"), "a_");
    const stamped: { opIndex: number; id: string; entry: any; idHow: string; srcHow: string }[] = [];
    assertionAppendIdx.forEach((opIndex, k) => {
      const entry = ops[opIndex].entry;
      let id: string;
      let idHow: string;
      if (respAssertionIds[k]) {
        id = respAssertionIds[k];
        idHow = "response";
        if (num(id, "a_") !== counterBase + k) stats.responseIdCounterMismatch++;
      } else {
        id = `a_${String(counterBase + k).padStart(3, "0")}`;
        idHow = "counter";
      }
      let srcHow: string;
      if (typeof entry.source_id === "string" && entry.source_id !== "") srcHow = "entry";
      else if (batchSrc) {
        entry.source_id = batchSrc;
        srcHow = batchSrcHow!;
      } else srcHow = "unresolved";
      stamped.push({ opIndex, id, entry, idHow, srcHow });
    });

    // ── final-research.json fill (D2 persona auto-fill) + diagnostics ──
    for (const s of stamped) {
      const e = s.entry;
      let f = finalById.get(s.id);
      let how = "id";
      if (
        !f ||
        usedFinal.has(s.id) ||
        bare(f.record_id) !== bare(e.record_id) ||
        norm(f.record_role) !== norm(e.record_role)
      ) {
        f = finalAssertions.find(
          (x) =>
            !usedFinal.has(x.id) &&
            bare(x.record_id) === bare(e.record_id) &&
            norm(x.record_role) === norm(e.record_role) &&
            norm(x.fact_type) === norm(e.fact_type) &&
            valueStr(x.value) === valueStr(e.value),
        );
        how = f ? "content" : "none";
      }
      if (outcome !== "failed") {
        if (how === "id") stats.finalMatchById++;
        else if (how === "content") stats.finalMatchByContent++;
        else stats.finalUnmatched++;
        if (f) {
          usedFinal.add(f.id);
          if (typeof f.source_id === "string" && typeof e.source_id === "string") {
            if (f.source_id === e.source_id) stats.finalSourceAgree++;
            else stats.finalSourceDisagree++;
          }
        }
      }
      if (f && (e.record_persona_id === undefined || e.record_persona_id === null) && typeof f.record_persona_id === "string") {
        e.record_persona_id = f.record_persona_id;
        if (outcome !== "failed") stats.personaFilledFromFinal++;
      }
    }

    // ── the guard, against the PRE-CALL set, gated on the §3.4.1 fold ──
    const gated = foldedOnto !== undefined && assertionAppendIdx.length > 0;
    const gateReason = gated
      ? `folded:${foldHow}`
      : sourceAppends.length === 0
        ? "no sources append"
        : sourceAppends.length > 1
          ? `${sourceAppends.length} sources appends`
          : reuse
            ? `recorded sourceReuse=${reuse[1]}`
            : sourceAppends[0].o.entry?.gedcomx_source_description_id != null
              ? "explicit gedcomx_source_description_id"
              : "no existing source for record+repository";
    if (gated) {
      if (outcome === "failed") gate.foldedFailed++;
      else {
        gate.foldedCalls++;
        if (foldHow === "response") gate.foldedFromResponse++;
        else gate.foldedFromSim++;
      }
    }
    const existing = new Map<string, SimAssertion[]>();
    const existingNoLog = new Map<string, SimAssertion[]>();
    for (const a of assertions.values()) {
      const k = reextractionKey(a.entry);
      if (k !== undefined) existing.set(k, [...(existing.get(k) ?? []), a]);
      const k2 = reextractionKey(withoutLog(a.entry));
      if (k2 !== undefined) existingNoLog.set(k2, [...(existingNoLog.get(k2) ?? []), a]);
    }
    const callKeyCount = new Map<string, number>();
    const callKeyCountNoLog = new Map<string, number>();
    for (const s of stamped) {
      const k = reextractionKey(s.entry);
      if (k !== undefined) callKeyCount.set(k, (callKeyCount.get(k) ?? 0) + 1);
      const k2 = reextractionKey(withoutLog(s.entry));
      if (k2 !== undefined) callKeyCountNoLog.set(k2, (callKeyCountNoLog.get(k2) ?? 0) + 1);
    }
    const mk = (s: (typeof stamped)[number], k: string, hit: SimAssertion[], noLog = false): Refusal => {
      const e = s.entry;
      const logId = typeof e.log_entry_id === "string" ? e.log_entry_id : "";
      return {
        fixture,
        run: base,
        callIndex,
        tool: String(t.tool).split("__").pop()!,
        agent: t.agent_type ?? null,
        outcome,
        opIndex: s.opIndex,
        newId: `${s.id}(${s.idHow})`,
        record: bare(e.record_id),
        source: `${e.source_id}(${s.srcHow}${foldedOnto ? `,folded:${foldHow}` : ""})`,
        log: logId || "(none)",
        logTool: finalLogById.get(logId)?.tool ?? "?",
        who: e.record_persona_id ? `persona:${e.record_persona_id}` : `role:${e.record_role}`,
        factType: String(e.fact_type),
        collided: hit.map((h) => ({ id: h.id, call: h.call, outcome: h.outcome, log: h.entry.log_entry_id ?? "(none)" })),
        sharesLog: hit.every((h) => (h.entry.log_entry_id ?? "") === logId),
        newValue: valueStr(e.value).slice(0, 60),
        collidedValues: hit.map((h) => valueStr(h.entry.value).slice(0, 60)),
        finalCount: (noLog ? finalKeyCountNoLog : finalKeyCount).get(k) ?? 0,
        sameKeyInCall: (noLog ? callKeyCountNoLog : callKeyCount).get(k) ?? 1,
        identicalValue: hit.some((h) => valueStr(h.entry.value) === valueStr(e.value)),
        gateReason,
      };
    };
    let callHitWithLog = false;
    let callHitWithoutLogOnly = false;
    for (const s of stamped) {
      const k = reextractionKey(s.entry);
      if (k === undefined) {
        if (outcome !== "failed") stats.keyUndefined++;
        continue;
      }
      const hit = existing.get(k);
      if (!gated) {
        if (hit && outcome !== "failed") spared.push(mk(s, k, hit));
        continue;
      }
      if (hit) {
        callHitWithLog = true;
        if (outcome === "failed") {
          stats.refusalsOnFailedCalls++;
          continue;
        }
        refusals.push(mk(s, k, hit));
        continue;
      }
      const k2 = reextractionKey(withoutLog(s.entry))!;
      const hit2 = existingNoLog.get(k2);
      if (hit2) {
        callHitWithoutLogOnly = true;
        if (outcome !== "failed") misses.push(mk(s, k2, hit2, true));
      }
    }
    if (gated && outcome !== "failed") {
      const isImage = stamped.some((x) => IMAGE_TOOLS.includes(finalLogById.get(x.entry.log_entry_id)?.tool));
      if (isImage) {
        gate.imageFolded++;
        if (callHitWithLog) gate.imageFoldedWithLog++;
        else if (callHitWithoutLogOnly) gate.imageFoldedWithoutLogOnly++;
        else gate.imageFoldedNeither++;
      }
    }

    if (outcome === "failed") return;

    // ── apply the call to the simulated state ──
    const imageOps = stamped.filter((x) => IMAGE_TOOLS.includes(finalLogById.get(x.entry.log_entry_id)?.tool)).length;
    if (imageOps > 0) {
      stats.imagePassAppends += imageOps;
      stats.imagePassCalls++;
      runHasImagePass = true;
    }
    for (const s of stamped) {
      stats.assertionAppendsSimulated++;
      if (s.idHow === "response") stats.idFromResponse++;
      else stats.idFromCounter++;
      if (s.srcHow === "entry") stats.srcFromEntry++;
      else if (s.srcHow === "response") stats.srcFromResponse++;
      else if (s.srcHow === "fold") stats.srcSimFold++;
      else if (s.srcHow === "next") stats.srcSimNext++;
      else stats.srcUnresolved++;
      assertions.set(s.id, { id: s.id, entry: s.entry, call: callIndex, outcome });
    }
    if (sourceAppends.length === 1 && batchSrc && !foldedOnto) {
      sources.set(batchSrc, { ...(sourceAppends[0].o.entry ?? {}), id: batchSrc });
    } else if (sourceAppends.length > 1) {
      // multi-source batch: ids from the response when given, else sequential
      let n = num(nextId(sources.keys(), "src_"), "src_");
      sourceAppends.forEach(({ o }, j) => {
        const id = respSourceAppendIds[j] ?? `src_${String(n++).padStart(3, "0")}`;
        sources.set(id, { ...(o.entry ?? {}), id });
      });
    }
    for (const o of ops) {
      if (o?.op !== "update" || typeof o.entryId !== "string" || !o.fields || typeof o.fields !== "object") continue;
      if (o.section === "assertions") {
        const a = assertions.get(o.entryId);
        if (a) a.entry = { ...a.entry, ...o.fields };
      } else if (o.section === "sources") {
        const src = sources.get(o.entryId);
        if (src) sources.set(o.entryId, { ...src, ...o.fields });
      }
    }
  });
  if (runHasImagePass) stats.imagePassRuns++;
}

const fixtures = readdirSync(E2E, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
for (const fx of fixtures) {
  const runs = readdirSync(join(E2E, fx)).filter((f) => /^run-.*\.json$/.test(f) && !/\.(ann|final-[^.]+)\.json$/.test(f) && !f.includes(".final-") && !f.includes(".ann.")).sort();
  for (const r of runs) replayRun(fx, r);
}

// ── report ──
function groupByCall(rs: Refusal[]): Map<string, Refusal[]> {
  const m = new Map<string, Refusal[]>();
  for (const r of rs) {
    const k = `${r.fixture}/${r.run}#${r.callIndex}`;
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
}
const byCall = groupByCall(refusals);
const sparedByCall = groupByCall(spared);
const missByCall = groupByCall(misses);

console.log("§3.4.3 re-extraction guard — e2e corpus replay");
console.log(`corpus: ${E2E}`);
console.log("");
console.log(`runs scanned:                          ${stats.runs} (${stats.runsWithFinal} with final-research.json)`);
console.log(`writer calls replayed:                 ${stats.replayed}  (research_append + extraction_append)`);
console.log(`  succeeded (ok:true):                 ${stats.succeeded}`);
console.log(`  failed (is_error / ok:false):        ${stats.failed}`);
console.log(`  no recorded outcome (→ succeeded):   ${stats.noOutcome}`);
console.log(`  empty args (harness-dropped input):  ${stats.emptyArgs}`);
console.log(`calls with ≥1 assertions append:       ${stats.callsWithAssertionAppends}  (${stats.noOutcomeWithAssertionAppends} of them with no outcome)`);
console.log(`assertion appends entered the set:     ${stats.assertionAppendsSimulated}`);
console.log(`  id from response / from counter:     ${stats.idFromResponse} / ${stats.idFromCounter}  (response id ≠ simulated counter: ${stats.responseIdCounterMismatch})`);
console.log(
  `  source_id  entry/response/fold/next/unresolved: ${stats.srcFromEntry}/${stats.srcFromResponse}/${stats.srcSimFold}/${stats.srcSimNext}/${stats.srcUnresolved}`,
);
console.log(
  `  final-research match  by-id/by-content/none: ${stats.finalMatchById}/${stats.finalMatchByContent}/${stats.finalUnmatched}` +
    `  (source_id agrees with final: ${stats.finalSourceAgree}, disagrees: ${stats.finalSourceDisagree})`,
);
console.log(`  record_persona_id filled from final: ${stats.personaFilledFromFinal}`);
console.log(`  key undefined (absent / malformed):  ${stats.keyUndefined}`);
console.log(`guard hits on calls that failed anyway: ${stats.refusalsOnFailedCalls} op(s) (not listed)`);
console.log("");
console.log(
  `GATE (§3.4.1 updated_existing): ${gate.foldedCalls} non-failed call(s) folded` +
    ` (${gate.foldedFromResponse} from recorded sourceReuse, ${gate.foldedFromSim} simulated); ${gate.foldedFailed} folded call(s) failed anyway`,
);
console.log(`  calls the ungated key would hit but the gate skips (spared): ${sparedByCall.size} (${spared.length} op(s)) — listed in section S`);
console.log(
  `  image_transcribe/image_read-pass calls that folded: ${gate.imageFolded}` +
    ` — collide WITH the log in the key: ${gate.imageFoldedWithLog}; only WITHOUT it: ${gate.imageFoldedWithoutLogOnly}; neither: ${gate.imageFoldedNeither}` +
    `  (image-pass appends replayed overall: ${stats.imagePassAppends} ops in ${stats.imagePassCalls} calls across ${stats.imagePassRuns} runs)`,
);
const missImg = [...missByCall.values()].filter((rs) => rs.every((r) => IMAGE_TOOLS.includes(r.logTool))).length;
console.log(
  `  MISSES (folded, collide only with log_entry_id blanked): ${missByCall.size} call(s), ${misses.length} op(s)` +
    ` — image pass (second reading, spared by design): ${missImg}; other log tool (re-run the guard misses): ${missByCall.size - missImg}` +
    ` — listed in section M`,
);
console.log("");
const noOutcomeCalls = [...byCall.values()].filter((rs) => rs[0].outcome === "none").length;
console.log(`CALLS THE GUARD WOULD REFUSE: ${byCall.size}  (${refusals.length} colliding op(s); ${noOutcomeCalls} of the calls have no recorded outcome)`);
const shares = [...byCall.values()].filter((rs) => rs.every((r) => r.sharesLog)).length;
console.log(`  refused calls sharing the collided assertions' log entry: ${shares} of ${byCall.size}`);
/** Did this refused call's copy actually persist? final-research.json holds
 *  at least (pre-call holders + this call's ops) under the key → yes (a real
 *  duplicate the guard would have stopped). Otherwise the simulated "success"
 *  of an outcome-less call never happened (a failed call retried) or a later
 *  update moved the key. */
function persisted(rs: Refusal[]): "yes" | "no" | "partly" {
  const y = rs.filter((r) => r.finalCount >= r.collided.length + r.sameKeyInCall).length;
  return y === rs.length ? "yes" : y === 0 ? "no" : "partly";
}
const cls = { yes: 0, no: 0, partly: 0 };
for (const rs of byCall.values()) cls[persisted(rs)]++;
console.log(
  `  duplicate persisted in final-research.json (final key count ≥ pre-call holders + this call's ops): yes ${cls.yes}, partly ${cls.partly}, no ${cls.no}`,
);
const recorded = [...byCall.values()].filter((rs) => rs[0].outcome !== "none");
console.log(`  refused calls with a RECORDED ok:true outcome: ${recorded.length}`);
const allIdentical = [...byCall.values()].filter((rs) => rs.every((r) => r.identicalValue)).length;
console.log(`  refused calls whose every colliding op repeats a collided value verbatim: ${allIdentical} of ${byCall.size}`);
console.log("");
const order = (rs: Refusal[]) => (rs[0].outcome !== "none" ? 0 : persisted(rs) === "yes" ? 1 : persisted(rs) === "partly" ? 2 : 3);
const sorted = [...byCall.entries()].sort((a, b) => order(a[1]) - order(b[1]));
let lastGroup = -1;
const groupTitle = [
  "== A. recorded outcome ok:true — the guard would refuse a call that really succeeded ==",
  "== B. no recorded outcome; duplicate PERSISTED in final-research.json ==",
  "== C. no recorded outcome; duplicate partly persisted ==",
  "== D. no recorded outcome; duplicate NOT in final-research.json (the earlier or this call failed and was retried, or the key was later updated away) ==",
];
function printCall(k: string, rs: Refusal[]): void {
  const r0 = rs[0];
  const collidedIds = [...new Set(rs.flatMap((r) => r.collided.map((c) => c.id)))];
  const collidedCalls = [...new Set(rs.flatMap((r) => r.collided.map((c) => c.call)))];
  const collidedLogs = [...new Set(rs.flatMap((r) => r.collided.map((c) => c.log)))];
  const collidedOutcomes = [...new Set(rs.flatMap((r) => r.collided.map((c) => c.outcome)))];
  const records = [...new Set(rs.map((r) => r.record))];
  const srcs = [...new Set(rs.map((r) => r.source))];
  const logs = [...new Set(rs.map((r) => r.log))];
  console.log(`- ${k}  ${r0.tool}${r0.agent ? ` [${r0.agent}]` : ""}  outcome=${r0.outcome}`);
  console.log(`    record ${records.join(", ")}  source ${srcs.join(", ")}  log ${logs.join(", ")} (log tool: ${[...new Set(rs.map((r) => r.logTool))].join(",")})`);
  console.log(`    ${rs.length} colliding op(s); collides with ${collidedIds.join(", ")} written by call(s) #${collidedCalls.join(", #")} (outcome ${collidedOutcomes.join("/")}) under ${collidedLogs.join(", ")}`);
  console.log(
    `    shares log entry with collided: ${rs.every((r) => r.sharesLog) ? "yes" : rs.some((r) => r.sharesLog) ? "partly" : "no"}` +
      `; persisted in final: ${persisted(rs)}; value identical to collided: ${rs.filter((r) => r.identicalValue).length}/${rs.length} op(s)`,
  );
  const shown = VERBOSE ? rs : rs.slice(0, 3);
  for (const r of shown) {
    console.log(`      op[${r.opIndex}] ${r.newId} ${r.who} ${r.factType} = ${r.newValue}  vs  ${r.collided.map((c) => c.id).join(",")} = ${r.collidedValues.join(" | ")}`);
  }
  if (!VERBOSE && rs.length > 3) console.log(`      … ${rs.length - 3} more (--verbose)`);
}
for (const [k, rs] of sorted) {
  if (order(rs) !== lastGroup) {
    lastGroup = order(rs);
    console.log("");
    console.log(groupTitle[lastGroup]);
  }
  printCall(k, rs);
}

console.log("");
console.log("== M. MISSES — folded calls colliding only with log_entry_id blanked (re-extraction under a NEW log entry) ==");
for (const [k, rs] of missByCall) {
  const img = rs.every((r) => IMAGE_TOOLS.includes(r.logTool));
  const collidedLogTools = [...new Set(rs.flatMap((r) => r.collided.map((c) => c.log)))];
  console.log(`  [${img ? "IMAGE PASS — second reading, correctly spared" : "NOT an image pass — a re-run the guard misses"}] collided log(s): ${collidedLogTools.join(", ")}`);
  printCall(k, rs);
}

console.log("");
console.log("== S. SPARED by the gate — ungated key hit, but no updated_existing fold (one line per call; first op shown) ==");
for (const [k, rs] of sparedByCall) {
  const r = rs[0];
  console.log(
    `- ${k} ${r.tool} outcome=${r.outcome} [${r.gateReason}] log ${r.log}(${r.logTool}) ${rs.length} op(s), verbatim ${rs.filter((x) => x.identicalValue).length}, persisted ${persisted(rs)}: ${r.who} ${r.factType} = ${r.newValue}  vs  ${r.collided.map((c) => `${c.id}@#${c.call}`).join(",")} = ${r.collidedValues.join(" | ")}`,
  );
}
