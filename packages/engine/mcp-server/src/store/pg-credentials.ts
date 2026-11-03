// Postgres credentials read from a SAS fchDatabase object (U29), for the hosted
// tool server when GENEALOGY_PG_SAS_OBJECT is set. `@fs/sas-client` is loaded at
// run time and is never a declared dependency: FamilySearch's bundle build
// installs it. The pool and the readiness probe take discrete fields and a
// password function, never a connection string, so a rotated password is
// picked up by the next new connection. Only SQLSTATE 28P01 re-reads SAS;
// 28000 (`no pg_hba.conf entry`) is a TLS problem a password cannot fix.
// Nothing here logs the object, the password or a SAS error message.

import { createRequire } from "node:module";
import pg from "pg";
import type { PoolClient } from "pg";

export const SAS_PACKAGE = "@fs/sas-client";
/** At most one SAS fetch in this window after an authentication failure. */
export const MIN_REFRESH_MS = 30_000;

export interface FchDatabase {
  fchUser: string;
  fchPassword: string;
  fchDbConnectUrl: string;
  fchDbName?: string;
}

export interface SasClientLike {
  getSecureObject(name: string): Promise<unknown>;
  clearCache(): void;
}

export interface PgParams {
  host: string;
  port: number;
  database: string;
  user: string;
}

export class SasClientMissing extends Error {}

/** A SAS object that cannot be used: names the field, never its value. */
export class SasObjectInvalid extends Error {}

export function loadSasClient(req: NodeRequire = createRequire(import.meta.url)): SasClientLike {
  let Ctor: new () => SasClientLike;
  try {
    Ctor = req(SAS_PACKAGE) as new () => SasClientLike;
  } catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    if (err?.code === "MODULE_NOT_FOUND" && String(err.message).includes(`'${SAS_PACKAGE}'`)) {
      throw new SasClientMissing(`${SAS_PACKAGE} is not installed`);
    }
    throw e;
  }
  return new Ctor();
}

const JDBC_RE = /^jdbc:postgresql:\/\/([^/?,]+)(\/[^?]*)?(\?.*)?$/;

/** Host, port and database from a single-host `jdbc:postgresql://` URL. Query
 *  parameters (ssl, sslmode, user, password, ...) are dropped: TLS stays with
 *  PGSSLMODE. */
