# Genealogy MCP Server

A TypeScript MCP server that exposes genealogy research tools to Claude.

Currently implements one demo tool (`hello`) to prove the architecture works.

## Development

```bash
npm install
npm run build
npm start
```

## Tools

### hello

Generates a greeting for a person by name.

**Input:** `{ name: "Aunt Mary" }`
**Output:** `{ greeting: "Hello, Aunt Mary!", timestamp: "2025-01-01T00:00:00.000Z" }`
