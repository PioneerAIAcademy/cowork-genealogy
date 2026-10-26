import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { LOCAL } from "../../src/auth/principal.js";

/** tools/call through `createServer(LOCAL)`, as a connected client receives it:
 *  whether the server marked it an error, and its text content joined. */
export async function callTool(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  // stdio and HTTP send JSON.stringify(message); the in-memory pair passes objects by reference.
  const send = serverSide.send.bind(serverSide);
  serverSide.send = (message, options) => send(JSON.parse(JSON.stringify(message)), options);
  const server = createServer(LOCAL);
  await server.connect(serverSide);
  const client = new Client({ name: "call-tool-test", version: "0" });
  await client.connect(clientSide);
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");
    return { isError: result.isError === true, text };
  } finally {
    await client.close();
  }
}
