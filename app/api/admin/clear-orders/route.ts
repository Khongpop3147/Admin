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

const CONFIRM_PHRASE = "ลบข้อมูล";

// Wipes Order rows only (and, for a full wipe, resets the DailyCounter so
// order numbering restarts clean) — never touches Users or rack inventory,
// those are separate concerns with their own management tools.
export async function POST(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session || !isSuperAdminRole(session.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const body = await req.json();
    const { mode, dateFrom, dateTo, confirmText, performedBy } = body;

    if (confirmText !== CONFIRM_PHRASE) {
      return NextResponse.json({ error: `กรุณาพิมพ์ "${CONFIRM_PHRASE}" ให้ตรงเพื่อยืนยัน` }, { status: 400 });
    }

    let whereClause: any = {};
    let rangeDescription = "ทั้งหมด";

    if (mode === "range") {
      if (!dateFrom || !dateTo) {
        return NextResponse.json({ error: "กรุณาเลือกช่วงวันที่" }, { status: 400 });
      }
      whereClause.createdAt = {
        gte: new Date(`${dateFrom}T00:00:00+07:00`),
        lte: new Date(`${dateTo}T23:59:59.999+07:00`),
      };
      rangeDescription = `${dateFrom} ถึง ${dateTo}`;
    } else if (mode !== "all") {
      return NextResponse.json({ error: "โหมดไม่ถูกต้อง" }, { status: 400 });
    }

    const count = await prisma.order.count({ where: whereClause });

    await prisma.order.deleteMany({ where: whereClause });

    if (mode === "all") {
      await prisma.dailyCounter.deleteMany({});
    }

    await prisma.orderAuditLog.create({
      data: {
        action: "BULK_CLEAR",
        summary: `ล้างข้อมูลออเดอร์ ${count} รายการ (ช่วง: ${rangeDescription})${mode === "all" ? " + รีเซ็ตเลขออเดอร์รายวัน" : ""}`,
        performedBy: performedBy || null,
      },
    });

    return NextResponse.json({ success: true, deletedCount: count }, { status: 200 });
  } catch (error) {
    console.error("Error clearing orders:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
