// M0's probes around the shared view tools in src/tools/project-view.ts: `pad`, the
// canaries and the --root rule for projectPath, none of which reach the tool server.
import { relative } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  callProjectView,
  PROJECT_META_KEY,
  projectViewToolSchemas,
  READ_PROJECT_VIEW,
  refuseUnknownArgs,
  SHOW_PROJECT,
  type ProjectViewContext,
} from "../src/tools/project-view.js";
import { resolveProject, type ProjectRef } from "./project.js";

// M0 asks the model to quote each of these, to learn which channel reaches it.
export const CONTENT_CANARY = "CANARY-CONTENT-K7Q2";
export const META_CANARY = "CANARY-META-M4X9";
export const STRUCTURED_CANARY = "CANARY-STRUCTURED-Z8R1";

const MAX_PAD = 8_000_000;

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

type ToolSchema = ReturnType<typeof projectViewToolSchemas>[number];
type Property = { type: string; description: string; enum?: string[] };

function withProbes(schema: ToolSchema, probes: Record<string, Property>) {
  const properties: Record<string, Property> = { ...schema.inputSchema.properties, ...probes };
  return { ...schema, inputSchema: { ...schema.inputSchema, properties } };
}

const [showSchema, readSchema] = projectViewToolSchemas(PROJECT_RULE);

export const toolSchemas = [
  withProbes(showSchema, {
    pad: PAD_PROPERTY,
    structuredCanary: {
      type: "boolean",
      description: "Probe only: also returns structuredContent, to see what reaches the model.",
    },
  }),
  withProbes(readSchema, {
    pad: { ...PAD_PROPERTY, description: `${PAD_PROPERTY.description} Only with part \`document\`.` },
  }),
];

export interface ToolContext {
  rootReal: string;
  /** A signed link to one page image. Absent on stdio, which has no route to serve it. */
  signImage?: (project: ProjectRef, ref: string) => { url: string; expiresAt: number };
}

type Args = Record<string, unknown>;

function padOf(args: Args): number | undefined {
  const { pad } = args;
  if (pad === undefined) return undefined;
  if (!Number.isInteger(pad) || (pad as number) < 0 || (pad as number) > MAX_PAD) {
    throw new Error(`pad must be a whole number from 0 to ${MAX_PAD}.`);
  }
  return pad as number;
}

const padField = (pad: number | undefined) => (pad === undefined ? {} : { pad: "x".repeat(pad) });

function viewContext({ rootReal, signImage }: ToolContext): ProjectViewContext {
  return {
    resolveProject: async (projectPath) => (await resolveProject(rootReal, projectPath)).real,
    ...(signImage
      ? { signImage: (real: string, ref: string) => signImage({ real, rel: relative(rootReal, real) }, ref) }
      : {}),
  };
}

function withShowProbes(result: CallToolResult, args: Args, pad: number | undefined): CallToolResult {
  const { text } = result.content[0] as { text: string };
  return {
    content: [{ type: "text", text: `${text} ${CONTENT_CANARY}` }],
    _meta: {
      [PROJECT_META_KEY]: {
        ...(result._meta?.[PROJECT_META_KEY] as object),
        echo: args,
        canary: META_CANARY,
        ...padField(pad),
      },
    },
    ...(args.structuredCanary === true ? { structuredContent: { canary: STRUCTURED_CANARY } } : {}),
  };
}

/** Every failure is a tool result the model or page can read, with the root's
 *  path taken out of any message that picked it up on the way. */
export async function callTool(context: ToolContext, name: string, args: Args): Promise<CallToolResult> {
  try {
    const schema = toolSchemas.find((tool) => tool.name === name);
    if (!schema) throw new Error(`Unknown tool: ${name}`);
    refuseUnknownArgs(schema, name, args);
    if (args.structuredCanary !== undefined && typeof args.structuredCanary !== "boolean") {
      throw new Error("structuredCanary must be true or false.");
    }
    const pad = padOf(args);
    if (name === READ_PROJECT_VIEW && pad !== undefined && args.part !== "document") {
      throw new Error("pad is only accepted with part document.");
    }
    const { pad: _pad, structuredCanary: _structuredCanary, ...shared } = args;
    const result = await callProjectView(viewContext(context), name, shared);
    if (name === SHOW_PROJECT) return withShowProbes(result, args, pad);
    return { ...result, structuredContent: { ...result.structuredContent, ...padField(pad) } };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: "text", text: reason.split(context.rootReal).join("the viewer's root") }] };
  }
}
