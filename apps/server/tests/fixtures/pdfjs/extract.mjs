// node extract.mjs <pdfjs dir> <pdf>
//
// Loads the vendored pdf.js (<pdfjs dir>/pdf.min.mjs, the file the upload page imports)
// and prints the PDF's page count and per-page text layer as one JSON line:
// {"pages": N, "text": ["page 1 text", ...]}. The same calls the upload page makes.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [dir, file] = process.argv.slice(2);
const pdfjs = await import(pathToFileURL(join(dir, "pdf.min.mjs")).href);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(dir, "pdf.worker.min.mjs")).href;

// The loading task, and its destroy(), as the page does: pdf.js 6 documents have none.
const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(file)), verbosity: 0 });
const doc = await task.promise;
const text = [];
for (let n = 1; n <= doc.numPages; n++) {
  const content = await (await doc.getPage(n)).getTextContent();
  text.push(content.items.map((item) => item.str).join(" ").trim());
}
await task.destroy();
console.log(JSON.stringify({ pages: doc.numPages, text }));
