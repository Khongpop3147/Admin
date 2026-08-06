import { describe, it, expect } from "vitest";
import { isSlipUsable, sumUsableSlipAmounts, isTotalAmountMatched, hasAnySlipIssue } from "./slipVerification";

describe("isSlipUsable", () => {
  it("is false for null/undefined (no slip yet)", () => {
    expect(isSlipUsable(null)).toBe(false);
    expect(isSlipUsable(undefined)).toBe(false);
  });

  it("is false when the check itself failed", () => {
    expect(isSlipUsable({ success: false, slipAmount: 100 })).toBe(false);
  });

  it("is false for a duplicate slip", () => {
    expect(isSlipUsable({ success: true, isDuplicate: true, slipAmount: 100 })).toBe(false);
  });

  it("is false when the receiving account didn't match", () => {
    expect(isSlipUsable({ success: true, accountMatched: false, slipAmount: 100 })).toBe(false);
  });

  it("is true for a clean, successful, non-duplicate slip", () => {
    expect(isSlipUsable({ success: true, accountMatched: true, slipAmount: 100 })).toBe(true);
  });

  it("is true when accountMatched is null (Thunder couldn't tell)", () => {
    expect(isSlipUsable({ success: true, accountMatched: null, slipAmount: 100 })).toBe(true);
  });
});

describe("sumUsableSlipAmounts", () => {
  it("sums only the usable slips, skipping bad ones", () => {
    const results = [
      { success: true, slipAmount: 100 },
      { success: false, slipAmount: 999 }, // excluded
      { success: true, isDuplicate: true, slipAmount: 999 }, // excluded
      { success: true, slipAmount: 50 },
    ];
    expect(sumUsableSlipAmounts(results)).toBe(150);
  });

  it("returns 0 for an empty or all-null list", () => {
    expect(sumUsableSlipAmounts([])).toBe(0);
    expect(sumUsableSlipAmounts([null, undefined])).toBe(0);
  });

  it("treats a missing slipAmount as 0, not NaN", () => {
    expect(sumUsableSlipAmounts([{ success: true }])).toBe(0);
  });
});

describe("isTotalAmountMatched", () => {
  it("matches an exact total", () => {
    expect(isTotalAmountMatched(500, 500)).toBe(true);
  });

  it("matches within the ±2 baht tolerance", () => {
    expect(isTotalAmountMatched(498, 500)).toBe(true);
    expect(isTotalAmountMatched(502, 500)).toBe(true);
  });

  it("rejects just past the tolerance", () => {
    expect(isTotalAmountMatched(497.99, 500)).toBe(false);
    expect(isTotalAmountMatched(502.01, 500)).toBe(false);
  });

  it("handles the two-partial-payments scenario (300 + 200 = 500)", () => {
    const total = sumUsableSlipAmounts([{ success: true, slipAmount: 300 }, { success: true, slipAmount: 200 }]);
    expect(isTotalAmountMatched(total, 500)).toBe(true);
  });
});

describe("hasAnySlipIssue", () => {
  it("is false when there are no results at all", () => {
    expect(hasAnySlipIssue([])).toBe(false);
    expect(hasAnySlipIssue([null, undefined])).toBe(false);
  });

  it("is false when every slip is clean", () => {
    expect(hasAnySlipIssue([{ success: true }, { success: true }])).toBe(false);
  });

  it("is true if any single slip in the list failed", () => {
    expect(hasAnySlipIssue([{ success: true }, { success: false }])).toBe(true);
  });

  it("is true if any single slip is a duplicate", () => {
    expect(hasAnySlipIssue([{ success: true }, { success: true, isDuplicate: true }])).toBe(true);
  });

  it("is true if any single slip's account didn't match", () => {
    expect(hasAnySlipIssue([{ success: true, accountMatched: false }])).toBe(true);
  });
});
