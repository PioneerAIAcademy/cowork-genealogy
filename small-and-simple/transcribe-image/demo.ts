/**
 * Transcribe one page and print it.
 *
 *   make demo                          # a sample page from the Holt genealogy
 *   make demo ARK='<ark, URL or imageId>'
 */
import { loadCredentials } from "../dev/credentials.js";
import { SolutionError } from "../shared/errors.js";
import { openRouterLlm } from "../shared/llm.js";
import { transcribeImage } from "./index.js";

const SAMPLE_ARK = "ark:/61903/3:1:3Q9M-CSDM-2S31-F";

const ref = process.argv[2] || SAMPLE_ARK;
const input = /^\d+_\d+$/.test(ref) ? { imageId: ref } : { ark: ref };
const { fsToken, openRouterApiKey, openRouterModel } = loadCredentials();
const llm = openRouterLlm({ apiKey: openRouterApiKey, model: openRouterModel });

console.log(`Reading ${ref} ...\n`);
const started = Date.now();
try {
  const out = await transcribeImage(input, { fsToken, llm });
  console.log(out.text);
  console.log(`\n${out.model}, ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (out.truncated) console.log("TRUNCATED: the model stopped before the end of the page.");
  const viewer = ref.startsWith("http") ? ref : ref.startsWith("ark:") ? `https://www.familysearch.org/${ref}` : null;
  if (viewer) console.log(`Compare with the scan: ${viewer}`);
} catch (error) {
  if (!(error instanceof SolutionError)) throw error;
  console.error(`${error.code}: ${error.message}`);
  process.exit(1);
}
