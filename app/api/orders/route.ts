import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

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
    const body = await req.json();
    const { 
      customerName, platform, socialMediaName, crispyPorkPiece, crispyPorkWeight, packedPork, promotion, price, 
      shippingMethod, additionalShippingCost, codAmount, actualReceivedAmount, 
      transferSlip, paymentStatus, customerAddress, orderStatus, rackDetails, sellerName, trackingNumber,
      bypassDuplicateCheck, adminNote
    } = body;

    if (!customerName) {
      return NextResponse.json(
        { error: "Customer Name is required." },
        { status: 400 }
      );
    }

    if (!bypassDuplicateCheck) {
      // Check for duplicate customer name (Alert if admin types same name)
      const existingOrder = await prisma.order.findFirst({
        where: {
          customerName: {
            equals: customerName,
          }
        },
      });

      if (existingOrder) {
        return NextResponse.json(
          {
            duplicate: true,
            message: `พบว่ามีลูกค้าชื่อ "${customerName}" อยู่ในระบบแล้ว ต้องการบันทึกออเดอร์นี้ต่อไปหรือไม่?`,
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
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      // 2. Increment DailyCounter atomically ONLY for non-storefront orders
      let currentOrderNo = 0;
      if (platform !== 'Storefront') {
        const counter = await tx.dailyCounter.upsert({
          where: { date: dateKey },
          update: { lastOrder: { increment: 1 } },
          create: { date: dateKey, lastOrder: 1 }
        });
        currentOrderNo = counter.lastOrder;
      }

      // 3. Create the order
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
        },
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
           await tx.rackAssignment.update({ where: { id: rack.assignmentId }, data: { isUsedUp: true, remainingWeight: 0 } });
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
    const { searchParams } = new URL(req.url);
    const sellerName = searchParams.get("sellerName");
    const dateStr = searchParams.get("date"); // format: YYYY-MM-DD
    const platform = searchParams.get("platform");

    let whereClause: any = sellerName ? { sellerName } : {};
    if (platform) {
      whereClause.platform = platform;
    }

    if (dateStr) {
      // Parse the date in Thai timezone (approximate by using UTC+7 offset or just treating input as local date)
      // Since server might be UTC, best to create start and end boundaries for the date string.
      const startDate = new Date(`${dateStr}T00:00:00+07:00`);
      const endDate = new Date(`${dateStr}T23:59:59.999+07:00`);
      whereClause.createdAt = {
        gte: startDate,
        lte: endDate
      };
    }

    // Any explicit, scoped filter (date or platform) means the caller wants
    // everything matching, not a "give me something recent" sample — only cap
    // the truly unscoped call.
    const isScoped = Boolean(dateStr || platform);

    const orders = await prisma.order.findMany({
      where: whereClause,
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
