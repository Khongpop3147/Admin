import { describe, it, expect } from "vitest";
import { normalizeCustomerName, findDuplicateOrder } from "./orderDuplicate";

describe("normalizeCustomerName", () => {
  it("strips common Thai honorific prefixes", () => {
    expect(normalizeCustomerName("คุณเมธานันท์")).toBe("เมธานันท์".toLowerCase());
    expect(normalizeCustomerName("นางสาวสมหญิง")).toBe("สมหญิง".toLowerCase());
    expect(normalizeCustomerName("นาย สมชาย")).toBe("สมชาย".toLowerCase());
  });

  it("collapses internal whitespace and lowercases", () => {
    expect(normalizeCustomerName("John   Doe")).toBe("johndoe");
  });

  it("treats a name with vs without an honorific as equal", () => {
    expect(normalizeCustomerName("คุณเมธานันท์")).toBe(normalizeCustomerName("เมธานันท์"));
  });
});

describe("findDuplicateOrder", () => {
  const recent = [
    { customerName: "คุณเมธานันท์", crispyPorkWeight: "1.5" },
    { customerName: "สมชาย", crispyPorkWeight: "2" },
  ];

  it("flags a match when both normalized name and weight (within tolerance) match", () => {
    expect(findDuplicateOrder("เมธานันท์", "1.5", recent)).toBe(recent[0]);
  });

  it("does not flag when the name matches but the weight differs", () => {
    expect(findDuplicateOrder("เมธานันท์", "3", recent)).toBeUndefined();
  });

  it("does not flag when the weight matches but the name differs", () => {
    expect(findDuplicateOrder("คนอื่น", "1.5", recent)).toBeUndefined();
  });

  it("allows tiny float differences within the 0.001 tolerance", () => {
    expect(findDuplicateOrder("เมธานันท์", "1.5000001", recent)).toBe(recent[0]);
  });

  it("skips the check entirely when the new weight isn't a valid number", () => {
    expect(findDuplicateOrder("เมธานันท์", undefined, recent)).toBeUndefined();
    expect(findDuplicateOrder("เมธานันท์", "", recent)).toBeUndefined();
  });

  it("skips candidates whose stored weight isn't a valid number", () => {
    const withBadWeight = [{ customerName: "เมธานันท์", crispyPorkWeight: null }];
    expect(findDuplicateOrder("เมธานันท์", "1.5", withBadWeight)).toBeUndefined();
  });
});
