import { describe, it, expect } from "vitest";
import {
  toArk,
  arkToUrl,
  arkToBareId,
  isDocumentImageArk,
  findDocumentImageArk,
  imageViewerUrl,
} from "../../src/utils/ark.js";

describe("toArk", () => {
  it("strips a familysearch.org resolver URL to the bare ARK", () => {
    expect(toArk("https://familysearch.org/ark:/61903/1:1:QPRC-WPBZ")).toBe(
      "ark:/61903/1:1:QPRC-WPBZ",
    );
  });

  it("strips a www.familysearch.org resolver URL", () => {
    expect(
      toArk("https://www.familysearch.org/ark:/61903/3:1:3Q9M-CSNL-S98H-M"),
    ).toBe("ark:/61903/3:1:3Q9M-CSNL-S98H-M");
  });

  it("passes an already-bare ARK through unchanged", () => {
    expect(toArk("ark:/61903/4:1:KGS8-LY1")).toBe("ark:/61903/4:1:KGS8-LY1");
  });

  it("wraps a type-prefixed bare id", () => {
    expect(toArk("1:2:HSJG-CLNF")).toBe("ark:/61903/1:2:HSJG-CLNF");
  });

  it("returns non-ARK input unchanged", () => {
    expect(toArk("QPRC-WPBZ")).toBe("QPRC-WPBZ");
    expect(toArk("")).toBe("");
  });
});

describe("arkToUrl", () => {
  it("expands a bare ARK to a resolver URL", () => {
    expect(arkToUrl("ark:/61903/1:1:QPRC-WPBZ")).toBe(
      "https://www.familysearch.org/ark:/61903/1:1:QPRC-WPBZ",
    );
  });

  it("passes an existing URL through unchanged", () => {
    expect(
      arkToUrl("https://familysearch.org/ark:/61903/1:1:QPRC-WPBZ"),
    ).toBe("https://familysearch.org/ark:/61903/1:1:QPRC-WPBZ");
  });

  it("returns non-ARK input unchanged", () => {
    expect(arkToUrl("KGS8-LY1")).toBe("KGS8-LY1");
  });

  it("round-trips URL -> ARK -> URL", () => {
    const ark = toArk("https://familysearch.org/ark:/61903/1:1:QPRC-WPBZ");
    expect(arkToUrl(ark)).toBe(
      "https://www.familysearch.org/ark:/61903/1:1:QPRC-WPBZ",
    );
  });
});

describe("arkToBareId", () => {
  it("reduces a bare ARK to the 8-char persona id", () => {
    expect(arkToBareId("ark:/61903/4:1:KGS8-LY1")).toBe("KGS8-LY1");
  });

  it("reduces a resolver URL to the persona id", () => {
    expect(arkToBareId("https://familysearch.org/ark:/61903/1:1:QPRC-WPBZ")).toBe(
      "QPRC-WPBZ",
    );
  });

  it("reduces a type-prefixed id", () => {
    expect(arkToBareId("1:2:HSJG-CLNF")).toBe("HSJG-CLNF");
  });

  it("passes an already-bare id through unchanged", () => {
    expect(arkToBareId("KGS8-LY1")).toBe("KGS8-LY1");
  });

  it("does not mangle a non-ARK URL (no false colon split)", () => {
    expect(arkToBareId("https://example.com/p1-ark")).toBe(
      "https://example.com/p1-ark",
    );
  });
});

