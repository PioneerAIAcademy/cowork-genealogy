import { describe, it, expect } from "vitest";
import { fillWholeFirst, shareBudget } from "../../src/utils/share-budget.js";

/** A settle that takes its whole offer, and records each one. */
const takeOffer = (offers: Array<[number, number]>) => (i: number, offer: number) => {
  offers.push([i, offer]);
  return offer;
};

describe("shareBudget", () => {
  it("meets small claims in full and shares the rest among the large, in the claims' order", () => {
    const offers: Array<[number, number]> = [];
    expect(shareBudget([500, 10, 500, 30], 640, takeOffer(offers))).toEqual([300, 10, 300, 30]);
    expect(offers).toEqual([
      [0, 300],
      [2, 300],
    ]);
  });

  it("meets every claim when they all fit, and settles none", () => {
    const offers: Array<[number, number]> = [];
    expect(shareBudget([5, 7, 3], 15, takeOffer(offers))).toEqual([5, 7, 3]);
    expect(offers).toEqual([]);
  });

  it("passes what a settle leaves of its offer on to the claims after it", () => {
    expect(shareBudget([100, 100], 100, (_i, offer) => offer - 10)).toEqual([40, 50]);
  });

  it("offers nothing, never less, from a budget that is gone or overdrawn", () => {
    const offers: Array<[number, number]> = [];
    expect(shareBudget([0, 5, 5], -20, takeOffer(offers))).toEqual([0, 0, 0]);
    expect(shareBudget([5, 5], 4, (_i, offer) => offer + 6)).toEqual([8, 6]);
    expect(offers).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });
});

describe("fillWholeFirst", () => {
  it("meets claims whole, smallest first, cuts the first that does not fit to what is left, and offers the rest nothing", () => {
    const offers: Array<[number, number]> = [];
    expect(fillWholeFirst([500, 10, 300, 30, 300], 500, takeOffer(offers))).toEqual([0, 10, 300, 30, 160]);
    expect(offers).toEqual([
      [4, 160],
      [0, 0],
    ]);
  });

  it("meets every claim when they all fit, and settles none", () => {
    const offers: Array<[number, number]> = [];
    expect(fillWholeFirst([5, 7, 3], 15, takeOffer(offers))).toEqual([5, 7, 3]);
    expect(offers).toEqual([]);
  });

  it("passes what the cut claim leaves of its offer to no claim after it", () => {
    const offers: Array<[number, number]> = [];
    const settle = (i: number, offer: number) => {
      offers.push([i, offer]);
      return Math.max(0, offer - 10);
    };
    expect(fillWholeFirst([100, 100, 100], 150, settle)).toEqual([100, 40, 0]);
    expect(offers).toEqual([
      [1, 50],
      [2, 0],
    ]);
  });

  it("meets a claim of nothing from a budget that is gone or overdrawn, and offers the rest nothing", () => {
    const offers: Array<[number, number]> = [];
    expect(fillWholeFirst([5, 0, 5], -20, takeOffer(offers))).toEqual([0, 0, 0]);
    expect(offers).toEqual([
      [0, 0],
      [2, 0],
    ]);
  });
});
