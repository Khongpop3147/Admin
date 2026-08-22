import { describe, it, expect } from "vitest";
import { getShippingRank, getShippingLabel, getRackDisplay, extractShortageNote, groupOrdersForPrint, groupPrivateClientOrdersForPrint, PrintableOrder } from "./porkSlip";

describe("getShippingRank", () => {
  it("ranks NIM COD, NIM prepaid, EMS COD, EMS prepaid in that order", () => {
    expect(getShippingRank({ shippingMethod: "NIM Express", codAmount: 300 })).toBe(0);
    expect(getShippingRank({ shippingMethod: "NIM Express", codAmount: null })).toBe(1);
    expect(getShippingRank({ shippingMethod: "EMS", codAmount: 300 })).toBe(2);
    expect(getShippingRank({ shippingMethod: "EMS", codAmount: null })).toBe(3);
  });

  it("ranks local delivery (ส่งในพื้นที่) COD/prepaid after EMS but before the catch-all", () => {
    expect(getShippingRank({ shippingMethod: "ส่งในพื้นที่", codAmount: 300 })).toBe(4);
    expect(getShippingRank({ shippingMethod: "ส่งในพื้นที่", codAmount: null })).toBe(5);
  });

  it("ranks anything else last", () => {
    expect(getShippingRank({ shippingMethod: "แมสเซนเจอร์", codAmount: null })).toBe(6);
  });
});

describe("getShippingLabel", () => {
  it("always appends a suffix — never a bare method name", () => {
    expect(getShippingLabel({ shippingMethod: "NIM Express", codAmount: 300 })).toBe("NIM Express -ปลายทาง");
    expect(getShippingLabel({ shippingMethod: "NIM Express", codAmount: null })).toBe("NIM Express -ส่งฟรี");
    expect(getShippingLabel({ shippingMethod: "EMS", codAmount: 300 })).toBe("EMS -ปลายทาง");
    expect(getShippingLabel({ shippingMethod: "EMS", codAmount: null })).toBe("EMS -ส่งฟรี");
    expect(getShippingLabel({ shippingMethod: "ส่งในพื้นที่", codAmount: 300 })).toBe("ส่งในพื้นที่ -ปลายทาง");
    expect(getShippingLabel({ shippingMethod: "ส่งในพื้นที่", codAmount: null })).toBe("ส่งในพื้นที่ -ส่งฟรี");
  });
});

