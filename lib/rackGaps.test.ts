import { describe, it, expect } from "vitest";
import { findMissingRackCodes } from "./rackGaps";

function rack(rackNo: string, isUsedUp = false) {
  return { rackNo, isUsedUp };
}

function loinRack(rackNo: string, isUsedUp = false) {
  return { rackNo, isUsedUp, productType: "PORK_LOIN" };
}

describe("findMissingRackCodes", () => {
  it("returns nothing when the sequence is complete", () => {
    const racks = ["A001-1", "A001-2", "A001-3", "A001-4", "A001-5", "A002-1"].map((n) => rack(n));
    expect(findMissingRackCodes(racks)).toEqual([]);
  });

  it("finds a single missing piece within one rack", () => {
    const racks = ["A001-1", "A001-2", "A001-4", "A001-5"].map((n) => rack(n));
    expect(findMissingRackCodes(racks)).toEqual(["A001-3"]);
  });

  it("finds a whole missing rack spanning a rack-number boundary", () => {
    // A005 is entirely missing between A004 and A006
    const racks = ["A004-1", "A004-2", "A004-3", "A004-4", "A004-5", "A006-1"].map((n) => rack(n));
    expect(findMissingRackCodes(racks)).toEqual(["A005-1", "A005-2", "A005-3", "A005-4", "A005-5"]);
  });

  it("does not flag a gap of 10 or more (treated as an intentional new batch, not a loss)", () => {
    const racks = ["A001-1", "A005-1"].map((n) => rack(n)); // gap of 20 linear positions
    expect(findMissingRackCodes(racks)).toEqual([]);
  });

  it("regression: detects a gap sitting exactly at the boundary between two different owners' lists", () => {
    // Reproduces the real production bug: Central's list ends at L111-5,
    // Admin2's list starts at L112-2 — L112-1 is missing but neither
    // owner's own list has a neighboring entry to notice it.
    const central = ["L109-1", "L109-2", "L109-3", "L109-4", "L109-5", "L110-1", "L110-2", "L110-3", "L110-4", "L110-5", "L111-1", "L111-2", "L111-3", "L111-4", "L111-5"].map((n) => rack(n));
    const admin2 = ["L112-2", "L112-3", "L112-4", "L112-5", "L113-1"].map((n) => rack(n));
    expect(findMissingRackCodes([...central, ...admin2])).toEqual(["L112-1"]);
  });

  it("regression: still detects a gap even when the neighboring piece is already sold out (isUsedUp)", () => {
    // Reproduces the second real production bug: L112-2 (the neighbor right
    // after the gap) is isUsedUp:true — this must not suppress detection.
    const racks = [
      rack("L111-5", false),
      rack("L112-2", true),
      rack("L112-3", true),
      rack("L112-4", true),
      rack("L112-5", true),
    ];
    expect(findMissingRackCodes(racks)).toEqual(["L112-1"]);
  });

  it("ignores pieces with a different letter prefix when looking for neighbors", () => {
    const racks = ["A001-1", "B001-1"].map((n) => rack(n));
    expect(findMissingRackCodes(racks)).toEqual([]);
  });

  it("handles multiple independent gaps across the whole list", () => {
    const racks = ["A001-1", "A001-3", "A001-5", "A002-2"].map((n) => rack(n));
    // A001-2, A001-4 missing within A001; A002-1 missing before A002-2
    expect(findMissingRackCodes(racks)).toEqual(["A001-2", "A001-4", "A002-1"]);
  });

  it("returns an empty array for an empty or single-item list", () => {
    expect(findMissingRackCodes([])).toEqual([]);
    expect(findMissingRackCodes([rack("A001-1")])).toEqual([]);
  });

  it("finds a single missing piece within a prefixed-format (PORK_LOIN) rack", () => {
    const racks = ["L-A001-1", "L-A001-2", "L-A001-4", "L-A001-5"].map((n) => loinRack(n));
    expect(findMissingRackCodes(racks)).toEqual(["L-A001-3"]);
  });

  it("finds a whole missing prefixed-format rack spanning a rack-number boundary", () => {
    const racks = ["L-A004-1", "L-A004-2", "L-A004-3", "L-A004-4", "L-A004-5", "L-A006-1"].map((n) => loinRack(n));
    expect(findMissingRackCodes(racks)).toEqual([
      "L-A005-1",
      "L-A005-2",
      "L-A005-3",
      "L-A005-4",
      "L-A005-5",
    ]);
  });

  it("regression: a mixed list of classic and prefixed racks detects each product's own gap independently, with no cross-contamination", () => {
    const classicWithGap = ["A001-1", "A001-2", "A001-4", "A001-5"].map((n) => rack(n)); // missing A001-3
    const prefixedWithGap = ["L-A001-1", "L-A001-2", "L-A001-4", "L-A001-5"].map((n) => loinRack(n)); // missing L-A001-3
    const result = findMissingRackCodes([...classicWithGap, ...prefixedWithGap]);
    expect(result.sort()).toEqual(["A001-3", "L-A001-3"].sort());
  });
});
