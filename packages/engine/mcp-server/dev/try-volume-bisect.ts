/**
 * Smoke-test volume_bisect against the live FS API and OpenRouter.
 *
 * Also the way to MEASURE the probe's latency: the spec's 20s OCR bound is
 * reasoned from the full-page p50, not measured for the year-only prompt.
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx dev/try-volume-bisect.ts 004516861_001_M9S4-SQB 1695
 */
import { LOCAL } from "../src/auth/principal.js";
import { volumeBisectTool } from "../src/tools/volume-bisect.js";
import type { VolumeBisectReading } from "../src/types/volume-bisect.js";

const group = process.argv[2];
const targetYear = Number(process.argv[3]);
if (!group || !Number.isInteger(targetYear)) {
  console.error("Usage: npx tsx dev/try-volume-bisect.ts <naturalGroupName> <year>");
  console.error("  e.g. npx tsx dev/try-volume-bisect.ts 004516861_001_M9S4-SQB 1695");
  process.exit(1);
}

// Walk the probes the way a caller would: echo each returned reading back.
const readings: VolumeBisectReading[] = [];
for (let i = 0; i < 12; i++) {
  const started = Date.now();
  const r = await volumeBisectTool({ imageGroupNumber: group, targetYear, readings }, LOCAL);
  console.log(
    `probe ${i + 1}  ${Math.round((Date.now() - started) / 100) / 10}s  ` +
      `${r.reading ? `${r.reading.imageId} -> ${r.reading.year}` : "(none)"}  ` +
      `bracket ${r.bracket.lowPosition}..${r.bracket.highPosition} ` +
      `(${r.bracket.lowYear}..${r.bracket.highYear})  ${r.confidence}`,
  );
  if (r.browseBudget) console.log(`  budget: ${r.browseBudget.notice}`);
  if (r.stopped) { console.log(`  stopped: ${r.stopped}`); break; }
  if (!r.reading || !r.nextImageId) break;
  readings.push(r.reading);
}
