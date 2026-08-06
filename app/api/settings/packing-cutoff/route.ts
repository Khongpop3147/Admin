import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../lib/session";
import { isSuperAdminRole } from "../../../../lib/roles";
import { nextDayStr } from "../../../../lib/packingCutoff";

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

// Closes out today's order numbering from Order Details — deliberately
// separate from /api/orders/bulk (the Packing page's "จบงานวันนี้", which
// also bulk-marks orders as Shipped). This only sets packingCutoffDate;
// any order created for the rest of today then gets numbered as tomorrow's
// instead (see effectiveOrderDateKey in POST /api/orders), which in turn
// surfaces on Packing a day after that (Packing already shows a day ahead
// of entryDate) — no existing order's status is touched.
export async function POST() {
  try {
    const session = await getSessionUser();
    if (!session || !isSuperAdminRole(session.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const todayDateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    await prisma.settings.upsert({
      where: { id: "singleton" },
      update: { packingCutoffDate: todayDateKey },
      create: { id: "singleton", packingCutoffDate: todayDateKey },
    });

    return NextResponse.json(
      { success: true, cutoffDate: todayDateKey, nextOrderDate: nextDayStr(todayDateKey) },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error setting packing cutoff:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
