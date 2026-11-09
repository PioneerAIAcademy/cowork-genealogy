// The viewer over HTTP. Run with tsx; `make viewer` is the everyday way in.
//   viewer/cli.ts --secret <random> --root <dir> --public-url <https origin> [--port 8090]
//   viewer/cli.ts --local --root <dir> [--port 8090] [--no-open]
import open from "open";
import { exitWith, PAGE_PATH, startHttp } from "./start.js";

startHttp(process.argv.slice(2), {
  pagePath: PAGE_PATH,
  out: (line) => process.stdout.write(`${line}\n`),
  openBrowser: (url) => open(url),
}).catch(exitWith);
