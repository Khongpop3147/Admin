import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  calculateCodAmount,
  computeVatAmount,
  computeActualReceivedAmount,
  isShelfSale,
  isPendingStorefrontMoney,
  isCodPending,
  isExcludedFromRevenue,
  commissionForOrder,
  getPricePerKg,
} from "./money";

describe("getPricePerKg", () => {
  it("returns the PORK_LOIN rate for a PORK_LOIN line item", () => {
    expect(getPricePerKg("PORK_LOIN", DEFAULT_SETTINGS)).toBe(350);
  });

  it("returns the PORK_HIP rate for a PORK_HIP line item", () => {
    expect(getPricePerKg("PORK_HIP", DEFAULT_SETTINGS)).toBe(350);
  });

  it("returns the PORK rate for a PORK line item", () => {
    expect(getPricePerKg("PORK", DEFAULT_SETTINGS)).toBe(250);
  });

  it("defaults to the PORK rate for null/undefined/unrecognized productType", () => {
    expect(getPricePerKg(null, DEFAULT_SETTINGS)).toBe(250);
    expect(getPricePerKg(undefined, DEFAULT_SETTINGS)).toBe(250);
    expect(getPricePerKg("SOMETHING_UNKNOWN", DEFAULT_SETTINGS)).toBe(250);
  });

  it("respects custom settings, not just the defaults", () => {
    const custom = { ...DEFAULT_SETTINGS, porkPricePerKg: 260, porkLoinPricePerKg: 400, porkHipPricePerKg: 420 };
    expect(getPricePerKg("PORK", custom)).toBe(260);
    expect(getPricePerKg("PORK_LOIN", custom)).toBe(400);
    expect(getPricePerKg("PORK_HIP", custom)).toBe(420);
  });
});

describe("calculateCodAmount", () => {
  it("returns the flat fee at or below the threshold", () => {
    expect(calculateCodAmount(2.29, DEFAULT_SETTINGS)).toBe(50);
    expect(calculateCodAmount(1, DEFAULT_SETTINGS)).toBe(50);
    expect(calculateCodAmount(0, DEFAULT_SETTINGS)).toBe(50);
  });

  it("uses the weight-based formula above the threshold", () => {
    // (3 / 1.5) * 20 = 40
    expect(calculateCodAmount(3, DEFAULT_SETTINGS)).toBe(40);
    // (15 / 1.5) * 20 = 200
    expect(calculateCodAmount(15, DEFAULT_SETTINGS)).toBe(200);
  });

  it("respects custom settings, not just the defaults", () => {
    const custom = { ...DEFAULT_SETTINGS, codFlatFeeThreshold: 5, codFlatFee: 30, codDivisor: 2, codMultiplier: 10 };
    expect(calculateCodAmount(5, custom)).toBe(30);
    expect(calculateCodAmount(10, custom)).toBe(50); // (10/2)*10
  });
});

describe("computeVatAmount / computeActualReceivedAmount", () => {
  it("computes 7% VAT on price + shipping only, not COD", () => {
    expect(computeVatAmount(100, 0)).toBeCloseTo(7, 5);
    expect(computeVatAmount(100, 50)).toBeCloseTo(10.5, 5);
  });

  it("matches the exact formula used at order creation and PATCH recompute: round(price + shipping + vat + cod)", () => {
    // price=250, shipping=0, cod=0 -> vat=17.5 -> total=267.5 -> rounds to 268
    expect(computeActualReceivedAmount(250, 0, 0)).toBe(268);
    // price=250, shipping=100, cod=350 -> vat=(350)*0.07=24.5 -> total=724.5 -> 725 (round-half-up)
    expect(computeActualReceivedAmount(250, 100, 350)).toBe(725);
  });

  it("handles zero price gracefully (e.g. a fully-COD order with no listed product price)", () => {
    expect(computeActualReceivedAmount(0, 0, 100)).toBe(100);
  });
});

describe("isShelfSale", () => {
  it("is true only for the exact Storefront walk-in placeholder", () => {
    expect(isShelfSale({ platform: "Storefront", customerName: "วางขายหน้าร้าน" })).toBe(true);
  });

  it("is false for a real Storefront customer sale", () => {
    expect(isShelfSale({ platform: "Storefront", customerName: "คุณสมชาย" })).toBe(false);
  });

  it("is false for non-Storefront platforms even with the same name", () => {
    expect(isShelfSale({ platform: "Facebook", customerName: "วางขายหน้าร้าน" })).toBe(false);
  });
});

