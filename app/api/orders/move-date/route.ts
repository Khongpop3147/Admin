import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Moves a batch of orders (which must all currently share one entryDate) to
// a different entryDate, and keeps orderNo contiguous (1..N, no gaps) on
// both the source and destination day — same manual fix-up this replaces:
// append the moved orders to the end of the destination day, then close
// whatever gap they left behind on the source day. Everything happens in
// one Serializable transaction so a real order landing on either day at the
// same moment can't produce a duplicate or a gap (this bit us once, done by
// hand, before this endpoint existed).
export async function POST(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session || !isSuperAdminRole(session.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const body = await req.json();
    const orderIds: string[] = Array.isArray(body.orderIds) ? body.orderIds : [];
    const newEntryDate: string = body.newEntryDate;

    if (orderIds.length === 0) {
      return NextResponse.json({ error: "กรุณาเลือกออเดอร์อย่างน้อย 1 รายการ" }, { status: 400 });
    }
    if (!DATE_RE.test(newEntryDate)) {
      return NextResponse.json({ error: "วันที่ปลายทางไม่ถูกต้อง" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const orders = await tx.order.findMany({ where: { id: { in: orderIds } } });
      if (orders.length !== orderIds.length) {
        throw new Error("NOT_FOUND");
      }

      const sourceDate = orders[0].entryDate;
      if (orders.some((o) => o.entryDate !== sourceDate)) {
        throw new Error("MIXED_DATES");
      }
      if (sourceDate === newEntryDate) {
        throw new Error("SAME_DATE");
      }

      // Reserve `orders.length` consecutive numbers at the end of the
      // destination day in one atomic increment.
      const destCounter = await tx.dailyCounter.upsert({
        where: { date: newEntryDate },
        update: { lastOrder: { increment: orders.length } },
        create: { date: newEntryDate, lastOrder: orders.length },
      });
      const destStart = destCounter.lastOrder - orders.length + 1;

      // Assign new numbers in the movers' original relative order.
      const sorted = [...orders].sort((a, b) => a.orderNo - b.orderNo);
      for (let i = 0; i < sorted.length; i++) {
        await tx.order.update({
          where: { id: sorted[i].id },
          data: { entryDate: newEntryDate, orderNo: destStart + i },
        });
      }

      // Close the gap left behind on the source day.
      const remaining = await tx.order.findMany({
        where: { entryDate: sourceDate },
        orderBy: { orderNo: "asc" },
      });
      for (let i = 0; i < remaining.length; i++) {
        const wantNo = i + 1;
        if (remaining[i].orderNo !== wantNo) {
          await tx.order.update({ where: { id: remaining[i].id }, data: { orderNo: wantNo } });
        }
      }
      await tx.dailyCounter.upsert({
        where: { date: sourceDate },
        update: { lastOrder: remaining.length },
        create: { date: sourceDate, lastOrder: remaining.length },
      });

      const summary = `ย้ายออเดอร์ ${orders.length} รายการ (${sorted.map((o) => `#${o.orderNo}`).join(", ")}) จากวันที่ ${sourceDate} ไปวันที่ ${newEntryDate} → เลขใหม่ #${destStart}-${destCounter.lastOrder}`;
      for (const o of sorted) {
        await tx.orderAuditLog.create({
          data: { orderId: o.id, action: "EDIT", summary, performedBy: session.name },
        });
      }

      return { sourceDate, newEntryDate, movedCount: orders.length, destRange: [destStart, destCounter.lastOrder], sourceRemaining: remaining.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (error: any) {
    console.error("Error moving order date:", error);
    if (error?.message === "NOT_FOUND") {
      return NextResponse.json({ error: "ไม่พบออเดอร์บางรายการ อาจถูกลบ/ย้ายไปแล้ว" }, { status: 404 });
    }
    if (error?.message === "MIXED_DATES") {
      return NextResponse.json({ error: "ออเดอร์ที่เลือกต้องอยู่วันเดียวกันทั้งหมด" }, { status: 400 });
    }
    if (error?.message === "SAME_DATE") {
      return NextResponse.json({ error: "วันที่ปลายทางต้องต่างจากวันที่ปัจจุบันของออเดอร์" }, { status: 400 });
    }
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
