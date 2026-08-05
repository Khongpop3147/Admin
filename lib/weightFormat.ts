// Converts a kg amount into a Thai "โล-ขีด" (kg / 100g) reading — the way a
// pork vendor actually talks about a small weight difference. "3 ขีด" reads
// naturally here; "0.3 kg" doesn't, for this business. Keeps the exact
// amount rather than rounding to a whole ขีด — a 0.24kg shortfall reads as
// "2.4 ขีด", not rounded down to "2 ขีด".
export function formatKgAsKheed(kg: number): string {
  const totalKheed = Number((Math.abs(kg) * 10).toFixed(1));
  const wholeKg = Math.floor(totalKheed / 10);
  const kheedRemainder = Number((totalKheed - wholeKg * 10).toFixed(1));
  const parts: string[] = [];
  if (wholeKg > 0) parts.push(`${wholeKg} โล`);
  if (kheedRemainder > 0 || parts.length === 0) parts.push(`${kheedRemainder} ขีด`);
  return parts.join(" ");
}
