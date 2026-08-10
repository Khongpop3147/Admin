import { NextResponse } from 'next/server';
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../lib/session";
import { isSuperAdminRole } from "../../../../lib/roles";

const globalForPrisma = global as unknown as { prisma2: PrismaClient };

let prisma: PrismaClient;

if (globalForPrisma.prisma2) {
  prisma = globalForPrisma.prisma2;
} else {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
}

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma2 = prisma;

export async function PATCH(request: Request) {
  try {
    const session = await getSessionUser();
    if (!session || !(session.role === "PACKING" || isSuperAdminRole(session.role))) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { updates, entryDate } = await request.json();

    if (!Array.isArray(updates)) {
      return NextResponse.json({ error: 'Invalid updates format' }, { status: 400 });
    }

    // We fetch all orders that are either Pending or Packed (orderStatus is
    // normally '' rather than null for a fresh order, but treat null the same
    // way so this doesn't silently skip a record either way). Scoped to the
    // given entryDate when provided — the Packing date currently being
    // worked on — so a same-named customer from a different still-open day
    // can't get matched by mistake; without it, falls back to searching
    // every open order regardless of date (old behavior).
    const activeOrders = await prisma.order.findMany({
      where: {
        AND: [
          {
            OR: [
              { orderStatus: { in: ['Pending', 'Packed', ''] } },
              { orderStatus: null },
            ],
          },
          {
            OR: [
              { platform: { not: 'Storefront' } },
              { platform: null },
            ],
          },
          ...(entryDate ? [{ entryDate }] : []),
        ],
      }
    });

    let successCount = 0;
    let notFoundCount = 0;
    const notFoundNames: string[] = [];

    // Helper to normalize names for matching
    const normalizeName = (name: string) => {
      return name
        .replace(/^คุณ\s*/, '') // Remove "คุณ " prefix
        .replace(/\s+/g, '') // Remove all whitespace
        .toLowerCase();
    };

    // An order over ~27kg ships in multiple boxes, each with its own
    // tracking number — the courier's export sheet then has more than one
    // row for the same customer. Collect every matched row per order (keyed
    // by order id) instead of updating on the first match and losing every
    // row after it, so all of that order's tracking numbers survive,
    // comma-joined. Also seeds from whatever trackingNumber the order
    // already had (e.g. a first box imported in an earlier run), so a later
    // import for the second box appends rather than overwrites it.
    const matchedByOrderId = new Map<string, { customerName: string; trackingNumbers: string[] }>();

    for (const update of updates) {
      const excelName = normalizeName(update.customerName);

      // A second (or third) row for a customer already matched earlier in
      // this same batch — append to that order instead of re-searching
      // activeOrders (which no longer has it) and wrongly reporting it as
      // not found.
      let alreadyMatchedId: string | undefined;
      for (const [orderId, entry] of matchedByOrderId) {
        const orderName = normalizeName(entry.customerName);
        if (orderName === excelName || orderName.includes(excelName) || excelName.includes(orderName)) {
          alreadyMatchedId = orderId;
          break;
        }
      }

      if (alreadyMatchedId) {
        matchedByOrderId.get(alreadyMatchedId)!.trackingNumbers.push(update.trackingNumber);
        successCount++;
        continue;
      }

      // Find matching order in active orders
      const matchedOrder = activeOrders.find(order => {
        const orderName = normalizeName(order.customerName);
        return orderName === excelName || orderName.includes(excelName) || excelName.includes(orderName);
      });

      if (matchedOrder) {
        const existing = (matchedOrder.trackingNumber || '').trim();
        const seed = existing ? existing.split(',').map((s) => s.trim()).filter(Boolean) : [];
        matchedByOrderId.set(matchedOrder.id, {
          customerName: matchedOrder.customerName,
          trackingNumbers: [...seed, update.trackingNumber],
        });

        // Remove from activeOrders so we don't match it again if there are duplicates
        const index = activeOrders.findIndex(o => o.id === matchedOrder.id);
        if (index > -1) {
          activeOrders.splice(index, 1);
        }

        successCount++;
      } else {
        notFoundCount++;
        notFoundNames.push(update.customerName);
      }
    }

    const updatePromises = Array.from(matchedByOrderId.entries()).map(([orderId, entry]) =>
      prisma.order.update({
        where: { id: orderId },
        data: {
          trackingNumber: entry.trackingNumbers.join(','),
          orderStatus: 'Shipped' // Automatically change status to Shipped
        }
      })
    );

    // Execute all updates in a transaction for atomicity and speed
    if (updatePromises.length > 0) {
      await prisma.$transaction(updatePromises);
    }

    return NextResponse.json({
      successCount,
      notFoundCount,
      notFoundNames
    });

  } catch (error) {
    console.error('Bulk tracking update error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
