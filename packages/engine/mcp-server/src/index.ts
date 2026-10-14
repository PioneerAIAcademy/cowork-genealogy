// The shipped stdio entrypoint: the .mcpb desktop extension and both eval
// harnesses fork `node build/index.js`. One desktop user per process, so every
// tool acts as the local principal — tokens and config live in
// ~/.familysearch-mcp and the project store is the filesystem, with the
// OpenRouter key from the .mcpb install dialog, when given, layered on top. The
// dispatch chain itself is src/server.ts (createServer); the search-agent
// prototype's tool server is src/http.ts.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { installConfigFromEnv } from "./auth/config.js";
import { localPrincipal } from "./auth/principal.js";
import { createServer } from "./server.js";

const server = createServer(localPrincipal(installConfigFromEnv(process.env)));
const transport = new StdioServerTransport();
await server.connect(transport);
