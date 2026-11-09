// The viewer as a local stdio server, for M0's local leg.
//   viewer/stdio.ts --root <dir>
import { exitWith, PAGE_PATH, startStdio } from "./start.js";

startStdio(process.argv.slice(2), {
  pagePath: PAGE_PATH,
  log: (line) => process.stderr.write(`${line}\n`),
}).catch(exitWith);
