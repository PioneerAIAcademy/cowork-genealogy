import { describe, it, expect } from "vitest";
import { toArk, arkToUrl } from "../../src/utils/ark.js";

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
