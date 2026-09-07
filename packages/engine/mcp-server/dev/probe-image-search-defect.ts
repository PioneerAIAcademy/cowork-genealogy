/**
 * Live verification for image_search's defective-response handling.
 *
 * The `children/names` endpoint intermittently sends `null` as the value of one
 * of its keys (observed 2026-08-25 on M9SW-1CG). A plain live call cannot show
 * whether the tool's retry actually fires, because the defect is upstream and
 * intermittent — so this wraps `fetch` in a pass-through spy that still hits the
 * real API but records every raw body. That makes three things observable per
 * iteration: whether upstream misbehaved, how many fetches the tool issued
 * (2 = the retry fired), and whether the returned list was clean and complete.
 *
 * Usage:
 *   npx tsx dev/probe-image-search-defect.ts <imageGroupNumber> [iterations] [expectedCount]
 */
import { imageSearchTool } from "../src/tools/image-search.js";

const group = process.argv[2] ?? "004514823_003_M9SW-1CG";
const iterations = Number(process.argv[3] ?? 40);
const expected = process.argv[4] ? Number(process.argv[4]) : undefined;

const realFetch = globalThis.fetch;
let bodies: Array<{ keys: number; bad: number }> = [];

globalThis.fetch = (async (input: any, init?: any) => {
  const res = await realFetch(input, init);
  const url = String(typeof input === "string" ? input : input?.url ?? "");
  if (url.includes("/children/names")) {
    try {
      const data = (await res.clone().json()) as Record<string, unknown>;
      const values = Object.values(data);
      bodies.push({
        keys: values.length,
        bad: values.filter((v) => typeof v !== "string" || !v).length,
      });
    } catch {
      bodies.push({ keys: -1, bad: -1 });
    }
  }
  return res;
}) as typeof fetch;

let defectiveUpstream = 0;
let retriesFired = 0;
let badResults = 0;

for (let i = 1; i <= iterations; i++) {
  bodies = [];
  const { imageIds } = await imageSearchTool({ imageGroupNumber: group });
  const nulls = imageIds.filter((v) => typeof v !== "string" || !v).length;
  const upstreamBad = bodies.some((b) => b.bad > 0);
  const short = expected !== undefined && imageIds.length < expected;

  if (upstreamBad) defectiveUpstream++;
  if (bodies.length > 1) retriesFired++;
  if (nulls > 0 || short) badResults++;

  if (upstreamBad || bodies.length > 1 || nulls > 0 || short) {
    console.log(
      `!! iter ${i}: fetches=${bodies.length} bodies=${JSON.stringify(bodies)} ` +
        `returned=${imageIds.length} nulls=${nulls}${short ? " SHORT" : ""}`
    );
  }
}

console.log(
  JSON.stringify({
    group,
    iterations,
    defectiveUpstreamResponses: defectiveUpstream,
    retriesFired,
    resultsWithNullOrShort: badResults,
  })
);
