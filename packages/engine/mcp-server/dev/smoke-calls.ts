/**
 * smoke-calls — the ONE per-tool call plan behind both transport smokes
 * (`dev/smoke-http.ts` runs every advertised tool minus the four named auth
 * exclusions over Streamable HTTP; `dev/smoke-stdio.ts` runs the `offline`
 * subset over stdio). Minimal valid args, fixture order, and the expected
 * outcome per mode, per PLAN.md decision 5.
 *
 * Modes: `no-bearer` (default) — every FamilySearch-token tool must answer
 * `isError` carrying HOSTED_REAUTH_INSTRUCTION, which is what proves the
 * per-request principal reached it; `bearer` — those tools must succeed.
 *
 * `assertCoverage` is the completeness guard: every advertised tool is either a
 * step in this plan or a named exclusion, and every named exclusion is advertised.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, posix } from "node:path";
import {
  HOSTED_REAUTH_INSTRUCTION,
  OPENROUTER_API_KEY_MISSING_MESSAGE,
} from "../src/auth/config.js";

export type SmokeMode = "no-bearer" | "bearer";

/** The four auth tools the transport smoke never calls, each with its reason. */
export const EXCLUDED_TOOLS: Readonly<Record<string, string>> = {
  login: "every HTTP request is a bearer principal, so isHostedMode is true: answers HOSTED_REAUTH_INSTRUCTION without touching tokens.json",
  logout: "a bearer principal has no token file: answers HOSTED_SESSION_MANAGED_MESSAGE without touching tokens.json",
  configure_openrouter: "saveConfig throws HOSTED_CONFIG_READ_ONLY_MESSAGE for a bearer before any file write",
  auth_status: "answers {loggedIn: token.length > 0} from the bearer alone, but is excluded with the other auth tools",
};

export interface CallResult {
  isError: boolean;
  /** Parsed JSON of the text content, or `{ raw }` when it is not JSON. */
  body: any;
  text: string;
}

export type CallFn = (tool: string, args: Record<string, unknown>) => Promise<CallResult>;

export interface SmokeCtx {
  mode: SmokeMode;
  /** The project directory as the SERVER sees it. */
  projectPath: string;
  /** Same directory on THIS host when the smoke can write fixtures into it; null for a server-side anchor. */
  hostProjectDir: string | null;
  /** A path under projectPath that holds no project. */
  missingProjectPath: string;
  /** Whether the server's base config carries `openRouterApiKey`. */
  openRouterKeyConfigured: boolean;
  /** Values read back from earlier steps (e.g. the evaluations sidecar `file_path`). */
  values: Record<string, unknown>;
}

export interface Expectation {
  ok: boolean;
  detail: string;
}

