// The viewer's two tools and its page, shared by the tool server's connector path
// and the thin server under viewer/. Neither tool is in allToolSchemas: the worker,
// the `.mcpb`, the manifest and the hook maps must not know about them, so
// `createServer` adds them for a connector caller and every other surface gets
// `Unknown tool`.
import { basename } from "node:path";
import { ErrorCode, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "../types/auth.js";
import { readBundledText, viewerPagePath } from "../utils/bundled-data.js";
import { readExternalCollections } from "../utils/external-collections-store.js";
import { IMAGE_REF_PATTERN, processImageTokens } from "../utils/image-tokens.js";
import { classifyProjectPath, fileExists, readProjectJson } from "../utils/project-io.js";
import { webPublicBase } from "../utils/project-links.js";
import { awaitingUserHandOffs, type AwaitingHandOff } from "../utils/awaiting-hand-offs.js";
import { questionStates, type QuestionStatus } from "../utils/question-state.js";
import { readStartingTree } from "../utils/starting-tree.js";
import { treeDiff, type TreeDiffResult } from "./tree-diff.js";

export const SHOW_PROJECT = "show_project";
export const READ_PROJECT_VIEW = "read_project_view";
export const PAGE_URI = "ui://genealogy/viewer.html";
export const PAGE_MIME_TYPE = "text/html;profile=mcp-app";
export const PROJECT_META_KEY = "genealogy/project";
export const UI_EXTENSION = "io.modelcontextprotocol/ui";
export const DISPLAY_NAME = "Genealogy Viewer";
/** Past this a host drops `_meta` whole, project id included, so `show_project`
 *  leaves the documents out and keeps the rest. */
export const MAX_META_BYTES = 1_000_000;

/** Electron's LOG_ID_PATTERN. */
const LOG_ID_PATTERN = /^log_[a-zA-Z0-9_-]+$/;
const SHOW_VALUES = ["setup", "plan", "search", "link", "conflict", "hypothesis", "assess", "conclusion", "latest", "file"];
const PAGE_VALUES = ["case", "compare", "people", "sources", "log"];
const PART_VALUES = ["document", "results", "image"];
const ID_ARGS = ["questionId", "logId", "personId", "planItemId", "sourceId"];

function showProjectSchema(projectRule: string) {
  return {
    name: SHOW_PROJECT,
    title: "Show project",
    description:
      "Shows the researcher a card of this genealogy project in the conversation. The researcher sees the card, " +
      "so do not restate what it shows. `show` picks the card: a step (setup, plan, search, link, conflict, " +
      "hypothesis, assess, conclusion), `latest` for where the research stands, or `file` for the case file. " +
      `Project rule for projectPath: ${projectRule}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: { type: "string", description: projectRule },
        show: { type: "string", enum: SHOW_VALUES, description: "The card to show." },
        page: { type: "string", enum: PAGE_VALUES, description: "The case file page to open." },
        questionId: { type: "string", description: "The research question the card is about." },
        logId: { type: "string", description: "A search log entry to open." },
        personId: { type: "string", description: "A person to open." },
        planItemId: { type: "string", description: "A plan item to open." },
        sourceId: { type: "string", description: "A source to open." },
      },
      required: ["show"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    // Both keys, as ext-apps registerAppTool writes them: a host may read either.
    _meta: { ui: { resourceUri: PAGE_URI }, "ui/resourceUri": PAGE_URI },
  };
}

function readProjectViewSchema(projectRule: string) {
  return {
    name: READ_PROJECT_VIEW,
    title: "Read project view",
    description:
      "For the viewer page, not the model. Returns one part of the project: `document` (research, tree, starting " +
      "tree, collections), `results` (one results file, by log id) or `image` (a signed link to one page image, " +
      `by image ref). Project rule for projectPath: ${projectRule}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: { type: "string", description: projectRule },
        part: { type: "string", enum: PART_VALUES, description: "The part to read." },
        id: { type: "string", description: "`results`: a log id. `image`: an image ref (images/<name>.jpg)." },
      },
      required: ["part"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    _meta: { ui: { visibility: ["app"] } },
  };
}

/** Both tools, with `projectRule` saying how each server reads `projectPath`. */
export function projectViewToolSchemas(projectRule: string) {
  return [showProjectSchema(projectRule), readProjectViewSchema(projectRule)] as const;
}

const [SHOW_SHAPE, READ_SHAPE] = projectViewToolSchemas("");

export function isProjectViewTool(name: string): boolean {
  return name === SHOW_PROJECT || name === READ_PROJECT_VIEW;
}

export interface ProjectViewContext {
  /** The path the store reads for a call's projectPath. Throws a refusal a caller can read. */
  resolveProject(projectPath: unknown): Promise<string>;
  /** A signed link to one page image. Absent where no route can serve it. */
  signImage?: (projectPath: string, ref: string) => { url: string; expiresAt: number };
}

