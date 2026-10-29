import { describe, it, expect, vi, beforeEach } from "vitest";

// Offline: FamilySearch's spelling of a supplied value comes from this stub.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, familySearchFullName: vi.fn(async (name: string) => name) };
});

import { judgeSupplied, keptSupplied, placeAnswer, unconfirmedByText } from "../../src/utils/place-verdict.js";
import { familySearchFullName } from "../../src/utils/place-resolver.js";

const spelled = vi.mocked(familySearchFullName);
beforeEach(() => {
  spelled.mockReset();
  spelled.mockImplementation(async (name: string) => name);
});

describe("unconfirmedByText: the place text confirms a standard place", () => {
  it.each([
    // The country check judges the pair, so the text need not name it.
    ["Boston, Massachusetts, United States", "Springfield, Sangamon, Illinois, United States"],
    // One word: the resolver's one-word rule judges it, here its top hit for a
    // word neither on the list nor spelled in the answer.
    ["Porto", "Porto Moniz, Madeira, Portugal"],
    ["Ky", "Kentucky, United States"],
    ["Birmingham", "Birmingham, Transvaal, South Africa"],
    // The one-word list's own entry for the text, case and accents aside.
    ["W. Va.", "West Virginia, United States"],
    ["W. Va.", "west virginia, united states"],
    ["State of Ohio", "Ohio, United States"],
    ["'s Gravenhage", "The Hague, South Holland, Netherlands"],
    // The standard place's own name is one of the text's comma parts.
    ["412 Vine St, Cincinnati", "Cincinnati, Hamilton, Ohio, United States"],
    ["Schuylkill County, Pennsylvania", "Schuylkill, Pennsylvania, United States"],
    ["Lidečko, Moravia", "Lidečko, Ungarisch Brod, Moravia"],
  ])("%j confirms %j", (place, standardPlace) => {
    expect(unconfirmedByText(place, standardPlace)).toBeNull();
  });

  it.each([
    ["with his daughter", "Hawaii, United States"],
    ["at the home of her daughter", "Of, Trabzon, Türkiye"],
    ["at the home of her daughter, Mrs. John Smith", "Of, Trabzon, Türkiye"],
    ["Paxcroft, Wiltshire", "Trowbridge, Wiltshire, England, United Kingdom"],
    // A list text whose answer is not the list's entry is judged by name.
    ["W. Va.", "Virginia, United States"],
  ])("%j does not confirm %j", (place, standardPlace) => {
    expect(unconfirmedByText(place, standardPlace)).toBe(
      "could not be confirmed, as the text names neither a country nor that place",
    );
  });

  it("refuses a standard place naming no known country when the text's last part names one", () => {
    expect(unconfirmedByText("March, Cambridgeshire, England", "March, Transvaal, South Africa")).toBe(
      "does not name the country the text names",
    );
    expect(unconfirmedByText("Austria", "Bohemia")).toBe("does not name the country the text names");
  });
});

describe("keptSupplied: what a writer keeps of a supplied standard_place", () => {
  it("keeps it in FamilySearch's spelling, not as typed", async () => {
    spelled.mockResolvedValueOnce("Santo António, Funchal, Madeira, Portugal");
    expect(await keptSupplied("Santo Antonio, Funchal", "santo antonio, funchal, madeira, portugal")).toEqual({
      kept: "Santo António, Funchal, Madeira, Portugal",
    });
    expect(spelled).toHaveBeenCalledWith("santo antonio, funchal, madeira, portugal");
  });

  it("keeps it as written when FamilySearch's search failed", async () => {
    spelled.mockResolvedValueOnce(null);
    expect(await keptSupplied("Funchal, Madeira", "Funchal, Madeira, Portugal")).toEqual({ kept: "Funchal, Madeira, Portugal" });
  });

  it("keeps none FamilySearch has no place of", async () => {
    spelled.mockResolvedValueOnce(false);
    expect(await keptSupplied("Funchal, Madeira", "Funchal, Madeira, Portugal")).toEqual({
      why: "FamilySearch's place standard has no place of that name",
    });
  });

  it("keeps none for a phrase that names no place, asking FamilySearch nothing", async () => {
    expect(await keptSupplied("with his daughter", "Hawaii, United States")).toEqual({
      why: "it could not be confirmed, as the text names neither a country nor that place",
    });
    expect(await keptSupplied("Same House,", "Same, Manufahi, Timor-Leste")).toEqual({ why: "'Same House,' names no place" });
    expect(spelled).not.toHaveBeenCalled();
  });
});

describe("placeAnswer: the engine's own answer", () => {
  it("drops a lookup the text does not confirm, naming it", async () => {
    expect(await placeAnswer("with his daughter", [], async () => "Hawaii, United States")).toEqual({
      standardPlace: null,
      why: "unconfirmed",
      dropped: "Hawaii, United States",
      reason:
        "the engine's place lookup answer 'Hawaii, United States' could not be confirmed, as the text names neither a " +
        "country nor that place",
    });
  });

  it("keeps a lookup the text confirms, and FamilySearch's own value for the text on the cited record unjudged", async () => {
    expect(await placeAnswer("W. Va.", [], async () => "West Virginia, United States")).toEqual({
      standardPlace: "West Virginia, United States",
      from: "lookup",
    });
    expect(await placeAnswer("with his daughter", ["Hawaii, United States"], async () => null)).toEqual({
      standardPlace: "Hawaii, United States",
      from: "record",
    });
  });
});

describe("judgeSupplied", () => {
  it("stores FamilySearch's spelling of a kept value with no warning, asking for no answer", async () => {
    spelled.mockResolvedValueOnce("Santo António, Funchal, Madeira, Portugal");
    const answer = vi.fn();
    expect(await judgeSupplied("Santo Antonio, Funchal", "Santo Antonio, Funchal, Madeira, Portugal", answer)).toEqual({
      standardPlace: "Santo António, Funchal, Madeira, Portugal",
    });
    expect(answer).not.toHaveBeenCalled();
  });
});
