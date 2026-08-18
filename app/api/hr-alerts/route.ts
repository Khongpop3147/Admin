import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../lib/session";
import { isSuperAdminRole } from "../../../lib/roles";

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

// Same "who can reach HR Manage" gate the page itself uses (see
// app/hr-manage/page.tsx's canAccess) — this feature lives inside that page,
// so creating/viewing sent alerts follows the same permission.
function canSendAlerts(role?: string | null): boolean {
  return isSuperAdminRole(role) || role === "HR";
}

// GET: recent sent alerts, for the HR Manage page's own "sent history" list
// — not the per-recipient popup (see /api/hr-alerts/pending for that).
export async function GET() {
  try {
    const session = await getSessionUser();
    if (!session || !canSendAlerts(session.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }
    const alerts = await prisma.hrAlert.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ alerts }, { status: 200 });
  } catch (error) {
    console.error("Error fetching HR alerts:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session || !canSendAlerts(session.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const body = await req.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const recipientIds = Array.isArray(body.recipientIds)
      ? body.recipientIds.filter((id: any) => typeof id === "string" && id.trim())
      : [];

    if (!message) {
      return NextResponse.json({ error: "กรุณาใส่ข้อความ" }, { status: 400 });
    }
    if (recipientIds.length === 0) {
      return NextResponse.json({ error: "กรุณาเลือกผู้รับอย่างน้อย 1 คน" }, { status: 400 });
    }

    const alert = await prisma.hrAlert.create({
      data: { message, createdBy: session.name, recipientIds },
    });

    return NextResponse.json({ success: true, alert }, { status: 201 });
  } catch (error) {
    console.error("Error creating HR alert:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
