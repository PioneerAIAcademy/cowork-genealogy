// viewer/stdio.ts with a stub page, because a test must not depend on a built
// one: `stdio-entry.ts <page file> <noise|quiet> --root <dir>`. `noise` writes one
// non-protocol line to stdout first, which is how the test proves its check fails.
import { exitWith, startStdio } from "../../viewer/start.js";

const [pagePath, noise, ...argv] = process.argv.slice(2);
if (noise === "noise") process.stdout.write("not protocol\n");
startStdio(argv, { pagePath, log: (line) => process.stderr.write(`${line}\n`) }).catch(exitWith);
