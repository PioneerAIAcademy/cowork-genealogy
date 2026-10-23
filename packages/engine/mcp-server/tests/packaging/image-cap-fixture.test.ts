import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  IMAGE_BROWSE_CAP,
  __clearImageBrowseMemoryForTests,
  checkImageBrowseCap,
  recordImageBrowse,
} from "../../src/utils/browse-budget.js";

/**
 * The unit harness's image-cap fixture must be the refusal `image_transcribe`
 * actually throws. `eval/tests/unit/search-images` grades whether the agent relays
 * that text to its caller, so a fixture that drifted from the tool would grade
 * the relay of a message no patron can receive.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "..", "..", "..", "..", "..", "eval", "fixtures", "mcp", "image-transcribe-cap-reached.json");

describe("image-transcribe-cap-reached fixture", () => {
  beforeEach(() => __clearImageBrowseMemoryForTests());

  it("carries the exact refusal browse-budget.ts throws for its imageId", async () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
    const imageId: string = fixture.args.imageId;
    const group = imageId.split("_")[0];
    for (let i = 1; i <= IMAGE_BROWSE_CAP; i++) {
      const id = `${group}_${String(i).padStart(5, "0")}`;
      expect(id).not.toBe(imageId);
      await recordImageBrowse(await checkImageBrowseCap({ imageId: id }, undefined, "image_transcribe"));
    }
    const err = await checkImageBrowseCap({ imageId }, undefined, "image_transcribe").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(fixture.is_error).toBe(true);
    expect(fixture.response).toEqual({ error: (err as Error).message });
  });
});
