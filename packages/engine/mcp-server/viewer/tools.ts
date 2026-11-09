// The viewer's two tools. They live here rather than in src/tools/ because the
// main server's tool list, manifest and hook maps must not know about them.
import { basename } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readExternalCollections } from "../src/utils/external-collections-store.js";
import { fileExists, readProjectJson } from "../src/utils/project-io.js";
import { readStartingTree } from "../src/utils/starting-tree.js";
import { resolveProject, type ProjectRef } from "./project.js";
import { IMAGE_REF_PATTERN } from "./tokens.js";

export const SHOW_PROJECT = "show_project";
export const READ_PROJECT_VIEW = "read_project_view";
export const PAGE_URI = "ui://genealogy/viewer.html";
export const PROJECT_META_KEY = "genealogy/project";

// M0 asks the model to quote each of these, to learn which channel reaches it.
export const CONTENT_CANARY = "CANARY-CONTENT-K7Q2";
export const META_CANARY = "CANARY-META-M4X9";
export const STRUCTURED_CANARY = "CANARY-STRUCTURED-Z8R1";

/** Electron's LOG_ID_PATTERN. */
const LOG_ID_PATTERN = /^log_[a-zA-Z0-9_-]+$/;
const MAX_PAD = 8_000_000;
const SHOW_VALUES = ["setup", "plan", "search", "link", "conflict", "hypothesis", "assess", "conclusion", "latest", "file"];
const PAGE_VALUES = ["case", "compare", "people", "sources", "log"];
const PART_VALUES = ["document", "results", "image"];
const ID_ARGS = ["questionId", "logId", "personId", "planItemId", "sourceId"];

const PROJECT_RULE =
  "Optional. An absolute path is used as given, and must be inside the viewer's root. A bare folder name is a " +
  "folder under the root. Omitted, the root itself is the project if it holds research.json; otherwise the call " +
  "is refused with the list of project folders under the root.";

const PAD_PROPERTY = {
  type: "integer",
  minimum: 0,
  maximum: MAX_PAD,
  description: "Probe only: adds a string of this many characters to the result, to measure the size limit.",
};

export const toolSchemas = [
  {
    name: SHOW_PROJECT,
    title: "Show project",
    description:
      "Shows the researcher a card of this genealogy project in the conversation. The researcher sees the card, " +
      "so do not restate what it shows. `show` picks the card: a step (setup, plan, search, link, conflict, " +
      "hypothesis, assess, conclusion), `latest` for where the research stands, or `file` for the case file. " +
      `Project rule for projectPath: ${PROJECT_RULE}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: { type: "string", description: PROJECT_RULE },
        show: { type: "string", enum: SHOW_VALUES, description: "The card to show." },
        page: { type: "string", enum: PAGE_VALUES, description: "The case file page to open." },
        questionId: { type: "string", description: "The research question the card is about." },
        logId: { type: "string", description: "A search log entry to open." },
        personId: { type: "string", description: "A person to open." },
        planItemId: { type: "string", description: "A plan item to open." },
        sourceId: { type: "string", description: "A source to open." },
        pad: PAD_PROPERTY,
        structuredCanary: {
          type: "boolean",
          description: "Probe only: also returns structuredContent, to see what reaches the model.",
        },
      },
      required: ["show"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    // Both keys, as ext-apps registerAppTool writes them: a host may read either.
    _meta: { ui: { resourceUri: PAGE_URI }, "ui/resourceUri": PAGE_URI },
  },
  {
    name: READ_PROJECT_VIEW,
    title: "Read project view",
    description:
      "For the viewer page, not the model. Returns one part of the project: `document` (research, tree, starting " +
      "tree, collections), `results` (one results file, by log id) or `image` (a signed link to one page image, " +
      `by image ref). Project rule for projectPath: ${PROJECT_RULE}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: { type: "string", description: PROJECT_RULE },
        part: { type: "string", enum: PART_VALUES, description: "The part to read." },
        id: { type: "string", description: "`results`: a log id. `image`: an image ref (images/<name>.jpg)." },
        pad: { ...PAD_PROPERTY, description: `${PAD_PROPERTY.description} Only with part \`document\`.` },
      },
      required: ["part"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    _meta: { ui: { visibility: ["app"] } },
  },
];

export interface ToolContext {
  rootReal: string;
  /** A signed link to one page image. Absent on stdio, which has no route to serve it. */
  signImage?: (project: ProjectRef, ref: string) => { url: string; expiresAt: number };
}

