/**
 * Fetch FamilySearch page-scans to disk so they can be read directly, without
 * going through image_transcribe's OCR.
 *
 * Why this exists: on the browse-only Swedish volumes behind the
 * elena-asmundsdotter-origin e2e fixture (#572), a transcribe miss is
 * ambiguous — the page may not hold the entry, or the OCR layer may have
 * failed to read one that does. Fetching the bytes and looking at them
 * separates those two, which is how 004523018 and 004523021 were told apart
 * in the first place.
 *
 * Usage:
 *   npx tsx dev/probe-elena-scans.ts <outDir> <imageId> [imageId ...]
 *   npx tsx dev/probe-elena-scans.ts /tmp/scans 004523018_00049 004523018_00050
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveFsImageInput, fetchFsImageBytes } from "../src/utils/fs-image-fetch.js";

const [outDir, ...imageIds] = process.argv.slice(2);
if (!outDir || imageIds.length === 0) {
  console.error("Usage: npx tsx dev/probe-elena-scans.ts <outDir> <imageId> [imageId ...]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

for (const imageId of imageIds) {
  try {
    const { url, fallbackUrl } = resolveFsImageInput({ imageId }, "probe-elena-scans");
    const fetched = await fetchFsImageBytes(url, fallbackUrl);
    const path = join(outDir, `${imageId}.jpg`);
    writeFileSync(path, fetched.bytes);
    console.log(
      JSON.stringify({
        imageId,
        ok: true,
        sizeBytes: fetched.sizeBytes,
        sizeKB: Math.round(fetched.sizeBytes / 1024),
        contentType: fetched.contentType,
        path,
      })
    );
  } catch (err) {
    console.log(
      JSON.stringify({ imageId, ok: false, error: err instanceof Error ? err.message : String(err) })
    );
  }
}
