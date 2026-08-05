import { describe, it, expect } from "vitest";
import { formatKgAsKheed } from "./weightFormat";

describe("formatKgAsKheed", () => {
  it("formats a plain ขีด amount", () => {
    expect(formatKgAsKheed(0.3)).toBe("3 ขีด");
  });

  it("formats a whole-kg amount with no leftover ขีด", () => {
    expect(formatKgAsKheed(2)).toBe("2 โล");
  });

  it("formats a mixed โล + ขีด amount", () => {
    expect(formatKgAsKheed(1.3)).toBe("1 โล 3 ขีด");
  });

  it("keeps the exact fractional ขีด instead of rounding to a whole one", () => {
    expect(formatKgAsKheed(1.25)).toBe("1 โล 2.5 ขีด");
    expect(formatKgAsKheed(0.24)).toBe("2.4 ขีด");
    expect(formatKgAsKheed(0.03)).toBe("0.3 ขีด");
  });

  it("handles zero", () => {
    expect(formatKgAsKheed(0)).toBe("0 ขีด");
  });

  it("ignores sign — always reports a positive magnitude", () => {
    expect(formatKgAsKheed(-0.3)).toBe("3 ขีด");
  });
});
