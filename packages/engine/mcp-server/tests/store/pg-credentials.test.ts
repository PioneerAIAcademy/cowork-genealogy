import { describe, it, expect, vi } from "vitest";
import pg from "pg";
import {
  isAuthFailure,
  jdbcToPgParams,
  loadSasClient,
  parseFchDatabase,
  SasClientMissing,
  SasObjectInvalid,
  SasPgCredentials,
  SasPool,
  type SasClientLike,
} from "../../src/store/pg-credentials.js";
import { createPgS3Backend, readyLabel } from "../../src/store/pg-s3-project-store.js";

// U29: the tool server's Postgres credentials from a SAS fchDatabase object.
// A fake `{ getSecureObject, clearCache }` stands in for @fs/sas-client.

const SECRET = "s3cr@t:/%?# pw";

function obj(password: string, url = "jdbc:postgresql://db.example:6543/proto?ssl=true&sslmode=require") {
  return { fchUser: "app", fchPassword: password, fchDbConnectUrl: url };
}

/** A fake SAS client returning each queued object in turn (the last repeats). */
function fakeSas(...objects: unknown[]) {
  const events: string[] = [];
  let i = 0;
  const client = {
    getSecureObject: vi.fn(async (name: string) => {
      events.push(`get ${name}`);
      const o = objects[Math.min(i++, objects.length - 1)];
      if (o instanceof Error) throw o;
      return o;
    }),
    clearCache: vi.fn(() => {
      events.push("clearCache");
    }),
  } satisfies SasClientLike;
  return { client, events };
}

const authFail = () => Object.assign(new Error("password authentication failed for user \"app\""), { code: "28P01" });

describe("jdbcToPgParams", () => {
  it("reads host, port and database and drops every query parameter", () => {
    expect(jdbcToPgParams("jdbc:postgresql://db.example:6543/proto?ssl=true&sslmode=require&ApplicationName=x")).toEqual(
      { host: "db.example", port: 6543, database: "proto" },
    );
  });

  it("defaults the port to 5432 and keeps an IPv6 host without its brackets", () => {
    expect(jdbcToPgParams("jdbc:postgresql://db.example/proto")).toEqual({
      host: "db.example",
      port: 5432,
      database: "proto",
    });
    expect(jdbcToPgParams("jdbc:postgresql://[::1]:5433/proto")).toEqual({ host: "::1", port: 5433, database: "proto" });
  });

  it("takes the database from fchDbName when the URL has none", () => {
    expect(jdbcToPgParams("jdbc:postgresql://h:1/", "fromname").database).toBe("fromname");
    expect(jdbcToPgParams("jdbc:postgresql://h:1?ssl=true", "fromname").database).toBe("fromname");
    expect(() => jdbcToPgParams("jdbc:postgresql://h:1/")).toThrow(SasObjectInvalid);
  });

  it.each([
    ["another driver", "jdbc:mysql://h:3306/db"],
    ["several hosts", "jdbc:postgresql://h1:5432,h2:5432/db"],
    ["no host", "jdbc:postgresql:db"],
    ["a bad port", "jdbc:postgresql://h:99999/db"],
    ["a plain URL", "postgresql://h:5432/db"],
  ])("refuses %s without echoing the URL", (_what, url) => {
    let thrown: unknown;
    try {
      jdbcToPgParams(`${url}?password=${SECRET}`);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SasObjectInvalid);
    expect(String((thrown as Error).message)).not.toContain(SECRET);
    expect(String((thrown as Error).message)).not.toContain("h:");
  });
});

