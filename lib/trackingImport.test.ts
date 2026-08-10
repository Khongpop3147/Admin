import { describe, it, expect } from "vitest";
import { extractCellDateStr, findShipDateInRows } from "./trackingImport";

describe("extractCellDateStr", () => {
  it("reads a Date object via UTC getters, not local ones", () => {
    // A cell for 2026-10-07 comes back from xlsx as UTC midnight that day —
    // must read as 2026-10-07 regardless of the machine's local timezone.
    const cellValue = new Date(Date.UTC(2026, 9, 7));
    expect(extractCellDateStr(cellValue)).toBe("2026-10-07");
  });

  it("parses a plain 'YYYY-MM-DD...' string fallback", () => {
    expect(extractCellDateStr("2026-10-07")).toBe("2026-10-07");
    expect(extractCellDateStr("2026-10-07T00:00:00.000Z")).toBe("2026-10-07");
  });

  it("returns null for empty, unparseable, or invalid input", () => {
    expect(extractCellDateStr("")).toBeNull();
    expect(extractCellDateStr("not a date")).toBeNull();
    expect(extractCellDateStr(undefined)).toBeNull();
    expect(extractCellDateStr(null)).toBeNull();
    expect(extractCellDateStr(new Date(NaN))).toBeNull();
  });
});

describe("findShipDateInRows", () => {
  it("finds the date from the 'กำหนดส่ง' column", () => {
    const rows = [
      { "ชื่อผู้รับ": "A", "กำหนดส่ง": new Date(Date.UTC(2026, 9, 7)) },
      { "ชื่อผู้รับ": "B", "กำหนดส่ง": new Date(Date.UTC(2026, 9, 7)) },
    ];
    expect(findShipDateInRows(rows)).toBe("2026-10-07");
  });

  it("skips a blank header row and finds the first real date", () => {
    const rows = [
      { "ชื่อผู้รับ": "", "กำหนดส่ง": "" },
      { "ชื่อผู้รับ": "A", "กำหนดส่ง": new Date(Date.UTC(2026, 9, 7)) },
    ];
    expect(findShipDateInRows(rows)).toBe("2026-10-07");
  });

  it("returns null when no row has a parseable date (skip the check, don't block)", () => {
    const rows = [{ "ชื่อผู้รับ": "A", "Tracking": "TRACK1" }];
    expect(findShipDateInRows(rows)).toBeNull();
  });

  it("returns null for an empty file", () => {
    expect(findShipDateInRows([])).toBeNull();
  });
});
