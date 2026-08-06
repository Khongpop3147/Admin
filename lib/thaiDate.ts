// "YYYY-MM-DD" -> "DDMMYY" using the Buddhist Era year (CE + 543), the
// format the shipping-label print sheets use (e.g. 2026-01-19 -> "190169").
export function formatDateDDMMYY_BE(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const yearBE = y + 543;
  return `${String(d).padStart(2, "0")}${String(m).padStart(2, "0")}${String(yearBE).slice(-2)}`;
}
