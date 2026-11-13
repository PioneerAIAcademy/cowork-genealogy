// The viewer's command line. A bad value refuses to start with a message naming
// the flag. No message echoes a value: a misplaced one may be the secret.
import { parseArgs } from "node:util";

/** A refusal to start: the entry prints it and exits 2. */
export class UsageError extends Error {}

export const DEFAULT_PORT = 8090;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{32,}$/;

export type CliArgs =
  | { local: true; root: string; port: number; open: boolean }
  | { local: false; root: string; port: number; secret: string; publicUrl: string };

/** `parseArgs` with its own errors turned into a refusal to start. */
function readFlags(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        secret: { type: "string" },
        root: { type: "string" },
        "public-url": { type: "string" },
        port: { type: "string" },
        local: { type: "boolean" },
        "no-open": { type: "boolean" },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const port = /^[0-9]{1,5}$/.test(raw) ? Number(raw) : 0;
  if (port < 1 || port > 65535) throw new UsageError("--port must be a whole number from 1 to 65535.");
  return port;
}

/** The tunnel's origin. Every image link and the CSP entry are built from it. */
function parsePublicUrl(raw: string): string {
  const refuse = (): never => {
    throw new UsageError("--public-url must be an https origin with no path, query or credentials.");
  };
  let url: URL | undefined;
  try {
    url = new URL(raw);
  } catch {
    refuse();
  }
  const { protocol, username, password, pathname, origin } = url as URL;
  if (protocol !== "https:" || username || password || pathname !== "/" || /[?#]/.test(raw)) refuse();
  return origin;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = readFlags(argv);
  if (positionals.length > 0) throw new UsageError("This command takes flags only, no bare arguments.");
  const { root } = values;
  if (!root) throw new UsageError("--root is required.");
  const port = parsePort(values.port);
  const publicUrl = values["public-url"];
  const { secret } = values;
  if (values.local) {
    if (secret !== undefined || publicUrl !== undefined) {
      throw new UsageError("--local cannot be combined with --secret or --public-url.");
    }
    return { local: true, root, port, open: !values["no-open"] };
  }
  if (values["no-open"]) throw new UsageError("--no-open only applies with --local.");
  if (secret === undefined) throw new UsageError("--secret is required without --local.");
  if (!SECRET_PATTERN.test(secret)) {
    throw new UsageError("--secret must be at least 32 characters of A-Z, a-z, 0-9, _ and -.");
  }
  if (publicUrl === undefined) throw new UsageError("--public-url is required without --local.");
  return { local: false, root, port, secret, publicUrl: parsePublicUrl(publicUrl) };
}
