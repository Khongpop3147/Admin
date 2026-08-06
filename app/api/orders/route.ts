import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../lib/session";
import { findDuplicateOrder } from "../../../lib/orderDuplicate";
import { isShelfSale } from "../../../lib/money";
import { effectiveOrderDateKey } from "../../../lib/packingCutoff";

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
      transferSlip, paymentStatus, customerAddress, orderStatus, rackDetails, sellerName, trackingNumber,
      bypassDuplicateCheck, adminNote, entryDate, extraSlipUrls
    } = body;

    if (!customerName) {
      return NextResponse.json(
        { error: "Customer Name is required." },
        { status: 400 }
      );
    }

    if (!bypassDuplicateCheck) {
      // Only flag as a risky duplicate when BOTH the name AND the pork weight
      // match an existing order placed within the last 3 days — same name +
      // weight showing up again on day 4+ is treated as a legitimate repeat
      // order, not an accidental double-submit.
      const duplicateWindowCutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
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
    }

    let parsedRackDetails: any[] = [];
    if (rackDetails) {
      try {
        parsedRackDetails = JSON.parse(rackDetails);
      } catch(e) { }
    }

    // Save the order and deduct rack weights in a transaction
    const newOrder = await prisma.$transaction(async (tx) => {
      // 1. Get today's date in Thai time for the daily counter
      const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
      const todayDateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      // An admin can explicitly pick which date this order counts as (e.g.
      // logging a walk-in sale from yesterday's paper notes) — falls back to
      // today when left blank. Either way, still run it through the cutoff
      // shift below, so a backdated/forward-dated order lands consistently
      // with whatever Packing has already closed out for that date.
      const baseDateKey = typeof entryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entryDate)
        ? entryDate
        : todayDateKey;

      // Once Packing has closed out a date (see /api/orders/bulk), any order
      // entered for the rest of that day gets numbered under the next day
      // instead of tacking onto a batch Packing already considers finished.
      const settings = await tx.settings.findUnique({ where: { id: "singleton" } });
      const dateKey = effectiveOrderDateKey(baseDateKey, settings?.packingCutoffDate);

      // 2. Increment DailyCounter atomically for every order EXCEPT an anonymous
      // shelf placement ("วางขายหน้าร้าน") — that's just a stock deduction, not
      // a trackable sale. A storefront order with a real customer name still
      // gets a real sequential number, same as any other channel.
      let currentOrderNo = 0;
      if (!isShelfSale({ platform, customerName })) {
        const counter = await tx.dailyCounter.upsert({
          where: { date: dateKey },
          update: { lastOrder: { increment: 1 } },
          create: { date: dateKey, lastOrder: 1 }
        });
        currentOrderNo = counter.lastOrder;
      }

      // 3. Create the order
      const validExtraSlipUrls: string[] = Array.isArray(extraSlipUrls)
        ? extraSlipUrls.filter((u: unknown) => typeof u === "string" && u.trim())
        : [];

      const order = await tx.order.create({
        data: {
          orderNo: currentOrderNo,
          customerName,
          platform,
          socialMediaName,
          crispyPorkPiece,
          crispyPorkWeight,
          packedPork,
          promotion,
          price: price ? parseFloat(price) : null,
          shippingMethod,
          additionalShippingCost: additionalShippingCost ? parseFloat(additionalShippingCost) : null,
          codAmount: codAmount ? parseFloat(codAmount) : null,
          actualReceivedAmount: actualReceivedAmount ? parseFloat(actualReceivedAmount) : null,
          transferSlip,
          paymentStatus,
          customerAddress,
          orderStatus,
          rackDetails, // Store the JSON string directly
          sellerName,
          trackingNumber,
          adminNote,
          entryDate: dateKey,
          // Only ever non-empty when a customer paid short and transferred
          // the rest separately — transferSlip above still holds the
          // primary/first slip exactly as before.
          extraSlips: validExtraSlipUrls.length > 0
            ? { create: validExtraSlipUrls.map((url: string) => ({ url })) }
            : undefined,
        },
        include: { extraSlips: true },
      });

      // 4. Deduct weight from assigned racks atomically
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
    // instead of `date` so a backdated order shows on the day it was entered
    // for, not the real instant it was submitted (which `date` still reflects
    // for Order Details/Dashboard).
    const entryDateStr = searchParams.get("entryDate"); // format: YYYY-MM-DD
    const platform = searchParams.get("platform");
    const excludePlatform = searchParams.get("excludePlatform");
    const customerName = searchParams.get("customerName");

    let whereClause: any = sellerName ? { sellerName } : {};
    if (id) {
      whereClause.id = id;
    }
    if (platform) {
      whereClause.platform = platform;
    } else if (excludePlatform) {
      // Lets Order Details hide Private-Clients (Storefront-platform) walk-in
      // sales from its own order list, the mirror of the platform filter
      // above — each page shows only the orders it's responsible for.
      whereClause.platform = { not: excludePlatform };
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

    if (entryDateStr) {
      whereClause.entryDate = entryDateStr;
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
    const isScoped = Boolean(id || dateStr || dateFrom || dateTo || entryDateStr || platform || excludePlatform || customerName);

    const orders = await prisma.order.findMany({
      where: whereClause,
      include: { extraSlips: true },
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
