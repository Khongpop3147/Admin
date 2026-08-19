import { isShelfSale } from "./money";
import { effectiveOrderDateKey } from "./packingCutoff";

// Shared by POST /api/orders (real-time Order Entry, which still does its
// own rack-stock deduction right after this) and the "ลูกค้ารอหมู" →
// "ส่งไป packing" conversion (app/api/pending-stock/[id]/send-to-packing),
// whose stock was already deducted earlier when the admin picked pieces via
// assign-stock — both need the identical daily-counter/cutoff/order-row
// logic, just not always followed by a deduction step. Keeping this in one
// place means the two can never drift apart on how an order number or
// entryDate gets decided.

export interface CreateOrderInput {
  customerName: string;
  platform?: string | null;
  socialMediaName?: string | null;
  crispyPorkPiece?: string | null;
  crispyPorkWeight?: string | null;
  packedPork?: string | null;
  promotion?: string | null;
  price?: number | null;
  shippingMethod?: string | null;
  additionalShippingCost?: number | null;
  codAmount?: number | null;
  actualReceivedAmount?: number | null;
  transferSlip?: string | null;
  paymentStatus?: string | null;
  customerAddress?: string | null;
  customerPhone?: string | null;
  customerZip?: string | null;
  needsTaxInvoice?: boolean;
  orderStatus?: string | null;
  rackDetails?: string | null;
  sellerName?: string | null;
  trackingNumber?: string | null;
  adminNote?: string | null;
  entryDate?: string | null;
  packingEntryDate?: string | null;
  extraSlipUrls?: string[];
  items?: { productType: string; weight: number; pieceCount: number | null; price: number; pricePerKg: number | null }[];
  isClaim?: boolean;
}

// A real 0 (from a claim order's own force-zero) counts as provided; an
// untouched form field ("", null, undefined) doesn't — see the callers
// below for why the difference matters.
function isProvidedNumber(v: unknown): boolean {
  return v !== null && v !== undefined && v !== "";
}

// `tx` is a Prisma transaction client — typed loosely (matching this
// codebase's existing convention for Prisma where-clause objects) since the
// generated transaction-client type isn't exported for easy reuse here.
export async function createOrderRecord(tx: any, input: CreateOrderInput) {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const todayDateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const baseDateKey = typeof input.entryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.entryDate) ? input.entryDate : todayDateKey;

  const settings = await tx.settings.findUnique({ where: { id: "singleton" } });
  const dateKey = effectiveOrderDateKey(baseDateKey, settings?.packingCutoffDate);

  let currentOrderNo = 0;
  if (!isShelfSale({ platform: input.platform, customerName: input.customerName })) {
    const counter = await tx.dailyCounter.upsert({
      where: { date: dateKey },
      update: { lastOrder: { increment: 1 } },
      create: { date: dateKey, lastOrder: 1 },
    });
    currentOrderNo = counter.lastOrder;
  }

  const validExtraSlipUrls = Array.isArray(input.extraSlipUrls) ? input.extraSlipUrls.filter((u) => typeof u === "string" && u.trim()) : [];
  const validItems = Array.isArray(input.items) ? input.items.filter((it) => it.weight > 0 || (it.pieceCount ?? 0) > 0) : [];

  return tx.order.create({
    data: {
      orderNo: currentOrderNo,
      customerName: input.customerName,
      platform: input.platform,
      socialMediaName: input.socialMediaName,
      crispyPorkPiece: input.crispyPorkPiece,
      crispyPorkWeight: input.crispyPorkWeight,
      packedPork: input.packedPork,
      promotion: input.promotion,
      // Distinguishes "not provided" (null/undefined, or "" — an untouched
      // form field) from an intentional 0 — a claim order sends a real 0
      // for all four of these (see POST /api/orders' own force-zero), which
      // a plain truthy check would silently store as null instead, making
      // it indistinguishable from "never filled in".
      price: isProvidedNumber(input.price) ? Number(input.price) : null,
      shippingMethod: input.shippingMethod,
      additionalShippingCost: isProvidedNumber(input.additionalShippingCost) ? Number(input.additionalShippingCost) : null,
      codAmount: isProvidedNumber(input.codAmount) ? Number(input.codAmount) : null,
      actualReceivedAmount: isProvidedNumber(input.actualReceivedAmount) ? Number(input.actualReceivedAmount) : null,
      transferSlip: input.transferSlip,
      paymentStatus: input.paymentStatus,
      customerAddress: input.customerAddress,
      customerPhone: input.customerPhone,
      customerZip: input.customerZip,
      needsTaxInvoice: !!input.needsTaxInvoice,
      orderStatus: input.orderStatus,
      rackDetails: input.rackDetails,
      sellerName: input.sellerName,
      trackingNumber: input.trackingNumber,
      trackingSetAt: input.trackingNumber ? new Date() : null,
      adminNote: input.adminNote,
      isClaim: !!input.isClaim,
      entryDate: dateKey,
      packingEntryDate: input.packingEntryDate ?? null,
      extraSlips: validExtraSlipUrls.length > 0 ? { create: validExtraSlipUrls.map((url) => ({ url })) } : undefined,
      items: validItems.length > 0 ? { create: validItems } : undefined,
    },
    include: { extraSlips: true, items: true },
  });
}
