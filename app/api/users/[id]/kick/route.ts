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

// Force-invalidates every currently-active login for a user, regardless of
// how much of its 30-day expiry is left — see lib/session.ts's
// verifySession for how the sessionVersion bump actually takes effect.
// DEV-only by explicit request, not just Super Admin — this is a step
// beyond what a regular Super Admin account can do.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionUser();
    if (!session || session.role !== "DEV") {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { id } = await params;

    const user = await prisma.user.update({
      where: { id },
      data: { sessionVersion: { increment: 1 } },
      select: { id: true, name: true },
    });

    return NextResponse.json({ success: true, user }, { status: 200 });
  } catch (error: any) {
    console.error("Error kicking user session:", error);
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "ไม่พบ user นี้" }, { status: 404 });
    }
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
