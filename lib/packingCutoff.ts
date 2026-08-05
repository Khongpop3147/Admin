// Pure calendar-string arithmetic (no timezone conversion needed) — the
// caller already has a Bangkok-local "YYYY-MM-DD" string, we just need the
// next calendar day's string, correctly rolling over month/year boundaries.
// JS Date normalizes an out-of-range day (e.g. Feb 29 on a non-leap year's
// "day 29" input would never happen here since d is always a real date to
// start with, but day+1 rolling into the next month is exactly what
// Date.UTC normalizes for us).
export function nextDayStr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

// Once Packing has closed out a day (packingCutoffDate === today's real
// date), any order created for the rest of that same calendar day gets
// numbered as if it were the next day's first order instead of tacking onto
// a batch Packing already considers finished. The cutoff has no effect on
// any other date — it only fires on an exact match, so it's inert again as
// soon as the real calendar date moves past it.
export function effectiveOrderDateKey(todayDateKey: string, packingCutoffDate: string | null | undefined): string {
  return packingCutoffDate === todayDateKey ? nextDayStr(todayDateKey) : todayDateKey;
}
