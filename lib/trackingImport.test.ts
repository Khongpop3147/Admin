import { describe, it, expect } from "vitest";
import {
  extractCellDateStr,
  findShipDateInRows,
  filterTrackingRowsToClosestDate,
  buildTrackDateMismatchNote,
  hasTrackDateMismatchNote,
  TrackingRow,
} from "./trackingImport";

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

function row(customerName: string, trackingNumber: string, rowDate: string | null): TrackingRow {
  return { customerName, trackingNumber, rowDate };
}

describe("filterTrackingRowsToClosestDate", () => {
  it("regression: drops a repeat customer's stale rows from earlier ship dates, keeping only today's", () => {
    // A cumulative courier export carries days 7, 8, 9 alongside today (10)
    // for the same repeat customer — only the row for the target date
    // (today) should survive; the older ones must not get comma-joined
    // onto today's order.
    const rows = [
      row("สมชาย", "TRACK-DAY7", "2026-10-07"),
      row("สมชาย", "TRACK-DAY8", "2026-10-08"),
      row("สมชาย", "TRACK-DAY9", "2026-10-09"),
      row("สมชาย", "TRACK-DAY10", "2026-10-10"),
    ];
    const result = filterTrackingRowsToClosestDate(rows, "2026-10-10");
    expect(result).toEqual([row("สมชาย", "TRACK-DAY10", "2026-10-10")]);
  });

  it("keeps every row sharing the closest date — a real multi-box split shipping today", () => {
    const rows = [
      row("สมหญิง", "BOX1", "2026-10-10"),
      row("สมหญิง", "BOX2", "2026-10-10"),
    ];
    const result = filterTrackingRowsToClosestDate(rows, "2026-10-10");
    expect(result.map((r) => r.trackingNumber).sort()).toEqual(["BOX1", "BOX2"]);
  });

  it("picks whichever date is numerically closest when none matches exactly", () => {
    const rows = [
      row("วิชัย", "TRACK-DAY8", "2026-10-08"),
      row("วิชัย", "TRACK-DAY9", "2026-10-09"),
    ];
    // Target is day 10 — day 9 is closer (1 day away) than day 8 (2 days away).
    const result = filterTrackingRowsToClosestDate(rows, "2026-10-10");
    expect(result).toEqual([row("วิชัย", "TRACK-DAY9", "2026-10-09")]);
  });

  it("keeps every row for a customer with no parseable date at all (nothing to compare)", () => {
    const rows = [row("มาลี", "TRACK-A", null), row("มาลี", "TRACK-B", null)];
    const result = filterTrackingRowsToClosestDate(rows, "2026-10-10");
    expect(result.map((r) => r.trackingNumber).sort()).toEqual(["TRACK-A", "TRACK-B"]);
  });

  it("leaves unrelated customers' rows untouched", () => {
    const rows = [
      row("สมชาย", "TRACK-DAY7", "2026-10-07"),
      row("สมชาย", "TRACK-DAY10", "2026-10-10"),
      row("ประยุทธ", "TRACK-OTHER", "2026-10-10"),
    ];
    const result = filterTrackingRowsToClosestDate(rows, "2026-10-10");
    expect(result.map((r) => r.trackingNumber).sort()).toEqual(["TRACK-DAY10", "TRACK-OTHER"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(filterTrackingRowsToClosestDate([], "2026-10-10")).toEqual([]);
  });
});

describe("buildTrackDateMismatchNote", () => {
  it("formats the row date and ship date into a bracketed tag", () => {
    expect(buildTrackDateMismatchNote("2026-10-08", "2026-10-10")).toBe(
      "[Track วันที่ 2026-10-08 ไม่ตรงกำหนดส่ง 2026-10-10]"
    );
  });
});

describe("hasTrackDateMismatchNote", () => {
  it("detects the tag on its own", () => {
    expect(hasTrackDateMismatchNote("[Track วันที่ 2026-10-08 ไม่ตรงกำหนดส่ง 2026-10-10]")).toBe(true);
  });

  it("detects the tag combined with other adminNote content", () => {
    const combined = "หมูในคลังไม่พอดี ขาดอีก 0.3 กก. [Track วันที่ 2026-10-08 ไม่ตรงกำหนดส่ง 2026-10-10]";
    expect(hasTrackDateMismatchNote(combined)).toBe(true);
  });

  it("returns false for unrelated notes or empty input", () => {
    expect(hasTrackDateMismatchNote("ลูกค้าขอให้ห่อพิเศษ")).toBe(false);
    expect(hasTrackDateMismatchNote("[หมายเหตุสลิป: สลิปไม่มี QR โค้ด]")).toBe(false);
    expect(hasTrackDateMismatchNote(null)).toBe(false);
    expect(hasTrackDateMismatchNote(undefined)).toBe(false);
    expect(hasTrackDateMismatchNote("")).toBe(false);
  });
});
