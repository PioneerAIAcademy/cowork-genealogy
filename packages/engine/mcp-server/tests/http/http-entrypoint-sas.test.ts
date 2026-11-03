import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// build/http.js with GENEALOGY_PG_SAS_OBJECT set (U29): the SAS object is
// resolved before the backend is built, and the backend gets those credentials
// rather than a DSN. The SAS client, the listener and the backend are mocked.

const captured = vi.hoisted(() => ({
  backendOptions: undefined as undefined | Record<string, unknown>,
  resolved: { objectName: "pgobj" },
  resolveAtStart: vi.fn(),
  sasClient: { getSecureObject: async () => ({}), clearCache: () => {} },
  stderr: [] as string[],
}));

vi.mock("../../src/store/pg-credentials.js", () => ({
  loadSasClient: () => captured.sasClient,
  SasClientMissing: class extends Error {},
  SasObjectInvalid: class extends Error {},
  SasPgCredentials: { resolveAtStart: captured.resolveAtStart },
}));

vi.mock("../../src/http-server.js", () => ({
  MCP_PATH: "/mcp",
  startHttpServer: async () => ({
    address: () => ({ port: 8787 }),
    close: (cb?: () => void) => cb?.(),
    closeAllConnections: () => {},
  }),
}));

vi.mock("../../src/auth/config.js", () => ({ loadConfig: async () => ({}) }));

vi.mock("../../src/store/pg-s3-project-store.js", () => ({
  createPgS3Backend: (options: Record<string, unknown>) => {
    captured.backendOptions = options;
    return { close: async () => {}, checkReady: async () => ({ ok: true, checks: {} }) };
  },
  PgS3ProjectStore: class {},
  authorizeAttempt: async () => ({ ok: false, reason: "no_match" }),
  readyLabel: () => "Error",
}));

const STORE_ENV: Record<string, string> = {
  GENEALOGY_PG_SAS_OBJECT: "pgobj",
  GENEALOGY_S3_BUCKET: "bucket",
  GENEALOGY_ORPHAN_SWEEP_INTERVAL_S: "0",
};

const savedArgv = process.argv;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  process.argv = ["node", "http.js"];
  captured.resolveAtStart.mockResolvedValue(captured.resolved);
  for (const [name, value] of Object.entries(STORE_ENV)) {
    savedEnv[name] = process.env[name];
    process.env[name] = value;
  }
  savedEnv.GENEALOGY_PG_DSN = process.env.GENEALOGY_PG_DSN;
  delete process.env.GENEALOGY_PG_DSN;
  vi.spyOn(console, "error").mockImplementation(() => {});
  const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    captured.stderr.push(String(chunk));
    return true;
  });
  try {
    await import("../../src/http.js");
  } finally {
    stderrWrite.mockRestore();
  }
});

afterAll(() => {
  process.argv = savedArgv;
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

describe("the HTTP entrypoint with GENEALOGY_PG_SAS_OBJECT", () => {
  it("resolves the named object through the SAS client before building the backend", () => {
    expect(captured.resolveAtStart).toHaveBeenCalledTimes(1);
    expect(captured.resolveAtStart).toHaveBeenCalledWith(captured.sasClient, "pgobj");
  });

  it("hands the backend those credentials, not a DSN", () => {
    expect(captured.backendOptions?.pgCredentials).toBe(captured.resolved);
    expect(captured.backendOptions?.dsn).toBe("");
  });

  it("names the SAS object on start-up", () => {
    expect(captured.stderr.join("")).toContain("pg credentials: SAS object pgobj\n");
  });
});
