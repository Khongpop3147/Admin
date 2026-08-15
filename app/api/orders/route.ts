import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../lib/session";
import { findDuplicateOrder, findDuplicatePendingStock } from "../../../lib/orderDuplicate";
import { createOrderRecord } from "../../../lib/createOrder";

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

export async function POST(req: Request) {
  try {
    const session = await getSessionUser();
    // Every staff role creates orders through some page — CENTRAL_INVENTORY
    // is the only one with no order-entry UI at all.
    if (!session || session.role === "CENTRAL_INVENTORY") {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const body = await req.json();
    const {
      customerName, platform, socialMediaName, crispyPorkPiece, crispyPorkWeight, packedPork, promotion, price,
      shippingMethod, additionalShippingCost, codAmount, actualReceivedAmount,
      transferSlip, paymentStatus, customerAddress, customerPhone, customerZip, needsTaxInvoice, orderStatus, rackDetails, sellerName, trackingNumber,
      bypassDuplicateCheck, adminNote, entryDate, extraSlipUrls, items
    } = body;

    // Product line items — one per line the admin added in Order Entry.
    // crispyPorkWeight/crispyPorkPiece/price above are still written as sent
    // (the client already sums them from these items), but every downstream
    // reader that only knows about those 3 flat fields keeps working
    // unchanged since their meaning ("total across the order") hasn't
    // changed, just what feeds them.
    const validItems: { productType: string; weight: number; pieceCount: number | null; price: number; pricePerKg: number | null }[] = Array.isArray(items)
      ? items
          .map((it: any) => ({
            productType: typeof it?.productType === "string" && it.productType ? it.productType : "PORK",
            weight: Number(it?.weight) || 0,
            pieceCount: it?.pieceCount != null ? Number(it.pieceCount) : null,
            price: Number(it?.price) || 0,
            pricePerKg: it?.pricePerKg != null ? Number(it.pricePerKg) : null,
          }))
          .filter((it: any) => it.weight > 0 || (it.pieceCount ?? 0) > 0)
      : [];

    if (!customerName) {
      return NextResponse.json(
        { error: "Customer Name is required." },
        { status: 400 }
      );
    }

    if (!bypassDuplicateCheck) {
      // Only flag as a risky duplicate when BOTH the name AND the pork weight
      // match an existing order placed within the last 7 days — same name +
      // weight showing up again on day 8+ is treated as a legitimate repeat
      // order, not an accidental double-submit.
      const duplicateWindowCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentOrders = await prisma.order.findMany({
        where: {
          createdAt: {
            gte: duplicateWindowCutoff,
          },
        },
      });

      const matchingOrder = findDuplicateOrder(customerName, crispyPorkWeight, recentOrders);

      if (matchingOrder) {
        return NextResponse.json(
          {
            duplicate: true,
            message: `ชื่อ "${customerName}" และหมูมีน้ำหนัก ${crispyPorkWeight} กก. ตรงกับออเดอร์เก่าที่มีอยู่แล้ว อาจมีความเสี่ยงในการส่งออเดอร์ซ้ำ ต้องการบันทึกออเดอร์นี้ต่อไปหรือไม่?`,
          },
          { status: 200 }
        );
      }

      // Same check against still-waiting "ลูกค้ารอหมู" entries — an admin
      // logging a real order here for a customer someone already put on the
      // waiting list (or forgot they did themselves) is the same duplicate-
      // shipment risk as two real Orders, just not caught by the check
      // above since it only looks at the Order table. Global across admins
      // (not scoped to session), matching that check's own reasoning: which
      // staff member logged which one doesn't change the risk of shipping
      // the same customer's pork twice. Fulfilled entries are excluded —
      // those already became a real Order, which the check above already
      // covers.
      const recentPendingStock = await prisma.pendingStock.findMany({
        where: { createdAt: { gte: duplicateWindowCutoff }, fulfilledAt: null },
      });
      const recentPendingForCheck = recentPendingStock.map((e) => ({
        customerName: e.customerName,
        totalWeightKg: (Array.isArray(e.items) ? (e.items as any[]) : []).reduce((sum, it) => sum + (Number(it?.weightKg) || 0), 0),
        entry: e,
      }));
      const matchingPendingStock = findDuplicatePendingStock(customerName, parseFloat(String(crispyPorkWeight)), recentPendingForCheck);

      if (matchingPendingStock) {
        return NextResponse.json(
          {
            duplicate: true,
            message: `ชื่อ "${customerName}" และหมูมีน้ำหนัก ${crispyPorkWeight} กก. ตรงกับรายการ "ลูกค้ารอหมู" ที่ยังไม่ส่งของ อาจเป็นลูกค้าคนเดียวกันที่ถูกลงซ้ำ ต้องการบันทึกออเดอร์นี้ต่อไปหรือไม่?`,
          },
          { status: 200 }
        );
      }
    }

    let parsedRackDetails: any[] = [];
    if (rackDetails) {
      try {
        parsedRackDetails = JSON.parse(rackDetails);
      } catch(e) { }
    }

    // Save the order and deduct rack weights in a transaction
    const newOrder = await prisma.$transaction(async (tx) => {
      const order = await createOrderRecord(tx, {
        customerName, platform, socialMediaName, crispyPorkPiece, crispyPorkWeight, packedPork, promotion, price,
        shippingMethod, additionalShippingCost, codAmount, actualReceivedAmount,
        transferSlip, paymentStatus, customerAddress, customerPhone, customerZip, needsTaxInvoice, orderStatus,
        rackDetails, sellerName, trackingNumber, adminNote, entryDate, extraSlipUrls, items: validItems,
      });

      // Deduct weight from assigned racks atomically
      for (const rack of parsedRackDetails) {
        if (!rack.assignmentId || !rack.weight) continue;
        const weightToDeduct = parseFloat(rack.weight);
        
        // Use updateMany for safe atomic decrement with condition
        const updatedCount = await tx.rackAssignment.updateMany({
          where: { 
            id: rack.assignmentId,
            remainingWeight: { gte: weightToDeduct - 0.001 } // Add slight tolerance for float issues
          },
          data: {
            remainingWeight: { decrement: weightToDeduct }
          }
        });

        if (updatedCount.count === 0) {
           throw new Error(`ออเดอร์ถูกยกเลิก: ชิ้นส่วนหมูที่คุณเลือกถูกใช้งานโดยแอดมินคนอื่นไปแล้ว (น้ำหนักคงเหลือไม่พอ)`);
        }

        // Check if we need to set isUsedUp (if weight is practically 0)
        const updatedRack = await tx.rackAssignment.findUnique({ where: { id: rack.assignmentId } });
        if (updatedRack && updatedRack.remainingWeight <= 0.001) {
           await tx.rackAssignment.update({ where: { id: rack.assignmentId }, data: { isUsedUp: true, remainingWeight: 0, usedUpAt: new Date() } });
        }
      }

      return order;
    });

    return NextResponse.json({ success: true, order: newOrder }, { status: 201 });
  } catch (error) {
    console.error("Error creating order:", error);
    // Only surface the raw error message when it's one of our own deliberate,
    // already-Thai, user-facing throws (like the rack-conflict case above) —
    // never a raw technical/English error from Prisma or elsewhere, which would
    // be meaningless to a non-technical admin.
    const message = error instanceof Error && /[฀-๿]/.test(error.message)
      ? error.message
      : "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const sellerName = searchParams.get("sellerName");
    const dateStr = searchParams.get("date"); // format: YYYY-MM-DD, filters by createdAt
    const dateFrom = searchParams.get("dateFrom"); // format: YYYY-MM-DD, filters by createdAt
    const dateTo = searchParams.get("dateTo"); // format: YYYY-MM-DD, filters by createdAt
    // Exact match on the admin-chosen/effective entryDate — used by Packing
    // so a backdated order shows on the day it was entered for, not the real
    // instant it was submitted. Includes the packingEntryDate override (see
    // below), since Packing specifically needs that divergence.
    const entryDateStr = searchParams.get("entryDate"); // format: YYYY-MM-DD
    // Range match on the plain entryDate field only — no packingEntryDate
    // involved, since Dashboard/exports want "the day this order was
    // logged," period, same meaning entryDate has everywhere else (order
    // numbering, HR Manage). A plain string range compare is safe: entryDate
    // is always "YYYY-MM-DD", so lexicographic order equals chronological
    // order.
    const entryDateFrom = searchParams.get("entryDateFrom"); // format: YYYY-MM-DD
    const entryDateTo = searchParams.get("entryDateTo"); // format: YYYY-MM-DD
    const platform = searchParams.get("platform");
    const excludePlatform = searchParams.get("excludePlatform"); // comma-separated, e.g. "Storefront,PrivateClient"
    const customerName = searchParams.get("customerName");
    // Broader lookup for HR Manage's search box — same substring match as
    // customerName above, but also checks trackingNumber and customerPhone,
    // so a courier tracking number or a customer's phone digits can find the
    // order too, not just their name.
    const search = searchParams.get("search");

    let whereClause: any = sellerName ? { sellerName } : {};
    if (id) {
      whereClause.id = id;
    }
    const excludePlatformList = excludePlatform ? excludePlatform.split(",").filter(Boolean) : [];
    if (platform) {
      whereClause.platform = platform;
    } else if (excludePlatformList.length > 0) {
      // Lets Order Details hide the walk-in-style pages' own sales (Store
      // Front, Private Clients) from its own order list, the mirror of the
      // platform filter above — each page shows only the orders it's
      // responsible for.
      whereClause.platform = { notIn: excludePlatformList };
    }
    // STOREFRONT's own page only ever asks for platform=Storefront — force
    // it server-side too, so that role can't be used to pull every other
    // channel's customer names/addresses/prices by just dropping the param.
    if (session.role === "STOREFRONT") {
      whereClause.platform = "Storefront";
    }
    if (customerName) {
      whereClause.customerName = { contains: customerName, mode: "insensitive" };
    }
    if (search) {
      whereClause.OR = [
        { customerName: { contains: search, mode: "insensitive" } },
        { trackingNumber: { contains: search, mode: "insensitive" } },
        { customerPhone: { contains: search, mode: "insensitive" } },
      ];
    }

    if (entryDateStr) {
      // Packing's own lookup — also needs to catch an order converted from
      // a "ลูกค้ารอหมู" waiting entry, whose entryDate deliberately stays its
      // original sale date (for Order Details/Dashboard) but which must
      // surface in Packing on the day after stock actually got assigned
      // instead (packingEntryDate), which can be many days later. This is
      // an override, not an addition — an order with packingEntryDate set
      // must ONLY match on that (excluded from the entryDate branch below),
      // or it'd wrongly also show up in Packing on the day after its
      // original entryDate too, before any stock existed for it. Composed
      // via AND rather than assigning .OR directly, since `search` above
      // may have already set its own top-level OR.
      const entryDateCondition = { OR: [{ entryDate: entryDateStr, packingEntryDate: null }, { packingEntryDate: entryDateStr }] };
      whereClause.AND = whereClause.AND ? [...whereClause.AND, entryDateCondition] : [entryDateCondition];
    } else if (entryDateFrom || entryDateTo) {
      whereClause.entryDate = {
        ...(entryDateFrom ? { gte: entryDateFrom } : {}),
        ...(entryDateTo ? { lte: entryDateTo } : {}),
      };
    } else if (dateStr) {
      // Parse the date in Thai timezone (approximate by using UTC+7 offset or just treating input as local date)
      // Since server might be UTC, best to create start and end boundaries for the date string.
      const startDate = new Date(`${dateStr}T00:00:00+07:00`);
      const endDate = new Date(`${dateStr}T23:59:59.999+07:00`);
      whereClause.createdAt = {
        gte: startDate,
        lte: endDate
      };
    } else if (dateFrom || dateTo) {
      whereClause.createdAt = {
        ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00+07:00`) } : {}),
        ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999+07:00`) } : {}),
      };
    }

    // Any explicit, scoped filter (date, platform, or a name search) means the
    // caller wants everything matching, not a "give me something recent"
    // sample — only cap the truly unscoped call.
    const isScoped = Boolean(id || dateStr || dateFrom || dateTo || entryDateStr || entryDateFrom || entryDateTo || platform || excludePlatform || customerName || search);

    const orders = await prisma.order.findMany({
      where: whereClause,
      include: { extraSlips: true, items: true },
      orderBy: {
        createdAt: "desc",
      },
      ...(isScoped ? {} : { take: 20 }),
    });
    return NextResponse.json({ orders }, { status: 200 });
  } catch (error) {
    console.error("Error fetching orders:", error);
    return NextResponse.json(
      { error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" },
      { status: 500 }
    );
  }
}