describe("parseFchDatabase", () => {
  it("gives the user and the password as they are", () => {
    expect(parseFchDatabase(obj(SECRET))).toEqual({
      params: { host: "db.example", port: 6543, database: "proto", user: "app" },
      password: SECRET,
    });
  });

  it.each(["fchUser", "fchPassword", "fchDbConnectUrl"])("refuses an object with no %s, naming only the field", (f) => {
    const o: Record<string, unknown> = obj(SECRET);
    delete o[f];
    expect(() => parseFchDatabase(o)).toThrow(new SasObjectInvalid(`SAS object has no ${f}`));
    o[f] = "";
    expect(() => parseFchDatabase(o)).toThrow(SasObjectInvalid);
  });
});

describe("isAuthFailure", () => {
  it("is 28P01 only, never 28000 (no pg_hba.conf entry)", () => {
    expect(isAuthFailure(authFail())).toBe(true);
    expect(isAuthFailure(Object.assign(new Error("no pg_hba.conf entry"), { code: "28000" }))).toBe(false);
    expect(isAuthFailure(new Error("password authentication failed"))).toBe(false);
    expect(isAuthFailure(undefined)).toBe(false);
  });
});

describe("loadSasClient", () => {
  it("constructs the package's default export", () => {
    class Fake {
      getSecureObject = async () => ({});
      clearCache() {}
    }
    const req = vi.fn(() => Fake) as unknown as NodeRequire;
    expect(loadSasClient(req)).toBeInstanceOf(Fake);
    expect(req).toHaveBeenCalledWith("@fs/sas-client");
  });

  it("throws SasClientMissing only when the package itself is absent", () => {
    const missing = Object.assign(new Error("Cannot find module '@fs/sas-client'"), { code: "MODULE_NOT_FOUND" });
    expect(() => loadSasClient((() => { throw missing; }) as unknown as NodeRequire)).toThrow(SasClientMissing);
    const transitive = Object.assign(new Error("Cannot find module 'node-cache'"), { code: "MODULE_NOT_FOUND" });
    expect(() => loadSasClient((() => { throw transitive; }) as unknown as NodeRequire)).toThrow(transitive);
  });

  it("throws SasClientMissing from the real resolver here, where the package is not installed", () => {
    expect(() => loadSasClient()).toThrow(SasClientMissing);
  });
});