export function jdbcToPgParams(url: string, fchDbName?: string): { host: string; port: number; database: string } {
  const m = JDBC_RE.exec(url);
  if (!m) throw new SasObjectInvalid("fchDbConnectUrl is not a single-host jdbc:postgresql:// URL");
  const hostPort = m[1];
  const hp = hostPort.startsWith("[") ? /^\[([^\]]+)\](?::(\d+))?$/.exec(hostPort) : /^([^:]+)(?::(\d+))?$/.exec(hostPort);
  if (!hp) throw new SasObjectInvalid("fchDbConnectUrl has an unreadable host:port");
  const port = hp[2] === undefined ? 5432 : Number(hp[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SasObjectInvalid("fchDbConnectUrl has an invalid port");
  }
  const path = (m[2] ?? "").replace(/^\//, "");
  let database: string;
  try {
    database = path ? decodeURIComponent(path) : (fchDbName ?? "");
  } catch {
    throw new SasObjectInvalid("fchDbConnectUrl has an unreadable database name");
  }
  if (!database) throw new SasObjectInvalid("no database in fchDbConnectUrl or fchDbName");
  return { host: hp[1], port, database };
}

function field(obj: Record<string, unknown>, name: keyof FchDatabase, required: boolean): string | undefined {
  const v = obj[name];
  if (typeof v === "string" && v !== "") return v;
  if (required) throw new SasObjectInvalid(`SAS object has no ${name}`);
  return undefined;
}

/** The connection parameters and password in a fchDatabase object. */
export function parseFchDatabase(raw: unknown): { params: PgParams; password: string } {
  if (!raw || typeof raw !== "object") throw new SasObjectInvalid("SAS object is not an object");
  const obj = raw as Record<string, unknown>;
  const user = field(obj, "fchUser", true)!;
  const password = field(obj, "fchPassword", true)!;
  const url = field(obj, "fchDbConnectUrl", true)!;
  return { params: { ...jdbcToPgParams(url, field(obj, "fchDbName", false)), user }, password };
}

export const isAuthFailure = (e: unknown): boolean => (e as { code?: unknown })?.code === "28P01";

/** An error's code or name, never its message. */
function label(e: unknown): string {
  const err = e as { code?: unknown; name?: unknown };
  if (typeof err?.code === "string" && err.code) return err.code;
  if (typeof err?.name === "string" && err.name) return err.name;
  return "Error";
}

export class SasPgCredentials {
  private current: string;
  private lastFetch = Number.NEGATIVE_INFINITY;
  private inflight: Promise<void> | undefined;
  private readonly minRefreshMs: number;
  private readonly now: () => number;

  constructor(
    private readonly client: SasClientLike,
    readonly objectName: string,
    private readonly start: { params: PgParams; password: string },
    opts: { minRefreshMs?: number; now?: () => number } = {},
  ) {
    this.current = start.password;
    this.minRefreshMs = opts.minRefreshMs ?? MIN_REFRESH_MS;
    this.now = opts.now ?? Date.now;
  }

  /** Read the object, retrying an unreachable SAS; an unusable object throws
   *  `SasObjectInvalid` at once. */
  static async resolveAtStart(
    client: SasClientLike,
    objectName: string,
    opts: { attempts?: number; delayMs?: number; minRefreshMs?: number; now?: () => number } = {},
  ): Promise<SasPgCredentials> {
    const attempts = opts.attempts ?? 3;
    const delayMs = opts.delayMs ?? 5_000;
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
      let raw: unknown;
      try {
        raw = await client.getSecureObject(objectName);
      } catch (e) {
        last = e;
        continue;
      }
      return new SasPgCredentials(client, objectName, parseFchDatabase(raw), opts);
    }
    throw last;
  }

  params(): PgParams {
    return { ...this.start.params };
  }

  password(): Promise<string> {
    return Promise.resolve(this.current);
  }

  currentPassword(): string {
    return this.current;
  }

  /** After a 28P01 with `failed`: true when a different password is now
   *  current. Single flight, and at most one fetch per `minRefreshMs`. */
  async refreshAfterAuthFailure(failed: string): Promise<boolean> {
    if (this.current !== failed) return true;
    if (!this.inflight) {
      if (this.now() - this.lastFetch < this.minRefreshMs) return false;
      this.lastFetch = this.now();
      this.inflight = this.reread().finally(() => {
        this.inflight = undefined;
      });
    }
    await this.inflight;
    return this.current !== failed;
  }

  private async reread(): Promise<void> {
    try {
      this.client.clearCache();
      this.current = parseFchDatabase(await this.client.getSecureObject(this.objectName)).password;
    } catch (e) {
      process.stderr.write(`pg credentials: SAS object ${this.objectName} refresh failed (${label(e)})\n`);
    }
  }
}

type ConnectCallback = (err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void;

/** A pool whose new connections take the current SAS password, and which
 *  re-reads SAS and connects once more on a 28P01. */
export class SasPool extends pg.Pool {
  constructor(
    private readonly creds: SasPgCredentials,
    config: Omit<pg.PoolConfig, "host" | "port" | "database" | "user" | "password" | "connectionString">,
  ) {
    super({ ...config, ...creds.params(), password: () => creds.password() });
  }

  override connect(): Promise<PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    const used = this.creds.currentPassword();
    if (!callback) {
      return super.connect().catch(async (e: unknown) => {
        if (!isAuthFailure(e) || !(await this.creds.refreshAfterAuthFailure(used))) throw e;
        return super.connect();
      });
    }
    super.connect((err, client, done) => {
      if (!err || !isAuthFailure(err)) return callback(err, client, done);
      this.creds.refreshAfterAuthFailure(used).then(
        (changed) => (changed ? super.connect(callback) : callback(err, client, done)),
        () => callback(err, client, done),
      );
    });
  }
}
