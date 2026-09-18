// CLI for the Streamable HTTP tool server: `node build/http.js [--host H] [--port P]`.
import { parseArgs } from "node:util";
import { LOCAL } from "./auth/principal.js";
import { loadConfig } from "./auth/config.js";
import { startHttpServer, MCP_PATH } from "./http-server.js";

const { values } = parseArgs({
  options: {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "8787" },
  },
});

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`--port must be an integer 0-65535, got ${JSON.stringify(values.port)}`);
  process.exit(2);
}

// The one LOCAL read in this entrypoint: the process-wide config file
// (~/.familysearch-mcp/config.json — sidecar URLs, OpenRouter key, hosted
// flag). Every tool call binds a per-request bearer instead (http-server.ts).
const baseConfig = await loadConfig(LOCAL);
const server = await startHttpServer({ host: values.host as string, port, baseConfig });

const address = server.address();
const boundPort = typeof address === "object" && address ? address.port : port;
console.error(`genealogy tool server listening on http://${values.host}:${boundPort}${MCP_PATH}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // server.close() waits without a deadline on an in-flight body; give it a
    // bounded grace, then drop the sockets so `docker stop` gets a clean exit.
    setTimeout(() => server.closeAllConnections(), 5_000).unref();
  });
}
