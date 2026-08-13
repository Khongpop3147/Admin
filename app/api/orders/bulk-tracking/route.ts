import { NextResponse } from 'next/server';
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../lib/session";
import { isSuperAdminRole } from "../../../../lib/roles";
import { findNameMatch } from "../../../../lib/nameMatch";
import { buildTrackDateMismatchNote } from "../../../../lib/trackingImport";

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

    const { updates, entryDate, shipDate } = await request.json();

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
    // A short/generic name (e.g. "มล") can textually match several
    // unrelated orders ("กมล", "มลคร", ...) — findNameMatch refuses to
    // guess in that case rather than silently attaching the tracking
    // number to whichever one happened to come first, so these need a
    // human to resolve by typing the tracking number in manually.
    let ambiguousCount = 0;
    const ambiguousNames: string[] = [];

    // An order over ~27kg ships in multiple boxes, each with its own
    // tracking number — the courier's export sheet then has more than one
    // row for the same customer. Collect every matched row per order (keyed
    // by order id) instead of updating on the first match and losing every
    // row after it, so all of that order's tracking numbers survive,
    // comma-joined. Also seeds from whatever trackingNumber the order
    // already had (e.g. a first box imported in an earlier run), so a later
    // import for the second box appends rather than overwrites it.
    // mismatchDates/originalAdminNote support the date-mismatch note below:
    // filterTrackingRowsToClosestDate (run client-side before this request)
    // only ever compares a customer against their OWN other rows in the same
    // file — a lone row with no same-name competitor row still gets matched
    // here even if its date doesn't line up with shipDate. Rather than
    // blocking (which would break legitimate "pack ahead of schedule"
    // imports), stamp a reviewable note onto adminNote so it surfaces on HR
    // Manage.
    const matchedByOrderId = new Map<
      string,
      { customerName: string; trackingNumbers: string[]; mismatchDates: Set<string>; originalAdminNote: string | null }
    >();

    for (const update of updates) {
      // A second (or third) row for a customer already matched earlier in
      // this same batch — append to that order instead of re-searching
      // activeOrders (which no longer has it) and wrongly reporting it as
      // not found.
      const alreadyMatchedCandidates = Array.from(matchedByOrderId.entries()).map(([orderId, entry]) => ({
        id: orderId,
        name: entry.customerName,
      }));
      const alreadyMatchedResult = findNameMatch(update.customerName, alreadyMatchedCandidates);

      if (alreadyMatchedResult.status === "matched") {
        const entry = matchedByOrderId.get(alreadyMatchedResult.id)!;
        entry.trackingNumbers.push(update.trackingNumber);
        if (update.rowDate && shipDate && update.rowDate !== shipDate) {
          entry.mismatchDates.add(update.rowDate);
        }
        successCount++;
        continue;
      }
      if (alreadyMatchedResult.status === "ambiguous") {
        ambiguousCount++;
        ambiguousNames.push(update.customerName);
        continue;
      }

      // Find matching order in active orders
      const activeCandidates = activeOrders.map((o) => ({ id: o.id, name: o.customerName }));
      const result = findNameMatch(update.customerName, activeCandidates);

      if (result.status === "matched") {
        const matchedOrder = activeOrders.find((o) => o.id === result.id)!;
        const existing = (matchedOrder.trackingNumber || '').trim();
        const seed = existing ? existing.split(',').map((s) => s.trim()).filter(Boolean) : [];
        const mismatchDates = new Set<string>();
        if (update.rowDate && shipDate && update.rowDate !== shipDate) {
          mismatchDates.add(update.rowDate);
        }
        matchedByOrderId.set(matchedOrder.id, {
          customerName: matchedOrder.customerName,
          trackingNumbers: [...seed, update.trackingNumber],
          mismatchDates,
          originalAdminNote: matchedOrder.adminNote,
        });

        // Remove from activeOrders so we don't match it again if there are duplicates
        const index = activeOrders.findIndex(o => o.id === matchedOrder.id);
        if (index > -1) {
          activeOrders.splice(index, 1);
        }

        successCount++;
      } else if (result.status === "ambiguous") {
        ambiguousCount++;
        ambiguousNames.push(update.customerName);
      } else {
        notFoundCount++;
        notFoundNames.push(update.customerName);
      }
    }

    const updatePromises = Array.from(matchedByOrderId.entries()).map(([orderId, entry]) => {
      // Only ever ADD notes, never dedupe-remove — if a note for this exact
      // rowDate/shipDate pair is already there (e.g. the same file gets
      // re-imported), skip re-appending it, but leave anything already
      // present alone.
      const newNotes = Array.from(entry.mismatchDates)
        .map((rowDate) => buildTrackDateMismatchNote(rowDate, shipDate))
        .filter((note) => !(entry.originalAdminNote || "").includes(note));
      const adminNote = newNotes.length > 0
        ? [entry.originalAdminNote, ...newNotes].filter(Boolean).join(" ")
        : undefined;

      return prisma.order.update({
        where: { id: orderId },
        data: {
          trackingNumber: entry.trackingNumbers.join(','),
          orderStatus: 'Shipped', // Automatically change status to Shipped
          ...(adminNote !== undefined ? { adminNote } : {}),
        }
      });
    });

    // Execute all updates in a transaction for atomicity and speed
    if (updatePromises.length > 0) {
      await prisma.$transaction(updatePromises);
    }

    return NextResponse.json({
      successCount,
      notFoundCount,
      notFoundNames,
      ambiguousCount,
      ambiguousNames
    });

  } catch (error) {
    console.error('Bulk tracking update error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
