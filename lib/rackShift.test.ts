import { describe, it, expect } from "vitest";
import { sortRackAssignments, computeShiftTargets, syncOrderRackDetails } from "./rackShift";

describe("sortRackAssignments", () => {
  it("sorts by rack number then piece number, not lexically", () => {
    // lexical sort would put A010 before A002; numeric sort must not.
    const sorted = sortRackAssignments([
      { id: "1", rackNo: "A010-1" },
      { id: "2", rackNo: "A002-1" },
    ]);
    expect(sorted.map((r) => r.rackNo)).toEqual(["A002-1", "A010-1"]);
  });

  it("orders pieces within the same rack by piece number", () => {
    const items = [
      { id: "1", rackNo: "A001-3" },
      { id: "2", rackNo: "A001-1" },
      { id: "3", rackNo: "A001-2" },
    ];
    expect(sortRackAssignments(items).map((r) => r.rackNo)).toEqual(["A001-1", "A001-2", "A001-3"]);
  });
});

function items(...rackNos: string[]) {
  return rackNos.map((rackNo, i) => ({ id: `id-${i}-${rackNo}`, rackNo }));
}

describe("computeShiftTargets", () => {
  it("shifting down increments each piece from the start point to the end by 1", () => {
    const sorted = items("A001-1", "A001-2", "A001-3");
    const targets = computeShiftTargets(sorted, "A001-2", "down");
    // Only A001-2 and A001-3 are within [start, end]; A001-1 is untouched.
    const byId = new Map(targets.map((t) => [t.id, t.newName]));
    expect(byId.get("id-1-A001-2")).toBe("A001-3");
    expect(byId.get("id-2-A001-3")).toBe("A001-4");
    expect(targets.length).toBe(2);
  });

  it("shifting down rolls piece 5 over into the next rack's piece 1", () => {
    const sorted = items("A001-5");
    const targets = computeShiftTargets(sorted, "A001-5", "down");
    expect(targets).toEqual([{ id: "id-0-A001-5", newName: "A002-1" }]);
  });

  it("shifting up decrements each piece from the start point to the end by 1", () => {
    // Realistic "shift up" scenario: piece 1 is genuinely missing (that's
    // why you'd shift up), so there's no unshifted piece to collide with.
    const sorted = items("A001-2", "A001-3");
    const targets = computeShiftTargets(sorted, "A001-2", "up");
    const byId = new Map(targets.map((t) => [t.id, t.newName]));
    expect(byId.get("id-0-A001-2")).toBe("A001-1");
    expect(byId.get("id-1-A001-3")).toBe("A001-2");
    expect(targets.length).toBe(2);
  });

  it("shifting up rolls piece 1 over into the previous rack's piece 5", () => {
    const sorted = items("A002-1");
    const targets = computeShiftTargets(sorted, "A002-1", "up");
    expect(targets).toEqual([{ id: "id-0-A002-1", newName: "A001-5" }]);
  });

  it("throws NOT_FOUND: when the start piece doesn't exist in the list", () => {
    const sorted = items("A001-1", "A001-2");
    expect(() => computeShiftTargets(sorted, "A001-9", "down")).toThrow("NOT_FOUND:A001-9");
  });

  it("throws COLLISION_DOWN: when shifting down would land on an unshifted piece", () => {
    // Baseline: shifting A002-4 down to A002-5 with no piece already there
    // is fine.
    expect(() => computeShiftTargets(items("A002-3", "A002-4"), "A002-4", "down")).not.toThrow();

    // Now an unshifted piece (before the start index) already occupies the
    // exact landing spot the shift would produce.
    const manuallySorted = [
      { id: "unshifted", rackNo: "A002-5" },
      { id: "moving", rackNo: "A002-4" },
    ];
    expect(() => computeShiftTargets(manuallySorted, "A002-4", "down")).toThrow("COLLISION_DOWN:A002-5");
  });

  it("throws COLLISION_UP: when shifting up would land on an unshifted piece", () => {
    const manuallySorted = [
      { id: "unshifted", rackNo: "A002-1" },
      { id: "moving", rackNo: "A002-2" },
    ];
    expect(() => computeShiftTargets(manuallySorted, "A002-2", "up")).toThrow("COLLISION_UP:A002-1");
  });

  it("pieces before the start index are never touched", () => {
    const sorted = items("A001-1", "A001-2", "A001-3");
    const targets = computeShiftTargets(sorted, "A001-2", "down");
    expect(targets.some((t) => t.id === "id-0-A001-1")).toBe(false);
  });
});

describe("syncOrderRackDetails", () => {
  it("updates rackNo for entries whose assignmentId matches a shifted target, leaving weight untouched", () => {
    const orders = [
      {
        id: "order-1",
        rackDetails: JSON.stringify([{ assignmentId: "piece-1", rackNo: "A001-1", weight: 1.5 }]),
      },
    ];
    const targetMap = new Map([["piece-1", "A001-2"]]);
    const result = syncOrderRackDetails(orders, targetMap);

    expect(result).toHaveLength(1);
    const parsed = JSON.parse(result[0].newRackDetails);
    expect(parsed).toEqual([{ assignmentId: "piece-1", rackNo: "A001-2", weight: 1.5 }]);
  });

  it("leaves orders that don't reference any shifted piece untouched (not included in the result)", () => {
    const orders = [
      { id: "order-1", rackDetails: JSON.stringify([{ assignmentId: "other-piece", rackNo: "Z001-1", weight: 1 }]) },
    ];
    const targetMap = new Map([["piece-1", "A001-2"]]);
    expect(syncOrderRackDetails(orders, targetMap)).toEqual([]);
  });

  it("updates only the matching entry within an order that references multiple pieces", () => {
    const orders = [
      {
        id: "order-1",
        rackDetails: JSON.stringify([
          { assignmentId: "piece-1", rackNo: "A001-1", weight: 1 },
          { assignmentId: "piece-2", rackNo: "Z999-9", weight: 2 },
        ]),
      },
    ];
    const targetMap = new Map([["piece-1", "A001-2"]]);
    const result = syncOrderRackDetails(orders, targetMap);
    const parsed = JSON.parse(result[0].newRackDetails);
    expect(parsed).toEqual([
      { assignmentId: "piece-1", rackNo: "A001-2", weight: 1 },
      { assignmentId: "piece-2", rackNo: "Z999-9", weight: 2 },
    ]);
  });

  it("skips orders with null or malformed rackDetails without throwing", () => {
    const orders = [
      { id: "order-1", rackDetails: null },
      { id: "order-2", rackDetails: "not valid json" },
      { id: "order-3", rackDetails: JSON.stringify({ not: "an array" }) },
    ];
    const targetMap = new Map([["piece-1", "A001-2"]]);
    expect(syncOrderRackDetails(orders, targetMap)).toEqual([]);
  });
});
