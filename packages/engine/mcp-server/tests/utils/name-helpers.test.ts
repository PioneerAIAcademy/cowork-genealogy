import { describe, it, expect } from "vitest";

import { preferredName } from "../../src/utils/name-helpers.js";
import type { SimplifiedName } from "../../src/types/gedcomx.js";

describe("preferredName", () => {
  it("returns the name flagged preferred, not the first", () => {
    const names: SimplifiedName[] = [
      { id: "N1", given: "Alternate", surname: "Aka" },
      { id: "N2", given: "Preferred", surname: "Real", preferred: true },
    ];
    expect(preferredName(names)?.id).toBe("N2");
  });

  it("falls back to the first name when none is flagged", () => {
    // The persisted tree still writes a non-preferred names[0] (producer side,
    // out of scope here), so this fallback is load-bearing, not dead code.
    const names: SimplifiedName[] = [
      { id: "N1", given: "First", surname: "One" },
      { id: "N2", given: "Second", surname: "Two" },
    ];
    expect(preferredName(names)?.id).toBe("N1");
  });

  it("returns undefined for an empty list", () => {
    expect(preferredName([])).toBeUndefined();
  });

  it("returns undefined when names is undefined", () => {
    expect(preferredName(undefined)).toBeUndefined();
  });

  it("matches on preferred === true only, ignoring a truthy non-true value", () => {
    // preferred is const: true in the schema and sanitized at read, so a
    // non-true value should never win selection — it falls back to names[0].
    const names = [
      { id: "N1", given: "First", surname: "One" },
      { id: "N2", given: "Truthy", surname: "NotTrue", preferred: 1 },
    ] as unknown as SimplifiedName[];
    expect(preferredName(names)?.id).toBe("N1");
  });
});
