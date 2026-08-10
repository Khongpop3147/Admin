// Extracts the calendar date (YYYY-MM-DD) a courier's tracking-number
// export file is for, so the bulk import can refuse to run when it doesn't
// match the date currently selected in Packing — without this, a same-named
// customer on the wrong day could silently get someone else's tracking
// number (the import itself has no other way to know which day a file is
// for; see app/packing/page.tsx's handleImportTracking).

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
