import { describe, it, expect } from "vitest";
import {
  decodeWikiTitle,
  homeTitleShape,
  typeWordFits,
} from "../../src/utils/wiki-home-title.js";

// Titles and Places API types are the live values measured 2026-10-12.
const parts = (sp: string) => sp.split(",").map((s) => s.trim());

describe("homeTitleShape", () => {
  it("accepts a county page, carrying its type word", () => {
    const shape = homeTitleShape(
      "Schuylkill County, Pennsylvania Genealogy",
      parts("Schuylkill, Pennsylvania, United States")
    );
    expect(shape).toEqual({ ok: true, typeWord: "county", head: "Schuylkill County, Pennsylvania" });
  });

  it("accepts a page with no type word, needing no type lookup", () => {
    expect(
      homeTitleShape("Gloucestershire, England Genealogy", parts("Gloucestershire, England, United Kingdom"))
    ).toEqual({ ok: true, typeWord: null, head: "Gloucestershire, England" });
  });

  it("decodes a percent-encoded title and keeps its diacritics", () => {
    const shape = homeTitleShape(
      "Barseb%C3%A4ck Parish, Malm%C3%B6hus, Sweden Genealogy",
      parts("Barsebäck, Malmöhus, Sweden")
    );
    expect(shape).toEqual({ ok: true, typeWord: "parish", head: "Barsebäck Parish, Malmöhus, Sweden" });
  });

  it("reads the type word out of a parenthesised phrase", () => {
    const shape = homeTitleShape(
      "Baltimore (Independent City), Maryland Genealogy",
      parts("Baltimore, Maryland, United States")
    );
    expect(shape.ok && shape.typeWord).toBe("city");
  });

  it("rejects a page that is not a home page", () => {
    expect(
      homeTitleShape("St. Louis City, Missouri Vital Records", parts("St. Louis, Missouri, United States")).ok
    ).toBe(false);
  });

  it("rejects a leaf that only prefixes a longer name", () => {
    expect(
      homeTitleShape("Gloucestershire, England Genealogy", parts("Gloucester, Gloucestershire, England, United Kingdom")).ok
    ).toBe(false);
  });

  it("rejects the parent's page and other places' pages", () => {
    const sp = parts("Barsebäck, Malmöhus, Sweden");
    expect(homeTitleShape("Malm%C3%B6hus County, Sweden Genealogy", sp).ok).toBe(false);
    const kings = parts("Kings, New York, United States");
    expect(homeTitleShape("Brooklyn Borough, New York Genealogy", kings).ok).toBe(false);
    expect(homeTitleShape("New York, United States Genealogy", kings).ok).toBe(false);
  });

  it("rejects a same-named state's page for a county (the silent-200 trap)", () => {
    expect(
      homeTitleShape("Washington, United States Genealogy", parts("Washington, Pennsylvania, United States")).ok
    ).toBe(false);
  });

  it("rejects a same-named city's page for a county, and accepts it for the city", () => {
    const title = "Los Angeles, Los Angeles County, California Genealogy";
    expect(homeTitleShape(title, parts("Los Angeles, California, United States")).ok).toBe(false);
    expect(homeTitleShape(title, parts("Los Angeles, Los Angeles, California, United States"))).toEqual({
      ok: true,
      typeWord: null,
      head: "Los Angeles, Los Angeles County, California",
    });
  });

  it("accepts the county's own page, whose first container is the state", () => {
    expect(
      homeTitleShape("Los Angeles County, California Genealogy", parts("Los Angeles, California, United States"))
    ).toEqual({ ok: true, typeWord: "county", head: "Los Angeles County, California" });
  });

  it("rejects a parent that only prefixes a longer container name", () => {
    expect(
      homeTitleShape("Springfield, Sangamonville, Illinois Genealogy", parts("Springfield, Sangamon, Illinois, United States")).ok
    ).toBe(false);
  });

  it("rejects a same-named place in another state", () => {
    expect(
      homeTitleShape("Springfield, Massachusetts Genealogy", parts("Springfield, Sangamon, Illinois, United States")).ok
    ).toBe(false);
  });
});

describe("typeWordFits", () => {
  it("separates the St. Louis city/county near-tie by the Places API type", () => {
    expect(typeWordFits("city", "Independent City")).toBe(true);
    expect(typeWordFits("county", "Independent City")).toBe(false);
    expect(typeWordFits("county", "County")).toBe(true);
    expect(typeWordFits("city", "County")).toBe(false);
  });

  it("lets a County-typed place take the wiki's Parish or Borough", () => {
    expect(typeWordFits("parish", "County")).toBe(true); // East Baton Rouge, Louisiana
    expect(typeWordFits("borough", "County")).toBe(true);
    expect(typeWordFits("parish", "Lutheran Parish")).toBe(true); // Barsebäck
  });

  it("rejects every type word when the type is unknown", () => {
    expect(typeWordFits("county", null)).toBe(false);
  });
});

describe("decodeWikiTitle", () => {
  it("leaves a malformed escape alone rather than throwing", () => {
    expect(decodeWikiTitle("100% Genealogy")).toBe("100% Genealogy");
  });
});