type Args = Record<string, unknown>;

function refuseUnknownArgs(toolName: string, args: Args): void {
  const schema = toolSchemas.find((tool) => tool.name === toolName);
  const known = Object.keys(schema?.inputSchema.properties ?? {});
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

function padOf(args: Args): number | undefined {
  const { pad } = args;
  if (pad === undefined) return undefined;
  if (!Number.isInteger(pad) || (pad as number) < 0 || (pad as number) > MAX_PAD) {
    throw new Error(`pad must be a whole number from 0 to ${MAX_PAD}.`);
  }
  return pad as number;
}

const padField = (pad: number | undefined) => (pad === undefined ? {} : { pad: "x".repeat(pad) });

/** Every document the page reads, with null for a file the project does not have. */
async function readDocument(project: ProjectRef) {
  const { real } = project;
  return {
    research: await readProjectJson(real, "research.json"),
    tree: (await fileExists(real, "tree.gedcomx.json")) ? await readProjectJson(real, "tree.gedcomx.json") : null,
    startingTree: await readStartingTree(real),
    // Background reading only, so a bad file must not cost the researcher the card.
    collections: await readExternalCollections(real).catch(() => null),
    derived: { folderName: basename(real) },
  };
}

async function showProject(context: ToolContext, args: Args): Promise<CallToolResult> {
  refuseUnknownArgs(SHOW_PROJECT, args);
  requireOneOf("show", args.show, SHOW_VALUES);
  if (args.page !== undefined) requireOneOf("page", args.page, PAGE_VALUES);
  for (const name of ID_ARGS) {
    if (args[name] !== undefined && typeof args[name] !== "string") throw new Error(`${name} must be a string.`);
  }
  if (args.structuredCanary !== undefined && typeof args.structuredCanary !== "boolean") {
    throw new Error("structuredCanary must be true or false.");
  }
  const pad = padOf(args);
  const project = await resolveProject(context.rootReal, args.projectPath);
  const document = await readDocument(project);
  return {
    content: [{ type: "text", text: `The researcher sees the ${args.show} card; do not restate it. ${CONTENT_CANARY}` }],
    _meta: { [PROJECT_META_KEY]: { ...document, echo: args, canary: META_CANARY, ...padField(pad) } },
    ...(args.structuredCanary === true ? { structuredContent: { canary: STRUCTURED_CANARY } } : {}),
  };
}

async function readResults(project: ProjectRef, id: string) {
  const ref = `results/${id}.json`;
  if (!(await fileExists(project.real, ref))) return { found: false };
  return { found: true, results: await readProjectJson(project.real, ref) };
}

async function readProjectView(context: ToolContext, args: Args): Promise<CallToolResult> {
  refuseUnknownArgs(READ_PROJECT_VIEW, args);
  requireOneOf("part", args.part, PART_VALUES);
  const pad = padOf(args);
  if (pad !== undefined && args.part !== "document") throw new Error("pad is only accepted with part document.");
  const { id, part } = args;
  if (part === "results" && !(typeof id === "string" && LOG_ID_PATTERN.test(id))) {
    throw new Error("With part results, id must be a log id such as log_001.");
  }
  if (part === "image") {
    if (!(typeof id === "string" && IMAGE_REF_PATTERN.test(id))) {
      throw new Error("With part image, id must be an image ref such as images/page.jpg.");
    }
    if (!context.signImage) throw new Error("Page images need the HTTP server; this stdio viewer cannot serve them.");
  }
  const project = await resolveProject(context.rootReal, args.projectPath);
  const structuredContent =
    part === "document"
      ? { ...(await readDocument(project)), ...padField(pad) }
      : part === "results"
        ? await readResults(project, id as string)
        : context.signImage!(project, id as string);
  return { content: [{ type: "text", text: "ok" }], structuredContent };
}

/** Every failure is a tool result the model or page can read, with the root's
 *  path taken out of any message that picked it up on the way. */
export async function callTool(context: ToolContext, name: string, args: Args): Promise<CallToolResult> {
  try {
    if (name === SHOW_PROJECT) return await showProject(context, args);
    if (name === READ_PROJECT_VIEW) return await readProjectView(context, args);
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: "text", text: reason.split(context.rootReal).join("the viewer's root") }] };
  }
}
