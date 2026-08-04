import { describe, it, expect } from "vitest";
import { currentBangkokMonth, lastDayOfPreviousMonthRange } from "./porkCleanup";

describe("currentBangkokMonth", () => {
  it("returns a YYYY-MM string", () => {
    expect(currentBangkokMonth()).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("lastDayOfPreviousMonthRange", () => {
  it("covers the last day of a normal (28-day February) previous month", () => {
    const { start, end } = lastDayOfPreviousMonthRange("2026-03");
    expect(start.toISOString()).toBe("2026-02-27T17:00:00.000Z"); // 2026-02-28 00:00 +07:00
    expect(end.toISOString()).toBe("2026-02-28T17:00:00.000Z"); // 2026-03-01 00:00 +07:00
  });

  it("covers the leap day when the previous month is a leap February", () => {
    const { start, end } = lastDayOfPreviousMonthRange("2024-03");
    expect(start.toISOString()).toBe("2024-02-28T17:00:00.000Z"); // 2024-02-29 00:00 +07:00
    expect(end.toISOString()).toBe("2024-02-29T17:00:00.000Z"); // 2024-03-01 00:00 +07:00
  });

  it("handles the year rollover (January's previous month is December of the prior year)", () => {
    const { start, end } = lastDayOfPreviousMonthRange("2026-01");
    expect(start.toISOString()).toBe("2025-12-30T17:00:00.000Z"); // 2025-12-31 00:00 +07:00
    expect(end.toISOString()).toBe("2025-12-31T17:00:00.000Z"); // 2026-01-01 00:00 +07:00
  });

  it("produces an exact 24-hour range", () => {
    const { start, end } = lastDayOfPreviousMonthRange("2026-06");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
