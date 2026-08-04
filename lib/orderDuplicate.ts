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
// match an existing order placed within the last 3 days (the caller pre-
// filters recentOrders to that window) — same name + weight showing up
// again on day 4+ is treated as a legitimate repeat order, not an
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
