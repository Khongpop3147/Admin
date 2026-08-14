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

const SETTINGS_ID = "singleton";

// upsert (atomic at the DB level) instead of findUnique-then-create — the
// old pattern raced on a fresh install: two concurrent requests before the
// Settings row ever existed could both see "not found" and both try to
// create it, and the second create would throw on the id collision instead
// of just succeeding (same bug class as lib/centralInventory.ts).
async function getOrCreateSettings() {
  return prisma.settings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
}

export async function GET() {
  try {
    const settings = await getOrCreateSettings();
    return NextResponse.json({ settings }, { status: 200 });
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}

const NUMERIC_FIELDS = [
  "commissionRate",
  "returnPenalty",
  "codFlatFeeThreshold",
  "codFlatFee",
  "codDivisor",
  "codMultiplier",
  "porkPricePerKg",
  "porkLoinPricePerKg",
  "porkHipPricePerKg",
] as const;

export async function PATCH(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session || !isSuperAdminRole(session.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    await getOrCreateSettings();
    const body = await req.json();

    const updateData: any = {};
    for (const field of NUMERIC_FIELDS) {
      if (body[field] !== undefined) {
        const val = Number(body[field]);
        if (isNaN(val) || val < 0) {
          return NextResponse.json({ error: `ค่า ${field} ไม่ถูกต้อง` }, { status: 400 });
        }
        updateData[field] = val;
      }
    }

    const settings = await prisma.settings.update({
      where: { id: SETTINGS_ID },
      data: updateData,
    });
    return NextResponse.json({ settings }, { status: 200 });
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
