// Courier shipping-cost lookup tables — piecewise-linear interpolation
// between the published weight tiers, rounded to the nearest 10 baht.

export const SHIPPING_RATES_EMS = [
  { w: 2, c: 100 }, { w: 3, c: 110 }, { w: 4, c: 120 }, { w: 5, c: 130 },
  { w: 6, c: 140 }, { w: 7, c: 150 }, { w: 8, c: 160 }, { w: 9, c: 170 },
  { w: 10, c: 180 }, { w: 15, c: 200 }, { w: 20, c: 250 }, { w: 25, c: 300 },
  { w: 30, c: 350 }, { w: 35, c: 400 }, { w: 40, c: 450 }, { w: 45, c: 500 },
  { w: 50, c: 550 }, { w: 75, c: 750 }, { w: 100, c: 1000 }
];

export const SHIPPING_RATES_NIM = [
  { w: 2, c: 200 }, { w: 3, c: 220 }, { w: 4, c: 240 }, { w: 5, c: 260 },
  { w: 6, c: 280 }, { w: 7, c: 300 }, { w: 8, c: 320 }, { w: 9, c: 340 },
  { w: 10, c: 360 }, { w: 15, c: 400 }, { w: 20, c: 450 }, { w: 25, c: 500 },
  { w: 30, c: 550 }, { w: 35, c: 600 }, { w: 40, c: 650 }, { w: 45, c: 700 },
  { w: 50, c: 750 }, { w: 75, c: 1000 }, { w: 100, c: 1500 }
];

export function calculateShippingCost(method: string, weight: number): number {
  const rates = method === "EMS" ? SHIPPING_RATES_EMS : SHIPPING_RATES_NIM;
  const minCost = rates[0].c;
  const maxCost = rates[rates.length - 1].c;

  if (weight <= 2) return minCost;
  if (weight >= 100) return maxCost;

  for (let i = 0; i < rates.length - 1; i++) {
    if (weight > rates[i].w && weight <= rates[i + 1].w) {
      const w1 = rates[i].w, c1 = rates[i].c;
      const w2 = rates[i + 1].w, c2 = rates[i + 1].c;
      const exactCost = c1 + ((weight - w1) * (c2 - c1) / (w2 - w1));
      return Math.round(exactCost / 10) * 10; // round to nearest 10
    }
  }
  return 0;
}