// The single document-image-ARK predicate, shared by fs-image-fetch's input
// validation, its error-message scanner, and record_read's extractImageArk.
// Those were three hand-maintained copies with three anchorings before this.
describe("isDocumentImageArk / findDocumentImageArk", () => {
  it("accepts 3:1: and 3:2: and rejects other ARK types", () => {
    expect(isDocumentImageArk("ark:/61903/3:1:9Q97-YSRZ-GWP")).toBe(true);
    expect(isDocumentImageArk("ark:/61903/3:2:77TJ-PXCN")).toBe(true);
    expect(isDocumentImageArk("ark:/61903/1:1:QVS9-DHDB")).toBe(false);
    expect(isDocumentImageArk("ark:/61903/1:2:HSJG-CLNF")).toBe(false);
  });

  // Issue #2392 measured 746 unique ARKs with 1-4 hyphen groups, 16 of them
  // 2-group and 7 of those real. A tail-shape rule would refuse those, so the
  // predicate must stay indifferent to group count.
  it("accepts any hyphen-group count in the tail", () => {
    for (const ark of [
      "ark:/61903/3:1:MDM6-ZQW",
      "ark:/61903/3:2:77TJ-PXCN",
      "ark:/61903/3:1:9Q97-YSRZ-GWP",
      "ark:/61903/3:1:3Q9M-CSNL-S98H-M",
    ]) {
      expect(isDocumentImageArk(ark)).toBe(true);
    }
  });

  it("is anchored: it refuses an ARK embedded in a longer string", () => {
    expect(
      isDocumentImageArk(
        "https://www.familysearch.org/ark:/61903/3:1:9Q97-YSRZ-GWP",
      ),
    ).toBe(false);
  });

  it("findDocumentImageArk pulls the ARK out of a resolved URL", () => {
    expect(
      findDocumentImageArk(
        "https://www.familysearch.org/ark:/61903/3:1:9Q97-YSRZ-GWP?i=112",
      ),
    ).toBe("ark:/61903/3:1:9Q97-YSRZ-GWP");
  });

  it("findDocumentImageArk returns undefined for a DGS URL or a record ARK", () => {
    expect(
      findDocumentImageArk("https://familysearch.org/das/v2/dgs:004884748_02613/dist.jpg"),
    ).toBeUndefined();
    expect(
      findDocumentImageArk("https://www.familysearch.org/ark:/61903/1:1:QVS9-DHDB"),
    ).toBeUndefined();
  });
});

// Issue #2854: build a FamilySearch viewer URL from an image tool's input.
describe("imageViewerUrl", () => {
  it("builds a film-viewer URL from a DGS imageId (zero-indexed i=)", () => {
    expect(imageViewerUrl({ imageId: "004528077_00697" })).toBe(
      "https://www.familysearch.org/search/film/004528077?i=696",
    );
  });

  it("handles DGS image number 00001 as i=0", () => {
    expect(imageViewerUrl({ imageId: "004884748_00001" })).toBe(
      "https://www.familysearch.org/search/film/004884748?i=0",
    );
  });

  it("builds a resolver URL from a canonical document-image ARK", () => {
    expect(imageViewerUrl({ ark: "ark:/61903/3:1:3Q9M-CSNL-S98H-M" })).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:3Q9M-CSNL-S98H-M",
    );
  });

  it("builds a resolver URL from a bare 3:1: id", () => {
    expect(imageViewerUrl({ ark: "3:1:3Q9M-CSNL-S98H-M" })).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:3Q9M-CSNL-S98H-M",
    );
  });

  it("preserves i=/cc=/groupId= context params from a full URL", () => {
    const extractQ = (raw: string) => {
      try {
        const u = new URL(raw);
        const p = new URLSearchParams();
        for (const k of ["i", "cc", "groupId"] as const) {
          const v = u.searchParams.get(k);
          if (v !== null) p.set(k, v);
        }
        const qs = p.toString();
        return qs ? `?${qs}` : "";
      } catch { return ""; }
    };
    const url =
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X?lang=en&i=999&cc=1858355&groupId=1858355";
    expect(imageViewerUrl({ ark: url }, extractQ)).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:9392-9ZVZ-X?i=999&cc=1858355&groupId=1858355",
    );
  });

  it("returns undefined when neither imageId nor ark is given", () => {
    expect(imageViewerUrl({})).toBeUndefined();
  });

  it("returns undefined for a non-document-image ARK (1:1:)", () => {
    expect(imageViewerUrl({ ark: "ark:/61903/1:1:QVS9-DHDB" })).toBeUndefined();
  });

  it("returns undefined for an invalid imageId", () => {
    expect(imageViewerUrl({ imageId: "not-a-dgs" })).toBeUndefined();
  });

  it("returns undefined for DGS image number 00000 (defensive)", () => {
    expect(imageViewerUrl({ imageId: "004528077_00000" })).toBeUndefined();
  });
});
