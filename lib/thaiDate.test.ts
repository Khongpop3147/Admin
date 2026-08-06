import { describe, it, expect } from "vitest";
import { formatDateDDMMYY_BE } from "./thaiDate";

describe("formatDateDDMMYY_BE", () => {
  it("converts to Buddhist Era and pads to DDMMYY", () => {
    expect(formatDateDDMMYY_BE("2026-01-19")).toBe("190169");
  });

  it("pads single-digit day and month", () => {
    expect(formatDateDDMMYY_BE("2026-01-05")).toBe("050169");
  });

  it("handles a year rollover into a new BE century digit pair", () => {
    // 2000 CE -> 2543 BE -> "43"
    expect(formatDateDDMMYY_BE("2000-12-31")).toBe("311243");
  });
});
