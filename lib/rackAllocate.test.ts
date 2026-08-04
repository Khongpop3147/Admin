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

  it("prefers a slight over-shoot over an exact-magnitude under-shoot (regression: never under-serve the customer)", () => {
    // No combo hits 3.0 exactly: 2.8 (under by 0.2) vs 3.2 (over by 0.2) —
    // same absolute distance, but the over-shoot must win.
    const racks = [rack("a", 2.8), rack("b", 3.2)];
    const result = computeRackAllocation(racks, 3);
    expect(result.map((r) => r.assignmentId)).toEqual(["b"]);
  });

  it("prefers a larger over-shoot over a smaller under-shoot", () => {
    // 2.9 (under by 0.1) is numerically closer than 3.5 (over by 0.5), but
    // over-shooting must still win regardless of magnitude.
    const racks = [rack("a", 2.9), rack("b", 3.5)];
    const result = computeRackAllocation(racks, 3);
    expect(result.map((r) => r.assignmentId)).toEqual(["b"]);
  });

  it("matches the user's own example: 3kg target lands on ~3.2 or ~3.19, not under", () => {
    const racks = [rack("a", 1.5), rack("b", 1.7), rack("c", 0.8)];
    // 1.5+1.7=3.2 (over by 0.2); 1.5+0.8=2.3, 1.7+0.8=2.5, 1.5+1.7+0.8=4.0 —
    // the best over-target combo is 3.2.
    const result = computeRackAllocation(racks, 3);
    const total = result.reduce((sum, r) => sum + r.weight, 0);
    expect(total).toBeCloseTo(3.2, 5);
    expect(total).toBeGreaterThanOrEqual(3);
  });

  it("minimizes the overage among multiple over-target candidates", () => {
    const racks = [rack("a", 3.1), rack("b", 3.5), rack("c", 4)];
    const result = computeRackAllocation(racks, 3);
    expect(result.map((r) => r.assignmentId)).toEqual(["a"]);
  });

  it("falls back to the closest under-shoot only when nothing can reach the target", () => {
    const racks = [rack("a", 1), rack("b", 0.5)];
    const result = computeRackAllocation(racks, 5);
    // Best possible is everything (1.5kg) — still under, but it's all there is.
    expect(result.map((r) => r.assignmentId).sort()).toEqual(["a", "b"]);
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
