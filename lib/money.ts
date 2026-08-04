// Pure money/revenue logic shared between client components and API routes.
// Kept dependency-free (no "use client", no Prisma types) so it's usable
// from both and trivially unit-testable.

export interface AppSettings {
  commissionRate: number;
  returnPenalty: number;
  codFlatFeeThreshold: number;
  codFlatFee: number;
  codDivisor: number;
  codMultiplier: number;
  porkPricePerKg: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  commissionRate: 0.2,
  returnPenalty: 50,
  codFlatFeeThreshold: 2.29,
  codFlatFee: 50,
  codDivisor: 1.5,
  codMultiplier: 20,
  porkPricePerKg: 250,
};

export function calculateCodAmount(weight: number, settings: AppSettings): number {
  if (weight <= settings.codFlatFeeThreshold) return settings.codFlatFee;
  return (weight / settings.codDivisor) * settings.codMultiplier;
}

const VAT_RATE = 0.07;

export function computeVatAmount(price: number, additionalShippingCost: number): number {
  return (price + additionalShippingCost) * VAT_RATE;
}

// price + shipping + VAT(7%) + COD, rounded — the canonical "what actually
// lands in the shop's account" formula. Computed identically at order
// creation (client preview in app/orders/page.tsx) and whenever
// price/shipping/cod change on an existing order (server-side recompute in
// PATCH /api/orders/[id]) — kept as one function so those two call sites
// can never drift apart.
export function computeActualReceivedAmount(
  price: number,
  additionalShippingCost: number,
  codAmount: number
): number {
  const vat = computeVatAmount(price, additionalShippingCost);
  return Math.round(price + additionalShippingCost + vat + codAmount);
}

export interface RevenueOrder {
  platform?: string | null;
  customerName?: string | null;
  codAmount?: number | null;
  codConfirmed?: boolean | null;
  isReturned?: boolean | null;
  price?: number | null;
}

// A shelf placement ("วางขายหน้าร้าน") is just a stock deduction, not a
// recorded sale yet — future POS integration will backfill real figures.
// Keep it out of every money total so revenue numbers aren't inflated by
// stock that hasn't actually sold.
export function isShelfSale(o: RevenueOrder): boolean {
  return o.platform === "Storefront" && o.customerName === "วางขายหน้าร้าน";
}

// With COD the courier collects cash from the customer and remits it back
// later — the shop hasn't actually received anything until that's confirmed
// (via the Packing page's tracking-number reconciliation). Hold the whole
// order's received amount out of revenue totals until then.
export function isCodPending(o: RevenueOrder): boolean {
  return Number(o.codAmount) > 0 && !o.codConfirmed;
}

// A returned ("ตีกลับ") package means the sale never actually happened — the
// pork stock deduction stands, but no revenue or commission should count.
export function isExcludedFromRevenue(o: RevenueOrder): boolean {
  return isShelfSale(o) || o.isReturned === true;
}

// Commission per order: 0 while a shelf placement or a still-pending COD
// (nothing confirmed sold yet), a flat penalty if returned, otherwise
// commissionRate of the product price. Rate/penalty come from Super Admin
// Setting so policy changes don't require a code change.
export function commissionForOrder(o: RevenueOrder, settings: AppSettings): number {
  if (o.isReturned) return -settings.returnPenalty;
  if (isShelfSale(o) || isCodPending(o)) return 0;
  return (Number(o.price) || 0) * settings.commissionRate;
}
