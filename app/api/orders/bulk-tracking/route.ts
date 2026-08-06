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

    const updatePromises = [];

    for (const update of updates) {
      const excelName = normalizeName(update.customerName);
      
      // Find matching order in active orders
      const matchedOrder = activeOrders.find(order => {
        const orderName = normalizeName(order.customerName);
        return orderName === excelName || orderName.includes(excelName) || excelName.includes(orderName);
      });

      if (matchedOrder) {
        // Prepare the update promise
        updatePromises.push(
          prisma.order.update({
            where: { id: matchedOrder.id },
            data: {
              trackingNumber: update.trackingNumber,
              orderStatus: 'Shipped' // Automatically change status to Shipped
            }
          })
        );
        
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
