import { NextResponse } from "next/server";
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

// Confirms COD orders as "received" — the courier's tracking-number report
// is the source of truth that the customer actually paid on delivery.
export async function POST(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session || !(session.role === "PACKING" || isSuperAdminRole(session.role))) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { trackingNumbers } = await req.json();

    if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
      return NextResponse.json({ error: "ไม่มีเลขพัสดุให้ตรวจสอบ" }, { status: 400 });
    }

    const cleanedNumbers = Array.from(
      new Set(
        trackingNumbers
          .map((t) => (typeof t === "string" ? t.trim() : String(t ?? "").trim()))
          .filter(Boolean)
      )
    );

    // Only COD orders that haven't been confirmed yet are eligible — a
    // tracking number that matches a non-COD order or an already-confirmed
    // one is silently skipped (not an error, just nothing to do there).
    const matchedOrders = await prisma.order.findMany({
      where: {
        trackingNumber: { in: cleanedNumbers },
        codAmount: { gt: 0 },
        codConfirmed: false,
      },
    });

    if (matchedOrders.length > 0) {
      await prisma.order.updateMany({
        where: { id: { in: matchedOrders.map((o) => o.id) } },
        data: { codConfirmed: true },
      });
      await prisma.orderAuditLog.create({
        data: {
          action: "EDIT",
          summary: `ยืนยันรับ COD แล้ว ${matchedOrders.length} ออเดอร์ (เลขพัสดุ: ${matchedOrders.map((o) => o.trackingNumber).join(", ")})`,
        },
      });
    }

    const matchedTrackingNumbers = new Set(matchedOrders.map((o) => o.trackingNumber));
    const unmatched = cleanedNumbers.filter((t) => !matchedTrackingNumbers.has(t));

    return NextResponse.json({
      success: true,
      confirmed: matchedOrders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        customerName: o.customerName,
        trackingNumber: o.trackingNumber,
        codAmount: o.codAmount,
        actualReceivedAmount: o.actualReceivedAmount,
      })),
      unmatched,
    });
  } catch (error) {
    console.error("Error confirming COD:", error);
    return NextResponse.json(
      { error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" },
      { status: 500 }
    );
  }
}
