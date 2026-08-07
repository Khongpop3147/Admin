import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { getSessionUser } from "../../../lib/session";
import { isSuperAdminRole } from "../../../lib/roles";
import { runMonthlyPorkCleanupIfNeeded } from "../../../lib/porkCleanup";
import { runSlipCleanupIfNeeded } from "../../../lib/slipCleanup";
import { ensureCentralInventoryUser } from "../../../lib/centralInventory";

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

function stripPassword<T extends { password?: string | null }>(user: T) {
  const { password, ...rest } = user;
  return { ...rest, hasPassword: !!password };
}

export async function GET() {
  try {
    // Piggybacks both cleanup jobs on this endpoint since it's hit
    // constantly (every page load, after every order/rack change) and
    // there's no cron infrastructure — cheap no-op except the first
    // request after their respective windows roll over.
    await runMonthlyPorkCleanupIfNeeded(prisma);
    await runSlipCleanupIfNeeded(prisma);

    await ensureCentralInventoryUser(prisma);

    const users = await prisma.user.findMany({
      include: {
        racks: true,
      },
      orderBy: {
        name: "asc",
      },
    });
    return NextResponse.json({ users: users.map(stripPassword) }, { status: 200 });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}

// "DEV" is intentionally excluded — that role can only be set directly in
// the database, never through this API, no matter who's calling it.
const ALLOWED_ROLES = ["SUPER_ADMIN", "ADMIN", "PACKING", "STOREFRONT", "HR"];

export async function POST(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session || !isSuperAdminRole(session.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const body = await req.json();
    const name = (body.name || "").trim();
    const nickname = (body.nickname || "").trim();
    const role = body.role;
    const password = body.password || "";
    const canAccessStorefront = !!body.canAccessStorefront;

    if (!name) {
      return NextResponse.json({ error: "กรุณาใส่ชื่อ" }, { status: 400 });
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: "ตำแหน่งไม่ถูกต้อง" }, { status: 400 });
    }
    if (!password || password.length < 4) {
      return NextResponse.json({ error: "รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, nickname: nickname || null, role, password: hashedPassword, canAccessStorefront },
      include: { racks: true },
    });
    return NextResponse.json({ user: stripPassword(user) }, { status: 201 });
  } catch (error) {
    console.error("Error creating user:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