describe("SasPgCredentials", () => {
  it("resolves at start, retrying an unreachable SAS, and caches the password", async () => {
    const { client } = fakeSas(new Error("ECONNREFUSED"), obj("one"));
    const creds = await SasPgCredentials.resolveAtStart(client, "pgobj", { delayMs: 1 });
    expect(client.getSecureObject).toHaveBeenCalledTimes(2);
    expect(creds.params()).toEqual({ host: "db.example", port: 6543, database: "proto", user: "app" });
    expect(await creds.password()).toBe("one");
    expect(await creds.password()).toBe("one");
    expect(client.getSecureObject).toHaveBeenCalledTimes(2);
  });

  it("gives up after the attempts, rethrowing the last SAS error", async () => {
    const down = Object.assign(new Error(`sas down ${SECRET}`), { code: "ECONNREFUSED" });
    const { client } = fakeSas(down);
    const failed = SasPgCredentials.resolveAtStart(client, "pgobj", { attempts: 3, delayMs: 1 });
    await expect(failed).rejects.toBe(down);
    expect(client.getSecureObject).toHaveBeenCalledTimes(3);
    // What build/http.js prints: the label, never the message.
    expect(readyLabel(down)).toBe("ECONNREFUSED");
  });

  it("refuses an unusable object at once, without retrying", async () => {
    const { client } = fakeSas({ fchUser: "app" });
    await expect(SasPgCredentials.resolveAtStart(client, "pgobj", { delayMs: 1 })).rejects.toBeInstanceOf(
      SasObjectInvalid,
    );
    expect(client.getSecureObject).toHaveBeenCalledTimes(1);
  });

  it("clears the client cache before re-reading the rotated password", async () => {
    const { client, events } = fakeSas(obj("one"), obj("two"));
    const creds = await SasPgCredentials.resolveAtStart(client, "pgobj");
    expect(await creds.refreshAfterAuthFailure("one")).toBe(true);
    expect(await creds.password()).toBe("two");
    expect(events).toEqual(["get pgobj", "clearCache", "get pgobj"]);
  });

  it("fetches nothing when a peer already moved past the failed password", async () => {
    const { client } = fakeSas(obj("one"), obj("two"));
    const creds = await SasPgCredentials.resolveAtStart(client, "pgobj");
    expect(await creds.refreshAfterAuthFailure("stale")).toBe(true);
    expect(client.getSecureObject).toHaveBeenCalledTimes(1);
  });

  it("reports false when SAS still holds the same password", async () => {
    const { client } = fakeSas(obj("one"));
    const creds = await SasPgCredentials.resolveAtStart(client, "pgobj");
    expect(await creds.refreshAfterAuthFailure("one")).toBe(false);
  });

  it("fetches at most once per window, by the clock", async () => {
    let now = 1_000_000;
    const { client } = fakeSas(obj("one"));
    const creds = await SasPgCredentials.resolveAtStart(client, "pgobj", { now: () => now });
    await creds.refreshAfterAuthFailure("one");
    now += 29_999;
    await creds.refreshAfterAuthFailure("one");
    expect(client.getSecureObject).toHaveBeenCalledTimes(2);
    now += 1;
    await creds.refreshAfterAuthFailure("one");
    expect(client.getSecureObject).toHaveBeenCalledTimes(3);
  });

  it("makes one fetch for twenty concurrent failures", async () => {
    const { client } = fakeSas(obj("one"), obj("two"));
    const creds = await SasPgCredentials.resolveAtStart(client, "pgobj");
    const results = await Promise.all(Array.from({ length: 20 }, () => creds.refreshAfterAuthFailure("one")));
    expect(results.every(Boolean)).toBe(true);
    expect(client.getSecureObject).toHaveBeenCalledTimes(2);
  });

  it("keeps the old password and logs only a label when the refresh fails", async () => {
    const { client } = fakeSas(obj("one"), Object.assign(new Error(`boom ${SECRET}`), { name: "SasError" }));
    const creds = await SasPgCredentials.resolveAtStart(client, "pgobj");
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      expect(await creds.refreshAfterAuthFailure("one")).toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(await creds.password()).toBe("one");
    expect(writes.join("")).toBe("pg credentials: SAS object pgobj refresh failed (SasError)\n");
  });
});

/** A pg.Client stand-in whose connect fails 28P01 while the password is not `good`. */
function fakeClientClass(good: string, seen: string[]) {
  return class FakeClient extends pg.Client {
    constructor(private readonly opts: pg.ClientConfig) {
      super({});
    }
    override connect(cb?: any): any {
      const pw = this.opts.password as () => Promise<string>;
      const run = async () => {
        const password = await pw();
        seen.push(password);
        if (password !== good) throw authFail();
      };
      if (!cb) return run();
      run().then(
        () => cb(null),
        (e) => cb(e),
      );
    }
    override query(...args: any[]): any {
      const cb = args.find((a) => typeof a === "function");
      const res = { rows: [{ ok: 1 }] };
      if (cb) {
        setImmediate(() => cb(null, res));
        return undefined;
      }
      return Promise.resolve(res);
    }
    override end(cb?: any): any {
      if (cb) {
        cb();
        return undefined;
      }
      return Promise.resolve();
    }
  };
}

