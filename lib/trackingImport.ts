// Extracts the calendar date (YYYY-MM-DD) a courier's tracking-number
// export file is for, so the bulk import can refuse to run when it doesn't
// match the date currently selected in Packing — without this, a same-named
// customer on the wrong day could silently get someone else's tracking
// number (the import itself has no other way to know which day a file is
// for; see app/packing/page.tsx's handleImportTracking).

import { normalizeCustomerName } from "./nameMatch";

// xlsx hands back a real JS Date (at UTC midnight for that calendar day)
// when the workbook is read with cellDates:true — read via UTC getters, not
// local ones, so the extracted day doesn't shift depending on the server's
// timezone. Falls back to parsing a plain "YYYY-MM-DD..." string in case a
// source file stores this as text instead of a real date cell.
export function extractCellDateStr(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return null;
}

// Every real export observed so far carries exactly one "กำหนดส่ง" date
// across the whole batch — returns the first valid one found, or null if
// the column is missing/unparseable so the caller can skip the check
// entirely rather than block on something it can't actually verify.
export function findShipDateInRows(rows: Record<string, unknown>[]): string | null {
  for (const row of rows) {
    const found = extractCellDateStr(row["กำหนดส่ง"]);
    if (found) return found;
  }
  return null;
}

export interface TrackingRow {
  customerName: string;
  trackingNumber: string;
  // This row's own "กำหนดส่ง" date, or null if that cell was missing/
  // unparseable for this particular row.
  rowDate: string | null;
}

function daysDistance(dateStr: string | null, targetDateStr: string): number {
  if (!dateStr) return Number.POSITIVE_INFINITY;
  const target = new Date(`${targetDateStr}T00:00:00Z`).getTime();
  const actual = new Date(`${dateStr}T00:00:00Z`).getTime();
  return Math.abs(actual - target);
}

// A courier's export can be cumulative — carrying rows from several
// earlier ship dates alongside today's, not just today's — so a repeat
// customer can appear more than once with a DIFFERENT date per row. The
// bulk-tracking API name-matches purely by customer, and comma-joins every
// row that matches the same order (built to handle a real multi-box split,
// where several rows for one order are legitimate). Without filtering
// first, a stale row from days ago gets joined onto today's tracking
// number right alongside it. Keeps only, per customer, the row(s) whose
// date is closest to the target ship date — ties (multiple rows sharing
// that same closest date, i.e. a genuine multi-box split shipping today)
// all survive together so that join still works; only rows for a FARTHER
// date get dropped. A customer with no dated rows at all keeps all of
// them, since there's nothing to compare.
export function filterTrackingRowsToClosestDate(rows: TrackingRow[], targetDateStr: string): TrackingRow[] {
  const byCustomer = new Map<string, TrackingRow[]>();
  for (const row of rows) {
    const key = normalizeCustomerName(row.customerName);
    if (!byCustomer.has(key)) byCustomer.set(key, []);
    byCustomer.get(key)!.push(row);
  }

  const result: TrackingRow[] = [];
  for (const customerRows of byCustomer.values()) {
    const minDistance = Math.min(...customerRows.map((r) => daysDistance(r.rowDate, targetDateStr)));
    result.push(...customerRows.filter((r) => daysDistance(r.rowDate, targetDateStr) === minDistance));
  }
  return result;
}
