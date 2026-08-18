import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../lib/session";

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

export const dynamic = 'force-dynamic';

// Any logged-in user can poll this — it only ever returns alerts targeted
// at their own session, never anyone else's (see components/HrAlertPopup.tsx,
// applied off sessionUser like theme/mode, not currentUser, so a DEV
// previewing as someone else still sees their own real alerts).
export async function GET() {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const alerts = await prisma.hrAlert.findMany({
      where: {
        recipientIds: { has: session.userId },
        NOT: { seenByIds: { has: session.userId } },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ alerts }, { status: 200 });
  } catch (error) {
    console.error("Error fetching pending HR alerts:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
