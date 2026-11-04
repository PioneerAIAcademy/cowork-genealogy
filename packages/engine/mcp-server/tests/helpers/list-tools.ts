import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { LOCAL } from "../../src/auth/principal.js";

/** A client connected to `createServer(LOCAL)` over the in-memory pair. Close it. */
export async function connectedClient(name: string): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  // stdio and HTTP send JSON.stringify(message); the in-memory pair passes objects by reference.
  const send = serverSide.send.bind(serverSide);
  serverSide.send = (message, options) => send(JSON.parse(JSON.stringify(message)), options);
  const server = createServer(LOCAL);
  await server.connect(serverSide);
  const client = new Client({ name, version: "0" });
  await client.connect(clientSide);
  return client;
}

/** tools/list as a connected client receives it. */
export async function listTools() {
  const client = await connectedClient("list-tools-test");
  try {
    const { tools } = await client.listTools();
    return tools;
  } finally {
    await client.close();
  }
}
