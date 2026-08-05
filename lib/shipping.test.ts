import { describe, it, expect } from "vitest";
import { calculateShippingCost } from "./shipping";

describe("calculateShippingCost", () => {
  it("returns the minimum tier cost at or below 2kg", () => {
    expect(calculateShippingCost("EMS", 1)).toBe(100);
    expect(calculateShippingCost("EMS", 2)).toBe(100);
    expect(calculateShippingCost("NIM Express", 0.5)).toBe(200);
  });

  it("returns the maximum tier cost at or above 100kg", () => {
    expect(calculateShippingCost("EMS", 100)).toBe(1000);
    expect(calculateShippingCost("EMS", 500)).toBe(1000);
    expect(calculateShippingCost("NIM Express", 100)).toBe(1500);
  });

  it("returns the exact published rate at a listed weight tier", () => {
    expect(calculateShippingCost("EMS", 5)).toBe(130);
    expect(calculateShippingCost("EMS", 10)).toBe(180);
    expect(calculateShippingCost("NIM Express", 10)).toBe(360);
  });

  it("interpolates linearly between tiers and rounds to the nearest 10", () => {
    // Between 4kg(120) and 5kg(130): at 4.5kg -> exact 125 -> rounds to 130 (Math.round(12.5) = 13)
    expect(calculateShippingCost("EMS", 4.5)).toBe(130);
    // Between 10kg(180) and 15kg(200): at 12kg -> 180 + (2/5)*20 = 188 -> rounds to nearest 10 = 190
    expect(calculateShippingCost("EMS", 12)).toBe(190);
  });

  it("any method other than 'EMS' uses the NIM Express rate table", () => {
    expect(calculateShippingCost("NIM Express", 5)).toBe(260);
    expect(calculateShippingCost("something-else", 5)).toBe(260);
  });

  it("local delivery (ส่งในพื้นที่) is always a flat 200, regardless of weight", () => {
    expect(calculateShippingCost("ส่งในพื้นที่", 1)).toBe(200);
    expect(calculateShippingCost("ส่งในพื้นที่", 20)).toBe(200);
    expect(calculateShippingCost("ส่งในพื้นที่", 0)).toBe(200);
  });
});