type Args = Record<string, unknown>;

export function refuseUnknownArgs(schema: { inputSchema: { properties: object } }, toolName: string, args: Args): void {
  const known = Object.keys(schema.inputSchema.properties);
  const unknown = Object.keys(args).filter((key) => !known.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${toolName} has no argument ${unknown.join(", ")}. It takes: ${known.join(", ")}.`);
  }
}

function requireOneOf(name: string, value: unknown, allowed: string[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}.`);
  }
}

/** Where gps-mentor writes a verdict body. Anything else is not read. */
const EVALUATION_REF = /^evaluations\/[A-Za-z0-9._-]+\.json$/;

export interface DerivedEvaluation {
  body: unknown;
  /** A craft read says how the proof reads, not whether the evidence holds. */
  craft: boolean;
}

export interface Derived {
  folderName: string;
  questions: QuestionStatus[] | null;
  awaitingUser: AwaitingHandOff[] | null;
  treeChanges: TreeDiffResult | null;
  evaluations: Record<string, DerivedEvaluation>;
}

function softly<T>(compute: () => T): T | null {
  try {
    return compute();
  } catch {
    return null;
  }
}

function liveEvaluations(research: any): any[] {
  const all = Array.isArray(research?.evaluations) ? research.evaluations : [];
  return all.filter((e: any) => typeof e?.id === "string" && e.superseded_by == null);
}

/** What only the engine can compute, from documents already read. A field that
 *  throws on a malformed document is null, so the card still draws. */
export function deriveProject(input: {
  folderName: string;
  research: any;
  tree: any;
  startingTree: any;
  evaluationBodies: Record<string, unknown>;
}): Derived {
  const { research, tree, startingTree } = input;
  const evaluations: Record<string, DerivedEvaluation> = {};
  for (const entry of liveEvaluations(research)) {
    const body = input.evaluationBodies[entry.id] ?? null;
    evaluations[entry.id] = { body, craft: (body as { craft?: unknown } | null)?.craft === true };
  }
  return {
    folderName: input.folderName,
    questions: softly(() => questionStates(research, tree)),
    awaitingUser: softly(() => awaitingUserHandOffs(research?.log)),
    treeChanges: startingTree ? softly(() => treeDiff({ before: startingTree, after: tree ?? undefined })) : null,
    evaluations,
  };
}

/** Each live evaluation's body by id; one that cannot be read is left out. */
async function readEvaluationBodies(projectPath: string, research: any): Promise<Record<string, unknown>> {
  const bodies: Record<string, unknown> = {};
  for (const entry of liveEvaluations(research)) {
    if (typeof entry.file_path !== "string" || !EVALUATION_REF.test(entry.file_path)) continue;
    try {
      bodies[entry.id] = await readProjectJson(projectPath, entry.file_path);
    } catch {
      // gps-mentor counts an unreadable body as not craft; so does the card.
    }
  }
  return bodies;
}

/** Every document the page reads, with null for a file the project does not have. */
async function readDocument(projectPath: string) {
  const research = await readProjectJson(projectPath, "research.json");
  const tree = (await fileExists(projectPath, "tree.gedcomx.json")) ? await readProjectJson(projectPath, "tree.gedcomx.json") : null;
  const startingTree = await readStartingTree(projectPath);
  return {
    research,
    tree,
    startingTree,
    // Background reading only, so a bad file must not cost the researcher the card.
    collections: await readExternalCollections(projectPath).catch(() => null),
    derived: deriveProject({
      folderName: basename(projectPath),
      research,
      tree,
      startingTree,
      evaluationBodies: await readEvaluationBodies(projectPath, research),
    }),
  };
}

async function showProject(context: ProjectViewContext, args: Args): Promise<CallToolResult> {
  refuseUnknownArgs(SHOW_SHAPE, SHOW_PROJECT, args);
  requireOneOf("show", args.show, SHOW_VALUES);
  if (args.page !== undefined) requireOneOf("page", args.page, PAGE_VALUES);
  for (const name of ID_ARGS) {
    if (args[name] !== undefined && typeof args[name] !== "string") throw new Error(`${name} must be a string.`);
  }
  const document = await readDocument(await context.resolveProject(args.projectPath));
  const meta = { ...document, echo: args };
  const fits = Buffer.byteLength(JSON.stringify(meta), "utf8") <= MAX_META_BYTES;
  return {
    content: [{ type: "text", text: `The researcher sees the ${args.show} card; do not restate it.` }],
    _meta: { [PROJECT_META_KEY]: fits ? meta : { derived: document.derived, echo: args } },
  };
}

async function readResults(projectPath: string, id: string) {
  const ref = `results/${id}.json`;
  if (!(await fileExists(projectPath, ref))) return { found: false };
  return { found: true, results: await readProjectJson(projectPath, ref) };
}