describe("SasPool", () => {
  async function setup() {
    const { client } = fakeSas(obj("one"), obj("two"));
    const creds = await SasPgCredentials.resolveAtStart(client, "pgobj");
    const seen: string[] = [];
    const pool = new SasPool(creds, { Client: fakeClientClass("two", seen) as never });
    return { client, creds, seen, pool };
  }

  it("passes discrete fields and a password function, never a connection string", async () => {
    const { pool } = await setup();
    const opts = (pool as unknown as { options: pg.PoolConfig }).options;
    expect(opts).toMatchObject({ host: "db.example", port: 6543, database: "proto", user: "app" });
    expect(opts.connectionString).toBeUndefined();
    expect(typeof opts.password).toBe("function");
    await pool.end();
  });

  it("re-reads SAS and connects once more on a 28P01, in the promise form", async () => {
    const { client, seen, pool } = await setup();
    const c = await pool.connect();
    c.release();
    expect(seen).toEqual(["one", "two"]);
    expect(client.clearCache).toHaveBeenCalledTimes(1);
    await pool.end();
  });

  it("re-reads SAS and connects once more on a 28P01, in the callback form pool.query uses", async () => {
    const { seen, pool } = await setup();
    const res = await new Promise<pg.QueryResult>((resolve, reject) =>
      pool.query("SELECT 1", (err: Error, r: pg.QueryResult) => (err ? reject(err) : resolve(r))),
    );
    expect(res.rows).toEqual([{ ok: 1 }]);
    expect(seen).toEqual(["one", "two"]);
    expect(await pool.query("SELECT 1")).toMatchObject({ rows: [{ ok: 1 }] });
    await pool.end();
  });

  it("surfaces the 28P01 when SAS has nothing new, without a second connect", async () => {
    const { client } = fakeSas(obj("one"));
    const creds = await SasPgCredentials.resolveAtStart(client, "pgobj");
    const seen: string[] = [];
    const pool = new SasPool(creds, { Client: fakeClientClass("two", seen) as never });
    await expect(pool.connect()).rejects.toMatchObject({ code: "28P01" });
    expect(seen).toEqual(["one"]);
    await expect(
      new Promise((resolve, reject) => pool.query("SELECT 1", (err: Error, r: unknown) => (err ? reject(err) : resolve(r)))),
    ).rejects.toMatchObject({ code: "28P01" });
    // The second failure is inside the rate-limit window: still one refresh fetch.
    expect(client.getSecureObject).toHaveBeenCalledTimes(2);
    await pool.end();
  });

  it("does not re-read SAS on any other connect error", async () => {
    const { client } = fakeSas(obj("one"), obj("two"));
    const creds = await SasPgCredentials.resolveAtStart(client, "pgobj");
    const Refused = class extends pg.Client {
      override connect(cb?: any): any {
        const e = Object.assign(new Error("no pg_hba.conf entry"), { code: "28000" });
        if (!cb) return Promise.reject(e);
        setImmediate(() => cb(e));
      }
    };
    const pool = new SasPool(creds, { Client: Refused as never });
    await expect(pool.connect()).rejects.toMatchObject({ code: "28000" });
    expect(client.getSecureObject).toHaveBeenCalledTimes(1);
    await pool.end();
  });
});

describe("createPgS3Backend with SAS credentials", () => {
  it("builds a SasPool, and its readiness probe re-reads SAS on a 28P01 without echoing the password", async () => {
    const { client } = fakeSas(obj(SECRET, "jdbc:postgresql://127.0.0.1:1/proto"), obj("two"));
    const creds = await SasPgCredentials.resolveAtStart(client, "pgobj");
    const refresh = vi.spyOn(creds, "refreshAfterAuthFailure");
    const backend = createPgS3Backend({
      dsn: "",
      pgCredentials: creds,
      s3: { bucket: "b", endpoint: "http://127.0.0.1:1", accessKeyId: "a", secretAccessKey: "s", forcePathStyle: true },
    });
    expect(backend.pool).toBeInstanceOf(SasPool);
    const connect = vi.spyOn(pg.Client.prototype, "connect").mockImplementation(async function (this: pg.Client) {
      throw authFail();
    } as never);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const report = await backend.checkReady(500);
      expect(report.checks.postgres).toEqual({ ok: false, error: "28P01" });
      expect(JSON.stringify(report)).not.toContain(SECRET);
      expect(refresh).toHaveBeenCalledWith(SECRET);
      expect(await refresh.mock.results[0].value).toBe(true);
    } finally {
      connect.mockRestore();
      spy.mockRestore();
      await backend.close();
    }
    expect(await creds.password()).toBe("two");
  });
});

