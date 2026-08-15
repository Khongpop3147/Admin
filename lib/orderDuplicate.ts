// Strips common Thai honorific prefixes and whitespace so "คุณเมธานันท์" and
// "เมธานันท์" (same person, typed differently by different admins) are
// recognized as the same customer for duplicate-order detection.
export function normalizeCustomerName(name: string): string {
  return name
    .trim()
    .replace(/^(คุณ|นางสาว|นาย|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.)\s*/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export interface RecentOrderForDuplicateCheck {
  customerName: string;
  crispyPorkWeight: string | null;
}

// Only flag as a risky duplicate when BOTH the name AND the pork weight
// match an existing order placed within the last 7 days (the caller pre-
// filters recentOrders to that window) — same name + weight showing up
// again on day 8+ is treated as a legitimate repeat order, not an
// accidental double-submit.
export function findDuplicateOrder<T extends RecentOrderForDuplicateCheck>(
  newCustomerName: string,
  newCrispyPorkWeight: string | number | undefined,
  recentOrders: T[]
): T | undefined {
  const normalizedNewName = normalizeCustomerName(newCustomerName);
  const currentWeight = parseFloat(String(newCrispyPorkWeight));
  if (isNaN(currentWeight)) return undefined;
  return recentOrders.find((o) => {
    const w = parseFloat(o.crispyPorkWeight || "");
    return (
      !isNaN(w) &&
      Math.abs(w - currentWeight) < 0.001 &&
      normalizeCustomerName(o.customerName) === normalizedNewName
    );
  });
}

export interface RecentPendingStockForDuplicateCheck {
  customerName: string;
  totalWeightKg: number;
}

// Same "name + weight, within 7 days" duplicate check as findDuplicateOrder
// above, adapted for "ลูกค้ารอหมู" entries — those don't have a single flat
// weight field, so the caller sums each entry's line items into
// totalWeightKg first (see app/api/pending-stock/route.ts).
export function findDuplicatePendingStock<T extends RecentPendingStockForDuplicateCheck>(
  newCustomerName: string,
  newTotalWeightKg: number,
  recentEntries: T[]
): T | undefined {
  const normalizedNewName = normalizeCustomerName(newCustomerName);
  return recentEntries.find(
    (e) =>
      Math.abs(e.totalWeightKg - newTotalWeightKg) < 0.001 &&
      normalizeCustomerName(e.customerName) === normalizedNewName
  );
}
