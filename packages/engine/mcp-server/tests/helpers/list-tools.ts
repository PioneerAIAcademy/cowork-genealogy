import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { LOCAL } from "../../src/auth/principal.js";

/** tools/list as a connected client receives it. */
export async function listTools() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  // stdio and HTTP send JSON.stringify(message); the in-memory pair passes objects by reference.
  const send = serverSide.send.bind(serverSide);
  serverSide.send = (message, options) => send(JSON.parse(JSON.stringify(message)), options);
  const server = createServer(LOCAL);
  await server.connect(serverSide);
  const client = new Client({ name: "list-tools-test", version: "0" });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}
