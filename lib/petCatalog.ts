// Pure config + logic for the virtual pet feature — a for-fun, employee-morale
// gamification layer with no connection to real business data beyond reading
// an admin's own order count. Kept dependency-free (no Prisma/Next imports)
// so it's directly importable from both server routes and client pages, and
// trivially unit-testable, mirroring lib/rackCode.ts's PRODUCT_TYPES pattern.

export type GrowthStage = "baby" | "adult";

export interface SpeciesConfig {
  code: string;
  label: string;
}

// New species only ever need an entry added here — no migration, since
// Pet.species is a plain string, not a Prisma enum (same reasoning as
// RackAssignment.productType/PRODUCT_TYPES). Only species with a real GLTF
// model belong here — the earlier hand-sculpted (procedural primitive)
// species were removed once a real model became available, and no species
// without one should be re-added.
export const SPECIES: Record<string, SpeciesConfig> = {
  CAT: { code: "CAT", label: "แมว" },
  DOG: { code: "DOG", label: "หมา" },
};

// All of an admin's pets share one growth stage, driven by that admin's
// all-time order count (see app/api/pets/route.ts) — not per-pet, and never
// reset. Thresholds ascend; the highest one the count has reached wins.
export const GROWTH_THRESHOLDS: { stage: GrowthStage; minOrders: number }[] = [
  { stage: "baby", minOrders: 0 },
  { stage: "adult", minOrders: 500 },
];

export function getGrowthStage(orderCount: number): GrowthStage {
  let stage: GrowthStage = "baby";
  for (const t of GROWTH_THRESHOLDS) {
    if (orderCount >= t.minOrders) stage = t.stage;
  }
  return stage;
}

// Drives the "N orders to grow up" progress text — null once already adult.
export function getNextGrowthThreshold(orderCount: number): number | null {
  const next = GROWTH_THRESHOLDS.map((t) => t.minOrders)
    .filter((t) => t > orderCount)
    .sort((a, b) => a - b)[0];
  return next ?? null;
}
