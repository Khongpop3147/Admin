// Pure sorting/grouping/labeling logic for the pork withdrawal slip print
// page (app/packing/print/page.tsx). Extracted because this exact ordering
// has been revised multiple times based on real packing-workflow feedback —
// tests here are what stop a future tweak from silently reverting an
// earlier fix.

export interface ShippingInfo {
  shippingMethod: string;
  codAmount?: number | null;
}

// Report grouping order within each admin's own section: NIM -ปลายทาง,
// NIM -ส่งฟรี, EMS -ปลายทาง, EMS -ส่งฟรี, ส่งในพื้นที่ -ปลายทาง,
// ส่งในพื้นที่ -ส่งฟรี — COD comes first within each shipping method.
export function getShippingRank(order: ShippingInfo): number {
  const method = order.shippingMethod || "";
  const hasCod = !!order.codAmount;
  if (method === "NIM Express" && hasCod) return 0;
  if (method === "NIM Express") return 1;
  if (method === "EMS" && hasCod) return 2;
  if (method === "EMS") return 3;
  if (method === "ส่งในพื้นที่" && hasCod) return 4;
  if (method === "ส่งในพื้นที่") return 5;
  return 6;
}

// Every order ships either COD or prepaid — there's no bare "NIM Express"/
// "EMS" label, always one of these two suffixes, for either method.
export function getShippingLabel(order: ShippingInfo): string {
  const method = order.shippingMethod || "-";
  return order.codAmount ? `${method} -ปลายทาง` : `${method} -ส่งฟรี`;
}

export interface RackDisplay {
  detailsArray: string[];
  totalWeight: number;
  pieceCount: number;
}

export function getRackDisplay(rackDetailsStr: string): RackDisplay {
  if (!rackDetailsStr || rackDetailsStr === "[]") return { detailsArray: ["-"], totalWeight: 0, pieceCount: 0 };
  try {
    const racks = JSON.parse(rackDetailsStr);
    const groups: Record<string, number[]> = {};
    let totalWeight = 0;
    let pieceCount = 0;

    racks.forEach((r: any) => {
      if (!r.rackNo) return;
      pieceCount += 1;
      const base = r.rackNo.split("-")[0];
      if (!groups[base]) groups[base] = [];
      const w = parseFloat(r.weight) || 0;
      groups[base].push(w);
      totalWeight += w;
    });

    const detailsArray = Object.entries(groups).map(([base, weights]) => {
      return `${base} = ${weights.join(" / ")} kg`;
    });

    return { detailsArray, totalWeight, pieceCount };
  } catch (e) {
    return { detailsArray: ["-"], totalWeight: 0, pieceCount: 0 };
  }
}

// adminNote is a grab-bag — it can carry the auto-derived pork-shortage note
// ("หมูในคลังไม่พอดี ขาดอีก ..." / "ไม่มีชิ้นหมูที่ใกล้เคียงพอ ขาดอีก
// ..."), an over-allocation note ("...เกินมา ..."), a bracketed slip-issue
// note, and/or anything an admin typed by hand, all joined together. The
// pork withdrawal slip only wants the shortage part — over-allocation, slip
// notes, and manual notes are admin-facing, not something Packing needs
// printed on the slip. Reformatted down to just "ขาด X กก." — the slip is
// working notes for the packer, not the fuller admin-facing wording.
export function extractShortageNote(adminNote: string | null | undefined): string {
  if (!adminNote) return "";
  const match = adminNote.match(/(?:หมูในคลังไม่พอดี|ไม่มีชิ้นหมูที่ใกล้เคียงพอ) ขาดอีก ([\d.]+) กก\./);
  return match ? `ขาด ${match[1]} กก.` : "";
}

export interface PrintableOrder extends ShippingInfo {
  orderNo: number;
  sellerName?: string;
  platform: string;
}

export interface AdminGroup<T> {
  sellerName: string;
  displayName: string;
  orders: T[];
}

// Filters out storefront (walk-in) orders, groups the rest by seller, sorts
// each seller's orders by shipping rank then order number, and sorts the
// admin groups themselves alphabetically by display name (Thai collation).
export function groupOrdersForPrint<T extends PrintableOrder>(
  orders: T[],
  nicknameByName: Record<string, string>
): AdminGroup<T>[] {
  // Filter out storefront (walk-in) orders — by platform AND by shipping
  // method, so a storefront-style order never sneaks into the report even
  // if its platform field wasn't tagged "Storefront".
  const filtered = orders.filter(
    (o) => o.platform !== "Storefront" && o.shippingMethod !== "รับหน้าร้าน" && o.shippingMethod !== "ส่งเอง"
  );

  const bySeller: Record<string, T[]> = {};
  filtered.forEach((o) => {
    const key = o.sellerName || "ไม่ระบุแอดมิน";
    if (!bySeller[key]) bySeller[key] = [];
    bySeller[key].push(o);
  });

  const groups: AdminGroup<T>[] = Object.entries(bySeller).map(([sellerName, groupOrders]) => {
    const sortedOrders = [...groupOrders].sort((a, b) => {
      const rankDiff = getShippingRank(a) - getShippingRank(b);
      if (rankDiff !== 0) return rankDiff;
      return (a.orderNo || 0) - (b.orderNo || 0);
    });
    return {
      sellerName,
      displayName: nicknameByName[sellerName] || sellerName,
      orders: sortedOrders,
    };
  });

  groups.sort((a, b) => a.displayName.localeCompare(b.displayName, "th"));

  return groups;
}
