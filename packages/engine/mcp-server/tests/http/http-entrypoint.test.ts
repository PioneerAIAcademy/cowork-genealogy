import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { FsProjectStore } from "../../src/store/fs-project-store.js";
import { getProjectStore } from "../../src/store/project-store.js";

// build/http.js serves every patron from one process, so the guarantee that a
// code path running outside a request binding FAILS rather than reaching the
// file backend rests on this entrypoint installing an unbound process store —
// one hand-written line that no other test reads. Importing the module runs
// that line; the listener, the host config read and the Pg/S3 backend are
// mocked, so nothing binds a port or opens a pool.

const captured = vi.hoisted(() => ({
  storeAtListen: undefined as unknown,
  startCalls: 0,
  baseConfig: undefined as unknown,
}));

vi.mock("../../src/http-server.js", async () => {
  const { getProjectStore: read } = await import("../../src/store/project-store.js");
  return {
    MCP_PATH: "/mcp",
    startHttpServer: async (opts: { baseConfig: unknown }) => {
      captured.startCalls += 1;
      captured.baseConfig = opts.baseConfig;
      // The store as it stands when the server starts accepting requests.
      captured.storeAtListen = read();
      return {
        address: () => ({ port: 8787 }),
        close: (cb?: () => void) => cb?.(),
        closeAllConnections: () => {},
      };
    },
  };
});

vi.mock("../../src/auth/config.js", () => ({
  loadConfig: async () => ({ hosted: true, wikiApiUrl: "http://from-the-file:8000" }),
}));

vi.mock("../../src/store/pg-s3-project-store.js", () => ({
  createPgS3Backend: () => ({ close: async () => {} }),
  PgS3ProjectStore: class {},
}));

// The per-user config a container receives as environment, not as a baked-in file.
const CONFIG_ENV: Record<string, string> = {
  OPENROUTER_API_KEY: "or-key-from-env",
  WIKI_API_URL: "http://from-the-env:8000",
};

const STORE_ENV: Record<string, string> = {
  GENEALOGY_PG_DSN: "postgres://u:p@127.0.0.1:1/db",
  GENEALOGY_S3_ENDPOINT: "http://127.0.0.1:1",
  GENEALOGY_S3_BUCKET: "bucket",
  GENEALOGY_S3_ACCESS_KEY: "key",
  GENEALOGY_S3_SECRET_KEY: "secret",
};

const savedArgv = process.argv;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  // parseArgs reads process.argv; under vitest it holds the runner's own args.
  process.argv = ["node", "http.js"];
  for (const [name, value] of Object.entries({ ...STORE_ENV, ...CONFIG_ENV })) {
    savedEnv[name] = process.env[name];
    process.env[name] = value;
  }
  for (const name of ["POP_STATS_URL", "OPENROUTER_MODEL"]) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  vi.spyOn(console, "error").mockImplementation(() => {});
  await import("../../src/http.js");
});

afterAll(() => {
  process.argv = savedArgv;
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

describe("the HTTP entrypoint's process store", () => {
  it("fails closed rather than falling through to the file backend, from before the server listens", async () => {
    expect(captured.startCalls).toBe(1);
    // Installed before startHttpServer, so no request window reaches the file backend.
    expect(captured.storeAtListen).not.toBeInstanceOf(FsProjectStore);
    await expect(
      (captured.storeAtListen as ReturnType<typeof getProjectStore>).readText("/project", "research.json"),
    ).rejects.toThrow();

    // And still installed once the entrypoint has finished starting up.
    const store = getProjectStore();
    expect(store).not.toBeInstanceOf(FsProjectStore);
    await expect(store.readText("/project", "research.json")).rejects.toThrow();
  });
});

describe("the HTTP entrypoint's per-user config", () => {
  it("takes the four keys from the environment over the mounted file, and leaves the rest", () => {
    // One shared process serves every turn, so the OpenRouter key reaches it as environment
    // the way it reaches hosted-stdio.js — without this, `image_transcribe` loses its key the
    // moment the worker's TOOL_SERVER default moves to http.
    const config = captured.baseConfig as Record<string, unknown>;
    expect(config.openRouterApiKey).toBe("or-key-from-env");
    expect(config.wikiApiUrl).toBe("http://from-the-env:8000");
    // The file still supplies what the environment does not name...
    expect(config.hosted).toBe(true);
    // ...and an unset variable leaves the key absent, so each getter's own default applies.
    expect("popStatsUrl" in config).toBe(false);
    expect("openRouterModel" in config).toBe(false);
  });
});