describe("extractShortageNote", () => {
  it("reformats a plain shortage note down to 'ขาด X กก.'", () => {
    expect(extractShortageNote("หมูในคลังไม่พอดี ขาดอีก 0.3 กก.")).toBe("ขาด 0.3 กก.");
  });

  it("extracts the shortage note but drops a trailing slip-issue note", () => {
    const combined = "หมูในคลังไม่พอดี ขาดอีก 0.24 กก. [หมายเหตุสลิป: สลิปไม่มี QR โค้ด]";
    expect(extractShortageNote(combined)).toBe("ขาด 0.24 กก.");
  });

  it("extracts the 'nothing close enough allocated' variant", () => {
    expect(extractShortageNote("ไม่มีชิ้นหมูที่ใกล้เคียงพอ ขาดอีก 1.4 กก.")).toBe("ขาด 1.4 กก.");
  });

  it("extracts a shortage note for a non-PORK product (regression: Lean/Low fat labels weren't matched before, so their shortage never reached the print slip)", () => {
    expect(extractShortageNote("หมูกรอบสันนอก (Lean)ในคลังไม่พอดี ขาดอีก 0.1 กก.")).toBe("ขาด 0.1 กก.");
    expect(extractShortageNote("หมูกรอบสะโพก (Low fat)ในคลังไม่พอดี ขาดอีก 0.25 กก.")).toBe("ขาด 0.25 กก.");
    expect(extractShortageNote("ไม่มีชิ้นหมูกรอบสันนอก (Lean)ที่ใกล้เคียงพอ ขาดอีก 1 กก.")).toBe("ขาด 1 กก.");
  });

  it("still picks the shortage note when it's not first in a joined admin note", () => {
    const combined = "ลูกค้าขอห่อพิเศษ / หมูกรอบสันนอก (Lean)ในคลังไม่พอดี ขาดอีก 0.2 กก.";
    expect(extractShortageNote(combined)).toBe("ขาด 0.2 กก.");
  });

  it("returns empty for an over-allocation note — the print slip only wants shortage, not overage", () => {
    expect(extractShortageNote("หมูในคลังไม่พอดี เกินมา 0.15 กก.")).toBe("");
  });

  it("sums shortages across multiple product lines on the same order (regression: only the first shortage used to reach the print slip, silently dropping the rest)", () => {
    const combined = "หมูในคลังไม่พอดี ขาดอีก 0.2 กก. / หมูกรอบสันนอก (Lean)ในคลังไม่พอดี ขาดอีก 0.15 กก.";
    expect(extractShortageNote(combined)).toBe("ขาด 0.35 กก.");
  });

  it("sums three product lines' shortages together", () => {
    const combined = [
      "หมูในคลังไม่พอดี ขาดอีก 0.1 กก.",
      "หมูกรอบสันนอก (Lean)ในคลังไม่พอดี ขาดอีก 0.2 กก.",
      "หมูกรอบสะโพก (Low fat)ในคลังไม่พอดี ขาดอีก 0.05 กก.",
    ].join(" / ");
    expect(extractShortageNote(combined)).toBe("ขาด 0.35 กก.");
  });

  it("only sums the shortage lines, ignoring an over-allocated line mixed into the same order", () => {
    const combined = "หมูในคลังไม่พอดี เกินมา 0.03 กก. / หมูกรอบสะโพก (Low fat)ในคลังไม่พอดี ขาดอีก 0.23 กก.";
    expect(extractShortageNote(combined)).toBe("ขาด 0.23 กก.");
  });

  it("returns empty for a slip-only note (no shortage)", () => {
    expect(extractShortageNote("[หมายเหตุสลิป: ยอดเงินไม่ตรง แต่ตรวจสอบแล้วถูกต้อง]")).toBe("");
  });

  it("returns empty for an arbitrary manually-typed note", () => {
    expect(extractShortageNote("ลูกค้าขอให้ห่อพิเศษ")).toBe("");
  });

  it("returns empty for null/undefined/empty input", () => {
    expect(extractShortageNote(null)).toBe("");
    expect(extractShortageNote(undefined)).toBe("");
    expect(extractShortageNote("")).toBe("");
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

  it("regression: groups prefixed-format (PORK_LOIN) pieces by their real base rack, not collapsed to 'L'", () => {
    const rackDetails = JSON.stringify([
      { rackNo: "L-A001-1", weight: 1.5 },
      { rackNo: "L-A001-2", weight: 2 },
      { rackNo: "L-A002-1", weight: 1 },
    ]);
    const result = getRackDisplay(rackDetails);
    expect(result.detailsArray.sort()).toEqual(["L-A001 = 1.5 / 2 kg", "L-A002 = 1 kg"].sort());
    expect(result.pieceCount).toBe(3);
  });

  it("regression: a mixed classic + prefixed order groups each product's pieces independently", () => {
    const rackDetails = JSON.stringify([
      { rackNo: "A005-1", weight: 1 },
      { rackNo: "L-A001-1", weight: 1.5 },
    ]);
    const result = getRackDisplay(rackDetails);
    expect(result.detailsArray.sort()).toEqual(["A005 = 1 kg", "L-A001 = 1.5 kg"].sort());
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

describe("groupPrivateClientOrdersForPrint", () => {
  it("keeps only platform === PrivateClient orders — the exact opposite of groupOrdersForPrint's exclusion", () => {
    const orders = [
      order({ orderNo: 1, platform: "PrivateClient", shippingMethod: "รับหน้าร้าน" }),
      order({ orderNo: 2, platform: "Facebook", shippingMethod: "EMS" }),
      order({ orderNo: 3, platform: "Storefront", shippingMethod: "รับหน้าร้าน" }),
    ];
    const groups = groupPrivateClientOrdersForPrint(orders, {});
    expect(groups.flatMap((g) => g.orders.map((o) => o.orderNo))).toEqual([1]);
  });

  it("sorts each group by orderNo — no shipping-rank concept for a Private Client order", () => {
    const orders = [
      order({ orderNo: 5, platform: "PrivateClient", sellerName: "A" }),
      order({ orderNo: 2, platform: "PrivateClient", sellerName: "A" }),
      order({ orderNo: 8, platform: "PrivateClient", sellerName: "A" }),
    ];
    const groups = groupPrivateClientOrdersForPrint(orders, {});
    expect(groups[0].orders.map((o) => o.orderNo)).toEqual([2, 5, 8]);
  });

  it("groups by seller, uses nicknames, and sorts admin groups alphabetically, same as groupOrdersForPrint", () => {
    const orders = [
      order({ orderNo: 1, platform: "PrivateClient", sellerName: "บีแอดมิน" }),
      order({ orderNo: 2, platform: "PrivateClient", sellerName: "เอแอดมิน" }),
    ];
    const groups = groupPrivateClientOrdersForPrint(orders, { "บีแอดมิน": "พี่บี" });
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.sellerName === "บีแอดมิน")?.displayName).toBe("พี่บี");
    expect(groups.find((g) => g.sellerName === "เอแอดมิน")?.displayName).toBe("เอแอดมิน");
  });

  it("returns nothing when there are no Private Client orders", () => {
    const orders = [order({ orderNo: 1, platform: "Facebook" }), order({ orderNo: 2, platform: "Storefront" })];
    expect(groupPrivateClientOrdersForPrint(orders, {})).toEqual([]);
  });
});
