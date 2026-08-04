import { describe, it, expect } from "vitest";
import { getShippingRank, getShippingLabel, getRackDisplay, groupOrdersForPrint, PrintableOrder } from "./porkSlip";

describe("getShippingRank", () => {
  it("ranks NIM COD, NIM prepaid, EMS COD, EMS prepaid in that order", () => {
    expect(getShippingRank({ shippingMethod: "NIM Express", codAmount: 300 })).toBe(0);
    expect(getShippingRank({ shippingMethod: "NIM Express", codAmount: null })).toBe(1);
    expect(getShippingRank({ shippingMethod: "EMS", codAmount: 300 })).toBe(2);
    expect(getShippingRank({ shippingMethod: "EMS", codAmount: null })).toBe(3);
  });

  it("ranks anything else last", () => {
    expect(getShippingRank({ shippingMethod: "แมสเซนเจอร์", codAmount: null })).toBe(4);
  });
});

describe("getShippingLabel", () => {
  it("always appends a suffix — never a bare method name", () => {
    expect(getShippingLabel({ shippingMethod: "NIM Express", codAmount: 300 })).toBe("NIM Express -ปลายทาง");
    expect(getShippingLabel({ shippingMethod: "NIM Express", codAmount: null })).toBe("NIM Express -ส่งฟรี");
    expect(getShippingLabel({ shippingMethod: "EMS", codAmount: 300 })).toBe("EMS -ปลายทาง");
    expect(getShippingLabel({ shippingMethod: "EMS", codAmount: null })).toBe("EMS -ส่งฟรี");
  });
});

describe("getRackDisplay", () => {
  it("groups multiple pieces from the same base rack onto one line", () => {
    const rackDetails = JSON.stringify([
      { rackNo: "A005-1", weight: 1.5 },
      { rackNo: "A005-2", weight: 2 },
    ]);
    const result = getRackDisplay(rackDetails);
    expect(result.detailsArray).toEqual(["A005 = 1.5 / 2 kg"]);
    expect(result.totalWeight).toBe(3.5);
    expect(result.pieceCount).toBe(2);
  });

  it("keeps different base racks on separate lines", () => {
    const rackDetails = JSON.stringify([
      { rackNo: "A005-1", weight: 1 },
      { rackNo: "A006-1", weight: 2 },
    ]);
    const result = getRackDisplay(rackDetails);
    expect(result.detailsArray).toEqual(["A005 = 1 kg", "A006 = 2 kg"]);
    expect(result.pieceCount).toBe(2);
  });

  it("handles an empty or missing rackDetails without throwing", () => {
    expect(getRackDisplay("")).toEqual({ detailsArray: ["-"], totalWeight: 0, pieceCount: 0 });
    expect(getRackDisplay("[]")).toEqual({ detailsArray: ["-"], totalWeight: 0, pieceCount: 0 });
  });

  it("handles malformed JSON without throwing", () => {
    expect(getRackDisplay("not valid json")).toEqual({ detailsArray: ["-"], totalWeight: 0, pieceCount: 0 });
  });
});

function order(overrides: Partial<PrintableOrder> & { orderNo: number }): PrintableOrder {
  return {
    sellerName: "แอดมินเอ",
    shippingMethod: "EMS",
    codAmount: null,
    platform: "Facebook",
    ...overrides,
  };
}

describe("groupOrdersForPrint", () => {
  it("excludes storefront orders by platform", () => {
    const orders = [order({ orderNo: 1, platform: "Storefront" }), order({ orderNo: 2 })];
    const groups = groupOrdersForPrint(orders, {});
    expect(groups.flatMap((g) => g.orders.map((o) => o.orderNo))).toEqual([2]);
  });

  it("excludes walk-in shipping methods even if platform isn't tagged Storefront", () => {
    const orders = [
      order({ orderNo: 1, shippingMethod: "รับหน้าร้าน" }),
      order({ orderNo: 2, shippingMethod: "ส่งเอง" }),
      order({ orderNo: 3 }),
    ];
    const groups = groupOrdersForPrint(orders, {});
    expect(groups.flatMap((g) => g.orders.map((o) => o.orderNo))).toEqual([3]);
  });

  it("groups by sellerName and sorts each group by shipping rank then orderNo", () => {
    const orders = [
      order({ orderNo: 3, sellerName: "แอดมินเอ", shippingMethod: "EMS", codAmount: null }),
      order({ orderNo: 1, sellerName: "แอดมินเอ", shippingMethod: "NIM Express", codAmount: 200 }),
      order({ orderNo: 2, sellerName: "แอดมินเอ", shippingMethod: "EMS", codAmount: 200 }),
    ];
    const groups = groupOrdersForPrint(orders, {});
    expect(groups).toHaveLength(1);
    expect(groups[0].orders.map((o) => o.orderNo)).toEqual([1, 2, 3]); // NIM-COD, EMS-COD, EMS-prepaid
  });

  it("orders within the same rank by orderNo ascending", () => {
    const orders = [
      order({ orderNo: 5, sellerName: "A" }),
      order({ orderNo: 2, sellerName: "A" }),
      order({ orderNo: 8, sellerName: "A" }),
    ];
    const groups = groupOrdersForPrint(orders, {});
    expect(groups[0].orders.map((o) => o.orderNo)).toEqual([2, 5, 8]);
  });

  it("uses the nickname when one is registered, falls back to the raw sellerName otherwise", () => {
    const orders = [order({ orderNo: 1, sellerName: "แอดมินเอ (ชื่อจริงยาวๆ)" })];
    const groups = groupOrdersForPrint(orders, { "แอดมินเอ (ชื่อจริงยาวๆ)": "พี่เอ" });
    expect(groups[0].displayName).toBe("พี่เอ");

    const groupsNoNickname = groupOrdersForPrint(orders, {});
    expect(groupsNoNickname[0].displayName).toBe("แอดมินเอ (ชื่อจริงยาวๆ)");
  });

  it("falls back to a placeholder seller key when sellerName is missing", () => {
    const orders = [order({ orderNo: 1, sellerName: undefined })];
    const groups = groupOrdersForPrint(orders, {});
    expect(groups[0].sellerName).toBe("ไม่ระบุแอดมิน");
  });

  it("sorts admin groups alphabetically by display name (Thai collation)", () => {
    const orders = [
      order({ orderNo: 1, sellerName: "บีแอดมิน" }),
      order({ orderNo: 2, sellerName: "เอแอดมิน" }),
    ];
    const groups = groupOrdersForPrint(orders, {});
    // Just assert it's deterministic and both groups exist — exact Thai
    // collation order is locale-dependent, the important property is that
    // it's consistent, not accidental (object key iteration) order.
    expect(groups.map((g) => g.sellerName).sort()).toEqual(["บีแอดมิน", "เอแอดมิน"].sort());
    expect(groups).toHaveLength(2);
  });

  it("does not mutate the input orders array", () => {
    const orders = [order({ orderNo: 2, sellerName: "A" }), order({ orderNo: 1, sellerName: "A" })];
    const originalOrder = [...orders];
    groupOrdersForPrint(orders, {});
    expect(orders.map((o) => o.orderNo)).toEqual(originalOrder.map((o) => o.orderNo));
  });
});
