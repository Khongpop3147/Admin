// Converts a kg amount into a Thai "โล-ขีด" (kg / 100g) reading — the way a
// pork vendor actually talks about a small weight difference. "3 ขีด" reads
// naturally here; "0.3 kg" doesn't, for this business.
export function formatKgAsKheed(kg: number): string {
  const totalKheed = Math.round(Math.abs(kg) * 10);
  const wholeKg = Math.floor(totalKheed / 10);
  const kheed = totalKheed % 10;
  const parts: string[] = [];
  if (wholeKg > 0) parts.push(`${wholeKg} โล`);
  if (kheed > 0 || parts.length === 0) parts.push(`${kheed} ขีด`);
  return parts.join(" ");
}