export interface SmokeStep {
  tool: string;
  /** Printed instead of `tool` when one tool appears more than once. */
  label?: string;
  /** Runnable with no network and no credentials (the stdio smoke's subset). */
  offline?: boolean;
  args: (ctx: SmokeCtx) => Record<string, unknown>;
  /** Host-side fixture write before the call; skipped when `hostProjectDir` is null. */
  before?: (ctx: SmokeCtx) => Promise<void>;
  expect: (res: CallResult, ctx: SmokeCtx) => Expectation;
  /** Capture values for later steps. */
  after?: (res: CallResult, ctx: SmokeCtx) => void;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REAL_IMAGE_ID = "004884748_02613";
const FS_PID = "KNDX-MKG";
const STAGED_REF = "results/.staging/smoke.json";

const SEED_TREE = {
  persons: [
    {
      id: "P1",
      gender: "Male",
      names: [{ id: "N1", preferred: true, given: "Smoke", surname: "Person", type: "BirthName" }],
      facts: [{ id: "F1", type: "Birth", primary: true, date: "1850" }],
    },
    {
      id: "P2",
      gender: "Male",
      names: [{ id: "N2", preferred: true, given: "Smoke", surname: "Duplicate", type: "BirthName" }],
      facts: [{ id: "F2", type: "Birth", primary: true, date: "1852" }],
    },
  ],
  relationships: [],
  sources: [],
};

const CANDIDATE_GEDCOMX = {
  persons: [
    {
      id: "C1",
      gender: "Male",
      names: [{ id: "N1", preferred: true, given: "Smoke", surname: "Person", type: "BirthName" }],
      facts: [{ id: "F1", type: "Birth", primary: true, date: "1850" }],
    },
  ],
  relationships: [],
  sources: [],
};

// ─── Expectation helpers ─────────────────────────────────────────────────────

function brief(res: CallResult, n = 160): string {
  return (res.body?.raw !== undefined ? res.text : JSON.stringify(res.body)).slice(0, n);
}

/** True when `msg` appears in the result's error text (raw or JSON-escaped). */
function carries(res: CallResult, msg: string): boolean {
  const b = res.body ?? {};
  const parts = [b.error, b.message, b.reason, ...(Array.isArray(b.errors) ? b.errors : [])]
    .filter((v): v is string => typeof v === "string");
  return parts.some((p) => p.includes(msg)) || res.text.includes(JSON.stringify(msg).slice(1, -1));
}

const noError = (res: CallResult): Expectation => ({ ok: !res.isError, detail: brief(res) });

const okTrue = (res: CallResult): Expectation => ({
  ok: !res.isError && res.body?.ok === true,
  detail: brief(res),
});

const validTrue = (res: CallResult): Expectation => ({
  ok: !res.isError && res.body?.valid === true,
  detail: brief(res),
});

function reauth(res: CallResult, ctx: SmokeCtx): Expectation {
  if (ctx.mode === "bearer") return noError(res);
  const ok = res.isError && carries(res, HOSTED_REAUTH_INSTRUCTION);
  return { ok, detail: ok ? "isError with HOSTED_REAUTH_INSTRUCTION" : brief(res) };
}

function keyMissing(res: CallResult): Expectation {
  const ok = res.isError && carries(res, OPENROUTER_API_KEY_MISSING_MESSAGE);
  return { ok, detail: ok ? "isError with OPENROUTER_API_KEY_MISSING_MESSAGE" : brief(res) };
}

// ─── The plan ────────────────────────────────────────────────────────────────

const tokenStep = (tool: string, args: Record<string, unknown>): SmokeStep => ({
  tool,
  args: () => args,
  expect: reauth,
});

export const CALL_PLAN: readonly SmokeStep[] = [
  // Project tools, in fixture order against a fresh project.
  {
    tool: "project_create",
    offline: true,
    args: (ctx) => ({
      projectPath: ctx.projectPath,
      objective: "Does this transport reach every tool?",
      title: "smoke",
      subjectPersonIds: ["P1"],
      tree: SEED_TREE,
    }),
    expect: (res) => ({
      ok: !res.isError && res.body?.ok === true,
      detail: res.body?.ok === true ? `wrote ${res.body.filesWritten.join(", ")}` : brief(res, 300),
    }),
  },
  {
    tool: "validate_research_schema",
    offline: true,
    args: (ctx) => ({ projectPath: ctx.projectPath }),
    expect: validTrue,
  },
  {
    tool: "project_context",
    offline: true,
    args: (ctx) => ({ projectPath: ctx.projectPath }),
    expect: noError,
  },
  {
    tool: "research_query",
    label: "research_query (log)",
    offline: true,
    args: (ctx) => ({ projectPath: ctx.projectPath, section: "log" }),
    expect: noError,
  },
  {
    tool: "research_log_append",
    offline: true,
    args: (ctx) => ({
      projectPath: ctx.projectPath,
      tool: "record_search",
      query: { givenName: "Smoke" },
      outcome: "negative",
      resultsExamined: 0,
      resultsAvailable: 0,
    }),
    expect: okTrue,
  },
  {
    tool: "extraction_append",
    offline: true,
    args: (ctx) => ({
      projectPath: ctx.projectPath,
      sourceDescription: { title: "Smoke source" },
      resolveStandardPlace: false,
      ops: [
        {
          section: "sources",
          op: "append",
          entry: {
            citation: "Smoke source",
            citation_detail: {
              who: "Smoke",
              what: "transport smoke",
              when_created: "1850",
              when_accessed: "2026-01-01",
              where: "Nowhere",
              where_within: "line 1",
            },
            source_classification: "original",
            repository: "smoke",
            access_date: "2026-01-01",
          },
        },
        {
          section: "assertions",
          op: "append",
          entry: {
            record_id: "SMOKE-1",
            record_role: "principal",
            fact_type: "birth",
            value: "1850",
            date: "1850",
            information_quality: "primary",
            informant: "self",
            informant_proximity: "self",
            record_basis: "stated",
            extracted_for_question_ids: [],
          },
        },
      ],
    }),
    expect: okTrue,
  },
  {
    tool: "materialize_facts",
    offline: true,
    args: (ctx) => ({
      projectPath: ctx.projectPath,
      personId: "P1",
      recordId: "SMOKE-1",
      recordRole: "principal",
    }),
    expect: okTrue,
  },
  {
    tool: "research_append",
    label: "research_append (hypotheses)",
    offline: true,
    args: (ctx) => ({
      projectPath: ctx.projectPath,
      section: "hypotheses",
      op: "append",
      entry: {
        claim: "P1 is the SMOKE-1 principal",
        status: "active",
        supporting_assertion_ids: [],
        contradicting_assertion_ids: [],
        ruled_out: false,
        related_question_ids: [],
      },
    }),
    expect: okTrue,
  },
  {
    tool: "research_append",
    label: "research_append (evaluations + verdict)",
    offline: true,
    args: (ctx) => ({
      projectPath: ctx.projectPath,
      section: "evaluations",
      op: "append",
      entry: {
        focus: "on-demand",
        target_id: "project",
        target_type: "project",
        verdict: "looks_solid",
        superseded_by: null,
      },
      verdict: { summary: "transport smoke" },
    }),
    expect: okTrue,
  },
  {
    tool: "research_query",
    label: "research_query (evaluations)",
    offline: true,
    args: (ctx) => ({ projectPath: ctx.projectPath, section: "evaluations" }),
    expect: (res) => {
      const fp = res.body?.items?.[0]?.file_path;
      return { ok: !res.isError && typeof fp === "string", detail: `file_path=${fp}` };
    },
    after: (res, ctx) => {
      ctx.values.evaluationFilePath = res.body?.items?.[0]?.file_path;
    },
  },
  {
    tool: "sidecar_read",
    offline: true,
    args: (ctx) => ({ projectPath: ctx.projectPath, ref: String(ctx.values.evaluationFilePath ?? "") }),
    expect: okTrue,
  },
  {
    tool: "tree_edit",
    offline: true,
    args: (ctx) => ({
      projectPath: ctx.projectPath,
      operation: "add_name",
      personId: "P1",
      name: { given: "Smokey", surname: "Person", type: "AlsoKnownAs" },
    }),
    expect: okTrue,
  },
  {
    tool: "tree_correct",
    offline: true,
    args: (ctx) => ({
      projectPath: ctx.projectPath,
      operation: "update_person",
      personId: "P1",
      gender: "Female",
    }),
    expect: okTrue,
  },
  {
    tool: "person_warnings",
    offline: true,
    args: (ctx) => ({ projectPath: ctx.projectPath, personId: "P1" }),
    expect: noError,
  },
  {
    // Live mode, and the ONLY check that the schema still accepts a call with
    // no projectPath. `required` is ["personId"] alone because projectPath is
    // conditionally required, which an input schema cannot express — so if it
    // were re-added, the client would reject this before the tool ran and no
    // vitest file would notice. A schema rejection does not carry
    // HOSTED_REAUTH_INSTRUCTION, so `reauth` fails on it rather than passing.
    // Not `offline`: live mode fetches the person from FamilySearch.
    tool: "person_warnings",
    label: "person_warnings live",
    args: () => ({ personId: "KD96-TV2", live: true }),
    expect: reauth,
  },
  {
    tool: "merge_warnings",
    offline: true,
    args: (ctx) => ({
      projectPath: ctx.projectPath,
      candidateGedcomx: CANDIDATE_GEDCOMX,
      merges: [["P1", "C1"]],
    }),
    // ok:false is its verdict about the merge, not a failure; only isError fails.
    expect: noError,
  },
  {
    // Reads the staged sidecar BEFORE the token: with a host project dir the
    // smoke stages one so the call reaches getValidToken; against a server-side
    // anchor it cannot, so the missing-ref error is the achievable assertion.
    tool: "rank_search_matches",
    args: (ctx) => ({ projectPath: ctx.projectPath, stagedResultsRef: STAGED_REF, subjectId: "P1" }),
    before: async (ctx) => {
      if (!ctx.hostProjectDir) return;
      const file = join(ctx.hostProjectDir, ...STAGED_REF.split("/"));
      await mkdir(join(file, ".."), { recursive: true });
      await writeFile(file, JSON.stringify({ payload: { results: [{}] } }), "utf-8");
    },
    expect: (res, ctx) => {
      if (!ctx.hostProjectDir) {
        const ok = res.isError && carries(res, "does not exist or is invalid JSON");
        return { ok, detail: ok ? "no host fixtures: missing staged ref refused" : brief(res) };
      }
      if (ctx.mode === "bearer") {
        return { ok: !res.isError && res.body?.scoredCount === 0, detail: brief(res) };
      }
      return reauth(res, ctx);
    },
  },
  {
    tool: "merge_tree_persons",
    offline: true,
    args: (ctx) => ({ projectPath: ctx.projectPath, merges: [["P1", "P2"]] }),
    expect: okTrue,
  },
  {
    tool: "tree_forget",
    label: "tree_forget (dry run)",
    offline: true,
    args: (ctx) => ({
      projectPath: ctx.projectPath,
      forget: [{ selector: "fact", personId: "P1", factId: "F1" }],
      dryRun: true,
    }),
    expect: okTrue,
  },
  {
    tool: "validate_research_schema",
    label: "validate_research_schema (after writes)",
    offline: true,
    args: (ctx) => ({ projectPath: ctx.projectPath }),
    expect: validTrue,
  },
  {
    tool: "project_context",
    label: "project_context on a missing dir",
    offline: true,
    args: (ctx) => ({ projectPath: ctx.missingProjectPath }),
    expect: (res) => ({ ok: res.isError || res.body?.ok === false, detail: brief(res) }),
  },

  // Offline tools.
  {
    tool: "convert_calendar",
    offline: true,
    args: () => ({ date: { year: 1750, month: 2, day: 10 }, corrections: { osNsYear: true } }),
    expect: okTrue,
  },
  {
    tool: "build_external_search_url",
    offline: true,
    args: () => ({ site: "findagrave", attributes: { surname: "Smoke" } }),
    expect: okTrue,
  },

  // FamilySearch-token tools: each reaches getValidToken after synchronous
  // arg validation and before any I/O.
  tokenStep("record_search", { surname: "Smoke" }),
  tokenStep("person_search", { surname: "Smoke", givenName: "Test" }),
  // `relatives` on purpose: without it the smoke never touches the sibling
  // fan-out, so the only advertised path with a second wave of requests goes
  // uncovered. Breaks no rule either way -- the harness asks only that each
  // advertised tool be called -- but one argument buys the coverage (#2593).
  tokenStep("person_read", { personId: FS_PID, relatives: true }),
  tokenStep("person_ancestors", { personId: FS_PID }),
  tokenStep("record_read", { recordId: "QVS9-DHDB" }),
  tokenStep("fulltext_search", { keywords: "smoke" }),
  tokenStep("collections_search", { standardPlace: "England" }),
  tokenStep("collection_read", { id: "1743384" }),
  tokenStep("source_attachments", { uris: ["ark:/61903/1:1:QVS9-DHDB"] }),
  tokenStep("image_search", { imageGroupNumber: "004884748" }),
  tokenStep("volume_search", { standardPlace: "England" }),
  tokenStep("same_person", {
    gedcomx1: { persons: [{ id: "A" }] },
    primaryId1: "A",
    gedcomx2: { persons: [{ id: "B" }] },
    primaryId2: "B",
  }),
  tokenStep("person_record_matches", { id: FS_PID }),
  tokenStep("record_person_matches", { id: FS_PID }),
  tokenStep("person_person_matches", { id: FS_PID }),
  tokenStep("record_record_matches", { id: FS_PID }),
  {
    // Beta host: with a bearer, accept success or an explicit upstream error.
    tool: "person_quality",
    args: () => ({ personId: FS_PID }),
    expect: (res, ctx) => {
      if (ctx.mode === "no-bearer") return reauth(res, ctx);
      const ok = !res.isError || (!carries(res, HOSTED_REAUTH_INSTRUCTION) && !carries(res, "Call the login tool"));
      return { ok, detail: brief(res) };
    },
  },
  tokenStep("image_read", { imageId: REAL_IMAGE_ID }),
  {
    // getOpenRouterApiKey runs before the FamilySearch fetch.
    tool: "image_transcribe",
    args: () => ({ imageId: REAL_IMAGE_ID }),
    expect: (res, ctx) => {
      if (!ctx.openRouterKeyConfigured) return keyMissing(res);
      return reauth(res, ctx);
    },
  },

  // Public-network tools: no token, must succeed.
  { tool: "wikipedia_search", args: () => ({ query: "Genealogy" }), expect: noError },
  { tool: "wiki_search", args: () => ({ query: "parish registers" }), expect: noError },
  {
    tool: "wiki_read",
    args: () => ({ url: "https://www.familysearch.org/en/wiki/England_Genealogy" }),
    expect: noError,
  },
  { tool: "wiki_place_page", args: () => ({ standardPlace: "England", section: "home" }), expect: noError },
  // Two hits: placeSearch fans out one getPlaceById per hit, and a 92-hit name
  // ("London") trips undici's connect timeout behind a container NAT.
  { tool: "place_search", args: () => ({ placeName: "Orwigsburg" }), expect: noError },
  { tool: "place_search_all", args: () => ({ placeName: "Orwigsburg" }), expect: noError },
  {
    tool: "place_distance",
    args: () => ({ standardPlace1: "London, England", standardPlace2: "York, England" }),
    expect: noError,
  },
  {
    // Pop Stats answers `{ error: "Place not found" }` as a normal result for
    // places it lacks (England among them), so require a population body.
    tool: "place_population",
    args: () => ({ standardPlace: "Pennsylvania, United States" }),
    expect: (res) => ({ ok: !res.isError && res.body?.error === undefined && !!res.body?.population, detail: brief(res) }),
  },
  { tool: "external_links_search", args: () => ({ standardPlace: "England" }), expect: noError },
];

// ─── Completeness guard ──────────────────────────────────────────────────────

/** Every advertised tool is a step or a named exclusion; every exclusion is advertised. */
export function assertCoverage(advertisedNames: readonly string[]): string[] {
  const advertised = new Set(advertisedNames);
  const planned = new Set(CALL_PLAN.map((s) => s.tool));
  const excluded = new Set(Object.keys(EXCLUDED_TOOLS));
  const problems: string[] = [];
  for (const name of advertised) {
    if (!planned.has(name) && !excluded.has(name)) {
      problems.push(`advertised tool '${name}' is neither called by the plan nor a named exclusion`);
    }
  }
  for (const name of excluded) {
    if (!advertised.has(name)) problems.push(`excluded tool '${name}' is not advertised`);
    if (planned.has(name)) problems.push(`excluded tool '${name}' is also a step in the plan`);
  }
  for (const name of planned) {
    if (!advertised.has(name)) problems.push(`plan step '${name}' names a tool that is not advertised`);
  }
  return problems;
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export interface RunPlanOptions {
  /** Run only the steps flagged `offline` (the stdio smoke). */
  offlineOnly?: boolean;
}

export interface RunPlanResult {
  calls: number;
  failures: string[];
}

/** Execute the plan in order, one report line per call; returns the failing labels. */
export async function runPlan(call: CallFn, ctx: SmokeCtx, opts: RunPlanOptions = {}): Promise<RunPlanResult> {
  const steps = opts.offlineOnly ? CALL_PLAN.filter((s) => s.offline) : CALL_PLAN;
  const failures: string[] = [];
  for (const step of steps) {
    const label = step.label ?? step.tool;
    let verdict: Expectation;
    try {
      if (step.before) await step.before(ctx);
      const res = await call(step.tool, step.args(ctx));
      verdict = step.expect(res, ctx);
      step.after?.(res, ctx);
    } catch (error) {
      verdict = { ok: false, detail: `threw: ${error instanceof Error ? error.message : String(error)}` };
    }
    report(label, verdict.ok, verdict.detail);
    if (!verdict.ok) failures.push(label);
  }
  return { calls: steps.length, failures };
}

export function report(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
}

/** Header both smokes print before the first call. */
export function printHeader(smoke: string, ctx: SmokeCtx, extra: string[] = []): void {
  console.log(`${smoke}: mode=${ctx.mode} project=${ctx.projectPath} (${ctx.hostProjectDir ? "host fixtures" : "no host fixtures"})${extra.length ? " " + extra.join(" ") : ""}`);
  console.log(`excluded (${Object.keys(EXCLUDED_TOOLS).length}):`);
  for (const [name, reason] of Object.entries(EXCLUDED_TOOLS)) console.log(`  ${name} — ${reason}`);
}

/** Call a tool through an SDK client and flatten its text content. */
export async function callViaClient(
  client: Client,
  tool: string,
  args: Record<string, unknown>,
): Promise<CallResult> {
  const res = await client.callTool({ name: tool, arguments: args });
  const text = (res.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { isError: res.isError === true, body, text };
}

// ─── Environment ─────────────────────────────────────────────────────────────

export interface PreparedProject {
  projectPath: string;
  hostProjectDir: string | null;
  missingProjectPath: string;
  /** Remove the host directory this call created. */
  cleanup: () => Promise<void>;
}

/**
 * A fresh mkdtemp in the OS temp dir, for a server whose file backend is THIS
 * host's filesystem (build/index.js over stdio). Removed by `cleanup`.
 */
export async function prepareProject(): Promise<PreparedProject> {
  const dir = await mkdtemp(join(tmpdir(), "smoke-"));
  return {
    projectPath: dir,
    hostProjectDir: dir,
    missingProjectPath: join(dir, "nope"),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * The server's own anchor path, passed verbatim as every call's projectPath
 * (`/project` for a PgS3ProjectStore). Nothing exists on this host, so no
 * fixture can be written and there is nothing to clean up.
 */
export function anchoredProject(projectPath: string): PreparedProject {
  return {
    projectPath,
    hostProjectDir: null,
    missingProjectPath: posix.join(projectPath, "nope"),
    cleanup: async () => {},
  };
}

const HOST_CONFIG_DIR = join(homedir(), ".familysearch-mcp");

async function readHostJson(name: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(join(HOST_CONFIG_DIR, name), "utf-8"));
  } catch {
    return null;
  }
}

/** `--bearer` when given, else the host's unexpired access token, else null. */
export async function detectBearer(explicit?: string): Promise<string | null> {
  if (explicit) return explicit;
  const tokens = await readHostJson("tokens.json");
  if (tokens && typeof tokens.accessToken === "string" && tokens.accessToken && Number(tokens.expiresAt) > Date.now()) {
    return tokens.accessToken;
  }
  return null;
}

/**
 * Whether the server's base config carries an OpenRouter key. `hostConfig` says
 * the server reads THIS host's ~/.familysearch-mcp/config.json; otherwise
 * (the compose service, whose config.json is `{"hosted": true}`) false.
 */
export async function hostOpenRouterKeyConfigured(hostConfig: boolean): Promise<boolean> {
  if (!hostConfig) return false;
  const config = await readHostJson("config.json");
  return typeof config?.openRouterApiKey === "string" && config.openRouterApiKey.length > 0;
}
