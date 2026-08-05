import { describe, it, expect } from "vitest";
import { nextDayStr, previousDayStr, effectiveOrderDateKey } from "./packingCutoff";

describe("nextDayStr", () => {
  it("advances a normal day", () => {
    expect(nextDayStr("2026-08-04")).toBe("2026-08-05");
  });

  it("rolls over a month boundary", () => {
    expect(nextDayStr("2026-01-31")).toBe("2026-02-01");
  });

  it("rolls over a year boundary", () => {
    expect(nextDayStr("2026-12-31")).toBe("2027-01-01");
  });

  it("handles a leap-year February correctly", () => {
    expect(nextDayStr("2024-02-28")).toBe("2024-02-29");
    expect(nextDayStr("2024-02-29")).toBe("2024-03-01");
  });

  it("handles a non-leap-year February correctly", () => {
    expect(nextDayStr("2026-02-28")).toBe("2026-03-01");
  });
});

describe("previousDayStr", () => {
  it("goes back a normal day", () => {
    expect(previousDayStr("2026-08-05")).toBe("2026-08-04");
  });

  it("rolls back over a month boundary", () => {
    expect(previousDayStr("2026-02-01")).toBe("2026-01-31");
  });

  it("rolls back over a year boundary", () => {
    expect(previousDayStr("2027-01-01")).toBe("2026-12-31");
  });

  it("lands on a leap-year February 29 correctly", () => {
    expect(previousDayStr("2024-03-01")).toBe("2024-02-29");
  });

  it("is the exact inverse of nextDayStr", () => {
    for (const d of ["2026-08-04", "2026-01-31", "2026-12-31", "2024-02-29"]) {
      expect(previousDayStr(nextDayStr(d))).toBe(d);
    }
  });
});

describe("effectiveOrderDateKey", () => {
  it("shifts to the next day when the cutoff matches today exactly", () => {
    expect(effectiveOrderDateKey("2026-08-04", "2026-08-04")).toBe("2026-08-05");
  });

  it("stays on today when there is no cutoff set", () => {
    expect(effectiveOrderDateKey("2026-08-04", null)).toBe("2026-08-04");
    expect(effectiveOrderDateKey("2026-08-04", undefined)).toBe("2026-08-04");
  });

  it("stays on today when the cutoff is for a different (past) date", () => {
    expect(effectiveOrderDateKey("2026-08-04", "2026-08-03")).toBe("2026-08-04");
  });

  it("stays on today when the cutoff is for a future date", () => {
    // e.g. packing accidentally closed out a date that hasn't arrived yet —
    // should have no effect until the real date actually reaches it.
    expect(effectiveOrderDateKey("2026-08-04", "2026-08-10")).toBe("2026-08-04");
  });
});