// A real rotation against the compose Postgres (`make proto-store-test` sets
// PROTO_PG_DSN): a scratch role whose password changes under a live SasPool.
const LIVE_DSN = process.env.PROTO_PG_DSN;
if (!LIVE_DSN) {
  describe.skip("SasPool rotation — skipped: PROTO_PG_DSN is not set (run `make proto-store-test`)", () => {
    it("needs Postgres", () => {});
  });
} else {
  describe("SasPool rotation against Postgres", () => {
    it("recovers on the next new connection after ALTER ROLE ... PASSWORD, and readiness follows", async () => {
      const admin = new pg.Client({ connectionString: LIVE_DSN });
      await admin.connect();
      const role = `sas_rot_${Date.now()}`;
      const url = new URL(LIVE_DSN);
      const jdbc = `jdbc:postgresql://${url.hostname}:${url.port || 5432}${url.pathname}?sslmode=disable`;
      await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD 'old-pw'`);
      await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`);
      const live = (password: string) => ({ ...obj(password, jdbc), fchUser: role });
      let sasObject = live("old-pw");
      const client: SasClientLike = {
        getSecureObject: vi.fn(async () => sasObject),
        clearCache: vi.fn(),
      };
      const creds = await SasPgCredentials.resolveAtStart(client, "pgobj");
      const backend = createPgS3Backend({
        dsn: "",
        pgCredentials: creds,
        s3: { bucket: "b", endpoint: "http://127.0.0.1:1", accessKeyId: "a", secretAccessKey: "s", forcePathStyle: true },
      });
      const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        expect((await backend.pool.query("SELECT current_user AS u")).rows[0].u).toBe(role);
        expect((await backend.checkReady()).checks.postgres).toEqual({ ok: true });
        // Rotate, then force new connections: idle sessions survive a password change.
        await admin.query(`ALTER ROLE ${role} PASSWORD 'new-pw'`);
        sasObject = live("new-pw");
        await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1", [role]);
        await new Promise((r) => setTimeout(r, 100));

        const stale = await backend.checkReady();
        expect(stale.checks.postgres).toEqual({ ok: false, error: "28P01" });
        expect(await creds.password()).toBe("new-pw");
        expect((await backend.checkReady()).checks.postgres).toEqual({ ok: true });

        // The probe's refresh moved the pool on too; a failing pool connect alone re-reads as well.
        await admin.query(`ALTER ROLE ${role} PASSWORD 'newer-pw'`);
        sasObject = live("newer-pw");
        await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1", [role]);
        await new Promise((r) => setTimeout(r, 100));
        const fresh = new SasPool(await SasPgCredentials.resolveAtStart(
          { getSecureObject: async () => live("new-pw"), clearCache: () => {} },
          "pgobj",
        ), {});
        await expect(fresh.query("SELECT 1")).rejects.toMatchObject({ code: "28P01" });
        await fresh.end();
        const rotating = new SasPool(
          new SasPgCredentials(client, "pgobj", { params: creds.params(), password: "new-pw" }),
          {},
        );
        // As createPgS3Backend does: the cleanup's pg_terminate_backend can reach this pool's
        // closing client, and a pool with no "error" listener throws it as uncaught (57P01).
        rotating.on("error", () => {});
        expect((await rotating.query("SELECT current_user AS u")).rows[0].u).toBe(role);
        expect(client.clearCache).toHaveBeenCalledTimes(2);
        await rotating.end();
      } finally {
        spy.mockRestore();
        await backend.close();
        await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1", [role]);
        await admin.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
        await admin.query(`DROP ROLE ${role}`);
        await admin.end();
      }
    });
  });
}
