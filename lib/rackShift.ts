// Pure computational core of the rack "shift" feature (see
// app/api/users/racks/shift/route.ts), split out from the DB access so the
// actual piece-renumbering math and the order rackDetails sync can be
// tested without a database.

export interface RackShiftItem {
  id: string;
  rackNo: string;
}

export interface RackShiftTarget {
  id: string;
  newName: string;
}

export function sortRackAssignments<T extends RackShiftItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aM = a.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
    const bM = b.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
    if (aM && bM) {
      const aNum = parseInt(aM[2], 10) * 10 + parseInt(aM[3], 10);
      const bNum = parseInt(bM[2], 10) * 10 + parseInt(bM[3], 10);
      return aNum - bNum;
    }
    return a.rackNo.localeCompare(b.rackNo);
  });
}

// Throws a sentinel-prefixed Error (NOT_FOUND:/COLLISION_DOWN:/COLLISION_UP:)
// on failure — callers (the API route) parse the prefix to pick the right
// HTTP status/message, same convention used throughout this codebase for
// errors that need to surface out of a $transaction callback.
export function computeShiftTargets(
  sortedAssignments: RackShiftItem[],
  startRackNo: string,
  direction: "up" | "down"
): RackShiftTarget[] {
  const startIndex = sortedAssignments.findIndex((a) => a.rackNo === startRackNo);
  if (startIndex === -1) {
    throw new Error(`NOT_FOUND:${startRackNo}`);
  }

  const targets: RackShiftTarget[] = [];
  const unshiftedNames = new Set(sortedAssignments.slice(0, startIndex).map((a) => a.rackNo));

  if (direction === "down") {
    for (let i = sortedAssignments.length - 1; i >= startIndex; i--) {
      const item = sortedAssignments[i];
      const m = item.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
      if (m) {
        const p = m[1];
        let rNum = parseInt(m[2], 10);
        let pNum = parseInt(m[3], 10);
        pNum++;
        if (pNum > 5) { pNum = 1; rNum++; }
        const newName = `${p}${String(rNum).padStart(m[2].length, "0")}-${pNum}`;

        if (unshiftedNames.has(newName)) {
          throw new Error(`COLLISION_DOWN:${newName}`);
        }

        targets.push({ id: item.id, newName });
      }
    }
  } else if (direction === "up") {
    for (let i = startIndex; i < sortedAssignments.length; i++) {
      const item = sortedAssignments[i];
      const m = item.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
      if (m) {
        const p = m[1];
        let rNum = parseInt(m[2], 10);
        let pNum = parseInt(m[3], 10);
        pNum--;
        if (pNum < 1) { pNum = 5; rNum--; }
        const newName = `${p}${String(rNum).padStart(m[2].length, "0")}-${pNum}`;

        if (unshiftedNames.has(newName)) {
          throw new Error(`COLLISION_UP:${newName}`);
        }

        targets.push({ id: item.id, newName });
      }
    }
  }

  return targets;
}

export interface OrderRackSyncInput {
  id: string;
  rackDetails: string | null;
}

export interface OrderRackSyncResult {
  id: string;
  newRackDetails: string;
}

// A piece's rackNo is also snapshotted into every order that ever drew from
// it (Order.rackDetails, keyed by assignmentId) — this keeps those in sync
// with a shift, so an already-confirmed order's printed slip / detail view
// doesn't keep showing the pre-shift code forever. Only the rackNo inside
// each matching entry changes; weight and assignmentId are untouched.
export function syncOrderRackDetails(
  orders: OrderRackSyncInput[],
  targetMap: Map<string, string>
): OrderRackSyncResult[] {
  const results: OrderRackSyncResult[] = [];

  for (const order of orders) {
    if (!order.rackDetails) continue;
    let details: any[];
    try {
      details = JSON.parse(order.rackDetails);
    } catch {
      continue;
    }
    if (!Array.isArray(details)) continue;

    let changed = false;
    for (const d of details) {
      if (d && d.assignmentId && targetMap.has(d.assignmentId)) {
        d.rackNo = targetMap.get(d.assignmentId);
        changed = true;
      }
    }
    if (changed) {
      results.push({ id: order.id, newRackDetails: JSON.stringify(details) });
    }
  }

  return results;
}
