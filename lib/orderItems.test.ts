import { describe, it, expect } from "vitest";
import { getEffectiveItems, sumItemsWeight, sumItemsPieceCount, sumItemsPrice } from "./orderItems";

describe("getEffectiveItems", () => {
  it("passes through real items unchanged when present", () => {
    const items = [
      { productType: "PORK", weight: 1.5, pieceCount: 3, price: 375 },
      { productType: "PORK_LOIN", weight: 1, pieceCount: 2, price: 350 },
    ];
    const order = { items, crispyPorkWeight: "2.5", crispyPorkPiece: "5", price: 725 };
    expect(getEffectiveItems(order)).toBe(items);
  });

  it("synthesizes a single implicit PORK line from legacy flat fields when items is empty", () => {
    const order = { items: [], crispyPorkWeight: "1.5", crispyPorkPiece: "3", price: 375 };
    expect(getEffectiveItems(order)).toEqual([
      { productType: "PORK", weight: 1.5, pieceCount: 3, price: 375 },
    ]);
  });

  it("synthesizes from legacy fields when items is missing/null (pre-feature order)", () => {
    const order = { crispyPorkWeight: "2", crispyPorkPiece: "4", price: 500 };
    expect(getEffectiveItems(order)).toEqual([
      { productType: "PORK", weight: 2, pieceCount: 4, price: 500 },
    ]);
  });

  it("defaults missing price to 0 and missing pieceCount to null", () => {
    const order = { crispyPorkWeight: "1", crispyPorkPiece: null, price: null };
    expect(getEffectiveItems(order)).toEqual([
      { productType: "PORK", weight: 1, pieceCount: null, price: 0 },
    ]);
  });

  it("returns an empty array for a malformed or missing legacy weight", () => {
    expect(getEffectiveItems({ crispyPorkWeight: null })).toEqual([]);
    expect(getEffectiveItems({ crispyPorkWeight: "not a number" })).toEqual([]);
    expect(getEffectiveItems({ crispyPorkWeight: "0" })).toEqual([]);
  });
});

describe("sumItemsWeight / sumItemsPieceCount / sumItemsPrice", () => {
  const items = [
    { productType: "PORK", weight: 1.5, pieceCount: 3, price: 375 },
    { productType: "PORK_LOIN", weight: 1, pieceCount: 2, price: 350 },
  ];

  it("sums weight across items", () => {
    expect(sumItemsWeight(items)).toBe(2.5);
  });

  it("sums piece count across items", () => {
    expect(sumItemsPieceCount(items)).toBe(5);
  });

  it("sums price across items", () => {
    expect(sumItemsPrice(items)).toBe(725);
  });

  it("returns null piece count and 0 weight/price for an empty list", () => {
    expect(sumItemsPieceCount([])).toBeNull();
    expect(sumItemsWeight([])).toBe(0);
    expect(sumItemsPrice([])).toBe(0);
  });
});
