import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../../lib/session";

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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }
    const { id } = await params;

    const alert = await prisma.hrAlert.findUnique({ where: { id } });
    if (!alert) {
      return NextResponse.json({ error: "ไม่พบข้อความ" }, { status: 404 });
    }

    // Idempotent — fetch-then-set a deduped array rather than a blind
    // `push`, so double-clicking "รับทราบ" (or the popup's poll racing a
    // dismiss) can't grow seenByIds with duplicate entries.
    if (!alert.seenByIds.includes(session.userId)) {
      await prisma.hrAlert.update({
        where: { id },
        data: { seenByIds: [...alert.seenByIds, session.userId] },
      });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error dismissing HR alert:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