async function readProjectView(context: ProjectViewContext, args: Args): Promise<CallToolResult> {
  refuseUnknownArgs(READ_SHAPE, READ_PROJECT_VIEW, args);
  requireOneOf("part", args.part, PART_VALUES);
  const { id, part } = args;
  if (part === "results" && !(typeof id === "string" && LOG_ID_PATTERN.test(id))) {
    throw new Error("With part results, id must be a log id such as log_001.");
  }
  // Before any signing: the store's readBytes can read documents, so this check
  // is what keeps a token to images.
  if (part === "image") {
    if (!(typeof id === "string" && IMAGE_REF_PATTERN.test(id))) {
      throw new Error("With part image, id must be an image ref such as images/page.jpg.");
    }
    if (!context.signImage) throw new Error("This server has no route to page images.");
  }
  const projectPath = await context.resolveProject(args.projectPath);
  const structuredContent =
    part === "document"
      ? await readDocument(projectPath)
      : part === "results"
        ? await readResults(projectPath, id as string)
        : context.signImage!(projectPath, id as string);
  return { content: [{ type: "text", text: "ok" }], structuredContent };
}

/** One of the two tools. A refusal is a throw; each server turns it into a plain
 *  text `isError` result, because a card shows it. */
export async function callProjectView(context: ProjectViewContext, name: string, args: Args): Promise<CallToolResult> {
  if (name === SHOW_PROJECT) return showProject(context, args);
  if (name === READ_PROJECT_VIEW) return readProjectView(context, args);
  throw new Error(`Unknown tool: ${name}`);
}

export function pageResourceList() {
  return { resources: [{ uri: PAGE_URI, name: DISPLAY_NAME, mimeType: PAGE_MIME_TYPE }] };
}

export function requirePageUri(uri: string): void {
  if (uri !== PAGE_URI) throw new McpError(ErrorCode.InvalidParams, "Unknown resource.");
}

export function pageResourceRead(html: string, publicOrigin?: string) {
  return {
    contents: [
      {
        uri: PAGE_URI,
        mimeType: PAGE_MIME_TYPE,
        text: html,
        _meta: { ui: { csp: { resourceDomains: publicOrigin ? [publicOrigin] : [] } } },
      },
    ],
  };
}

/** What a card says when the store fails. */
export const VIEW_UNAVAILABLE = "The project could not be read just now. Try again.";

/** A failed call as the connector answers it. A refusal is a plain Error, and its
 *  text is written for the card. A store failure carries a string `code`, and its
 *  message can name a host or a role, so the card gets a fixed sentence and the log
 *  gets the label. */
export function connectorViewFailure(error: unknown): CallToolResult {
  const { code } = error as { code?: unknown };
  if (typeof code === "string") {
    process.stderr.write(`ev=view_failed error=${code}\n`);
    return { content: [{ type: "text", text: VIEW_UNAVAILABLE }], isError: true };
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return { content: [{ type: "text", text: message }], isError: true };
}

const CONNECTOR_PROJECT_RULE = "A project's /proj_<16 hex> projectPath, from project_list. A call that names none is refused.";
const PICK_FROM_PROJECT_LIST = "Call project_list and pass one of its projectPath values.";

export const connectorProjectViewSchemas = projectViewToolSchemas(CONNECTOR_PROJECT_RULE);

/** The two tools as the connector door runs them. The door has already checked
 *  the path's shape and its owner, and bound the store to it. */
export function connectorProjectView(config: AppConfig): ProjectViewContext {
  const origin = webPublicBase(config);
  return {
    async resolveProject(projectPath) {
      if (projectPath === undefined) throw new Error(`This call named no project. ${PICK_FROM_PROJECT_LIST}`);
      if ((await classifyProjectPath(projectPath)) !== "project") {
        throw new Error(`No project is saved at this projectPath. ${PICK_FROM_PROJECT_LIST}`);
      }
      return projectPath as string;
    },
    ...(origin === ""
      ? {}
      : {
          // In the query, not the path: the edge logs `$uri`, and no line there may
          // carry a live link.
          signImage: (projectPath: string, ref: string) => {
            const { token, expiresAt } = processImageTokens.sign(projectPath.slice(1), ref);
            return { url: `${origin}/img?t=${token}`, expiresAt };
          },
        }),
  };
}

/** `resources/read` on the connector. Read here, not at start-up: the `.mcpb` and
 *  the Beanstalk bundle carry no page, and that must cost a request, not the server. */
export function connectorPageRead(uri: string, config: AppConfig) {
  requirePageUri(uri);
  let html: string;
  try {
    html = readBundledText(viewerPagePath());
  } catch {
    throw new McpError(ErrorCode.InternalError, "The viewer page is not installed on this server.");
  }
  return pageResourceRead(html, webPublicBase(config));
}
