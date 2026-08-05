import { describe, it, expect } from "vitest";
import { computeRackAllocation, AllocatableRack } from "./rackAllocate";

function rack(id: string, remainingWeight: number, overrides: Partial<AllocatableRack> = {}): AllocatableRack {
  return { id, rackNo: id, remainingWeight, isUsedUp: false, createdAt: "2026-01-01T00:00:00Z", ...overrides };
}

describe("computeRackAllocation", () => {
  it("picks an exact match when one exists", () => {
    const racks = [rack("a", 1), rack("b", 5), rack("c", 3)];
    const result = computeRackAllocation(racks, 3);
    expect(result.map((r) => r.assignmentId).sort()).toEqual(["c"]);
  });

  it("prefers a slight over-shoot over an exact-magnitude under-shoot (regression: round up on ties)", () => {
    // No combo hits 3.0 exactly: 2.8 (under by 0.2) vs 3.2 (over by 0.2) —
    // same absolute distance, but the over-shoot must win.
    const racks = [rack("a", 2.8), rack("b", 3.2)];
    const result = computeRackAllocation(racks, 3);
    expect(result.map((r) => r.assignmentId)).toEqual(["b"]);
  });

  it("prefers an over-target candidate even when an under-target one is numerically closer", () => {
    // Target 1.4: a=1.35 (under by only 0.05) is much closer than
    // b=1.55 (over by 0.15) — but meeting/exceeding target always wins
    // over falling short, regardless of which is closer.
    const racks = [rack("a", 1.35), rack("b", 1.55)];
    const result = computeRackAllocation(racks, 1.4);
    expect(result.map((r) => r.assignmentId)).toEqual(["b"]);
  });

  it("caps the acceptable overage at MAX_WEIGHT_DEVIATION_KG (0.2kg) — beyond that, prefers falling short instead", () => {
    // 2.9 (under by 0.1) is numerically closer than 3.5 (over by 0.5), and
    // 0.5 is well past the 0.2kg tolerance, so the under-shoot wins here.
    const racks = [rack("a", 2.9), rack("b", 3.5)];
    const result = computeRackAllocation(racks, 3);
    expect(result.map((r) => r.assignmentId)).toEqual(["a"]);
  });

  it("still rounds up right at the cap boundary (exactly 0.2kg over vs 0.3kg under)", () => {
    const racks = [rack("a", 2.7), rack("b", 3.2)];
    const result = computeRackAllocation(racks, 3);
    expect(result.map((r) => r.assignmentId)).toEqual(["b"]);
  });

  it("also caps the acceptable shortfall at MAX_WEIGHT_DEVIATION_KG — beyond that, gives nothing rather than a mismatched amount", () => {
    // Only 1.5kg achievable at all (1 + 0.5), 3.5kg short of a 5kg target —
    // way outside the 0.2kg tolerance, so nothing gets allocated.
    const racks = [rack("a", 1), rack("b", 0.5)];
    const result = computeRackAllocation(racks, 5);
    expect(result).toEqual([]);
  });

  it("returns nothing rather than break the tolerance, when the only pieces available are all too far over", () => {
    // The user's own example: asked for 1.4kg, only a 1.7kg piece exists
    // (0.3kg over — past the 0.2kg tolerance) and there's no smaller piece
    // to fall back to. Better to give nothing (flagged as fully short
    // upstream) than force a badly-mismatched piece on the order.
    const racks = [rack("a", 1.7)];
    const result = computeRackAllocation(racks, 1.4);
    expect(result).toEqual([]);
  });

  it("still returns nothing when several available pieces are all past the cap", () => {
    const racks = [rack("a", 1.7), rack("b", 1.8), rack("c", 2.5)];
    const result = computeRackAllocation(racks, 1.4);
    expect(result).toEqual([]);
  });

  it("matches the user's own example: 3kg target lands on ~3.2, not under", () => {
    const racks = [rack("a", 1.5), rack("b", 1.7), rack("c", 0.8)];
    // 1.5+1.7=3.2 (over by 0.2, within tolerance) is the only combo inside
    // ±0.2kg of the target — every other combo is either too far under or
    // too far over.
    const result = computeRackAllocation(racks, 3);
    const total = result.reduce((sum, r) => sum + r.weight, 0);
    expect(total).toBeCloseTo(3.2, 5);
    expect(total).toBeGreaterThanOrEqual(3);
  });

  it("minimizes the deviation among multiple in-tolerance candidates", () => {
    const racks = [rack("a", 3.1), rack("b", 3.5), rack("c", 4)];
    const result = computeRackAllocation(racks, 3);
    expect(result.map((r) => r.assignmentId)).toEqual(["a"]);
  });

  it("excludes used-up and zero-weight pieces", () => {
    const racks = [rack("a", 3, { isUsedUp: true }), rack("b", 0), rack("c", 3)];
    const result = computeRackAllocation(racks, 3);
    expect(result.map((r) => r.assignmentId)).toEqual(["c"]);
  });

  it("returns an empty array when there are no available pieces", () => {
    expect(computeRackAllocation([], 3)).toEqual([]);
  });
});
