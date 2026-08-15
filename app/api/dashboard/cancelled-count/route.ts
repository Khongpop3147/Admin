import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../lib/session";
import { isSuperAdminRole } from "../../../../lib/roles";

const globalForPrisma = global as unknown as { prisma: PrismaClient };
let prisma: PrismaClient;
if (globalForPrisma.prisma) {
  prisma = globalForPrisma.prisma;
} else {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
}
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export const dynamic = "force-dynamic";

// How many sales Dashboard already counted got reversed within a date range
// — two sources, both read back from OrderAuditLog:
//   - "PENDING_STOCK_CANCELLED": a still-waiting "ลูกค้ารอหมู" entry deleted
//     before it ever shipped (see DELETE /api/pending-stock/[id]).
//   - "ORDER_CANCELLED": a real Order deleted from Packing (see
//     DELETE /api/orders/[id]).
// Both count toward Dashboard's totalSales the moment they're created, so
// either kind of delete is a genuine reversal of money already shown as
// sold, not just tidying up a mistake — surfaced together as one banner.
// Same per-admin scoping as the rest of Dashboard: a regular admin only
// ever sees their own, Super Admin sees everyone (or one admin via ?admin=).
export async function GET(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const adminParam = searchParams.get("admin");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const whereClause: any = { action: { in: ["PENDING_STOCK_CANCELLED", "ORDER_CANCELLED"] } };
    if (isSuperAdminRole(session.role)) {
      if (adminParam) whereClause.performedBy = adminParam;
    } else {
      whereClause.performedBy = session.name;
    }
    if (dateFrom || dateTo) {
      whereClause.createdAt = {
        ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00+07:00`) } : {}),
        ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999+07:00`) } : {}),
      };
    }

    const [count, sum] = await Promise.all([
      prisma.orderAuditLog.count({ where: whereClause }),
      prisma.orderAuditLog.aggregate({ where: whereClause, _sum: { amount: true } }),
    ]);
    return NextResponse.json({ success: true, count, totalAmount: sum._sum.amount || 0 }, { status: 200 });
  } catch (error) {
    console.error("Error counting cancelled sales:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
