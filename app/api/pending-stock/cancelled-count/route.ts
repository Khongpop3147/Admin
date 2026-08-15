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

// How many still-waiting "ลูกค้ารอหมู" entries got deleted (never sent to
// packing) within a date range — Dashboard's own sales figures count this
// money the moment it's logged, so a delete before conversion is a real
// reversal of money already shown as sold, not just tidying up a mistake.
// Reads the "PENDING_STOCK_CANCELLED" log DELETE /api/pending-stock/[id]
// writes to OrderAuditLog. Same per-admin scoping as GET /api/pending-stock
// itself: a regular admin only ever sees their own, Super Admin sees
// everyone (or one admin via ?admin=).
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

    const whereClause: any = { action: "PENDING_STOCK_CANCELLED" };
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
    console.error("Error counting cancelled pending stock entries:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
