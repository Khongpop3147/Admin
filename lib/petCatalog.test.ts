import { describe, it, expect } from "vitest";
import { SPECIES, getGrowthStage, getNextGrowthThreshold } from "./petCatalog";

describe("catalog self-consistency", () => {
  it("every SPECIES entry's key matches its own code", () => {
    Object.entries(SPECIES).forEach(([key, config]) => expect(config.code).toBe(key));
  });
});

describe("getGrowthStage", () => {
  it("stays baby just below the adult threshold", () => {
    expect(getGrowthStage(0)).toBe("baby");
    expect(getGrowthStage(499)).toBe("baby");
  });

  it("becomes adult exactly at the threshold and stays adult beyond", () => {
    expect(getGrowthStage(500)).toBe("adult");
    expect(getGrowthStage(100000)).toBe("adult");
  });
});

describe("getNextGrowthThreshold", () => {
  it("returns the closest growth threshold still ahead", () => {
    expect(getNextGrowthThreshold(0)).toBe(500);
    expect(getNextGrowthThreshold(499)).toBe(500);
  });

  it("returns null once already adult", () => {
    expect(getNextGrowthThreshold(500)).toBeNull();
    expect(getNextGrowthThreshold(999)).toBeNull();
  });
});