describe("isPendingStorefrontMoney", () => {
  it("is true for any Storefront-platform order, named customer or not", () => {
    expect(isPendingStorefrontMoney({ platform: "Storefront", customerName: "วางขายหน้าร้าน" })).toBe(true);
    expect(isPendingStorefrontMoney({ platform: "Storefront", customerName: "คุณสมชาย" })).toBe(true);
  });

  it("is false for every other platform", () => {
    expect(isPendingStorefrontMoney({ platform: "Facebook", customerName: "คุณสมชาย" })).toBe(false);
    expect(isPendingStorefrontMoney({ platform: "PrivateClient", customerName: "คุณสมชาย" })).toBe(false);
  });
});

describe("isCodPending", () => {
  it("is true when there's a COD amount and it hasn't been confirmed", () => {
    expect(isCodPending({ codAmount: 350, codConfirmed: false })).toBe(true);
  });

  it("is false once confirmed", () => {
    expect(isCodPending({ codAmount: 350, codConfirmed: true })).toBe(false);
  });

  it("is false for non-COD orders regardless of the confirmed flag", () => {
    expect(isCodPending({ codAmount: 0, codConfirmed: false })).toBe(false);
    expect(isCodPending({ codAmount: null, codConfirmed: false })).toBe(false);
  });
});

describe("isExcludedFromRevenue", () => {
  it("excludes shelf sales", () => {
    expect(isExcludedFromRevenue({ platform: "Storefront", customerName: "วางขายหน้าร้าน" })).toBe(true);
  });

  it("excludes a named-customer Storefront sale too — not counted until a real POS system backfills it", () => {
    expect(isExcludedFromRevenue({ platform: "Storefront", customerName: "คุณสมชาย" })).toBe(true);
  });

  it("excludes returned orders", () => {
    expect(isExcludedFromRevenue({ isReturned: true })).toBe(true);
  });

  it("does not exclude a normal completed order", () => {
    expect(isExcludedFromRevenue({ platform: "Facebook", customerName: "คุณสมชาย", isReturned: false })).toBe(false);
  });

  it("a returned COD-held order is still excluded (regression: this used to leak into 'held forever')", () => {
    expect(isExcludedFromRevenue({ isReturned: true, codAmount: 200, codConfirmed: false })).toBe(true);
  });

  it("excludes a claim replacement — never charged for in the first place", () => {
    expect(isExcludedFromRevenue({ isClaim: true, price: 375 })).toBe(true);
  });
});

describe("commissionForOrder", () => {
  it("is 0 for a shelf sale", () => {
    expect(commissionForOrder({ platform: "Storefront", customerName: "วางขายหน้าร้าน", price: 250 }, DEFAULT_SETTINGS)).toBe(0);
  });

  it("is 0 for a named-customer Storefront sale too", () => {
    expect(commissionForOrder({ platform: "Storefront", customerName: "คุณสมชาย", price: 250 }, DEFAULT_SETTINGS)).toBe(0);
  });

  it("is 0 for a still-pending COD order", () => {
    expect(commissionForOrder({ price: 250, codAmount: 350, codConfirmed: false }, DEFAULT_SETTINGS)).toBe(0);
  });

  it("is commissionRate * price for a normal confirmed sale", () => {
    expect(commissionForOrder({ price: 250 }, DEFAULT_SETTINGS)).toBeCloseTo(50, 5); // 0.2 * 250
  });

  it("is commissionRate * price once a COD order is confirmed", () => {
    expect(commissionForOrder({ price: 250, codAmount: 350, codConfirmed: true }, DEFAULT_SETTINGS)).toBeCloseTo(50, 5);
  });

  it("is a flat negative penalty for a returned order, overriding everything else", () => {
    expect(commissionForOrder({ price: 250, isReturned: true }, DEFAULT_SETTINGS)).toBe(-50);
    // even a returned COD order gets the flat penalty, not 0
    expect(commissionForOrder({ price: 250, isReturned: true, codAmount: 350, codConfirmed: false }, DEFAULT_SETTINGS)).toBe(-50);
  });

  it("is 0 for a claim replacement — no commission on a free giveaway", () => {
    expect(commissionForOrder({ price: 0, isClaim: true }, DEFAULT_SETTINGS)).toBe(0);
  });
});
