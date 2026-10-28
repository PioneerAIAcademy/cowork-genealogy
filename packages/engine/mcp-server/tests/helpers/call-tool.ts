import { connectedClient } from "./list-tools.js";

/** tools/call through `createServer(LOCAL)`, as a connected client receives it:
 *  whether the server marked it an error, and its text content joined. */
export async function callTool(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const client = await connectedClient("call-tool-test");
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");
    return { isError: result.isError === true, text };
  } finally {
    await client.close();
  }
}
