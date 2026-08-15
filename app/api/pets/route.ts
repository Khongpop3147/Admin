import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../lib/session";
import { SPECIES, GrowthStage, getGrowthStage } from "../../../lib/petCatalog";

const VALID_STAGES = new Set<GrowthStage>(["baby", "adult"]);

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

// An admin's pet is scoped strictly to their own session — there's no
// cross-admin viewing in this MVP, so userId always comes from the session,
// never from a client-supplied param.
export async function GET() {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    // All-time count, no date scoping — deliberately a fresh count here
    // rather than reusing Dashboard's per-admin breakdown, which is scoped
    // to whatever date range is currently selected there.
    const [orderCount, pet] = await Promise.all([
      prisma.order.count({ where: { sellerName: session.name } }),
      prisma.pet.findUnique({ where: { userId: session.userId } }),
    ]);

    // DEV-only escape hatch: a manual stage override (set via PATCH
    // /api/pets/stage) takes priority over the computed one — every other
    // role always gets the normal order-count-derived value, untouched.
    const isDev = session.role === "DEV";
    const computedStage = getGrowthStage(orderCount);
    const stageOverride = pet?.stageOverride;
    const growthStage: GrowthStage =
      isDev && stageOverride && VALID_STAGES.has(stageOverride as GrowthStage)
        ? (stageOverride as GrowthStage)
        : computedStage;

    return NextResponse.json(
      {
        success: true,
        orderCount,
        // Computed server-side so the client never re-derives this
        // business rule from a raw count and risks drifting if the
        // catalog's thresholds change.
        growthStage,
        isDev,
        // null until the admin picks a species for the first time.
        pet,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching pet:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}

// Picks (or switches) the admin's one active pet's species. There's only
// ever one row per admin (Pet.userId is unique), so this is a plain upsert
// — no limit on how many times an admin can call this to change species.
export async function POST(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { species } = await req.json();
    if (typeof species !== "string" || !SPECIES[species]) {
      return NextResponse.json({ error: "ไม่พบสายพันธุ์นี้" }, { status: 400 });
    }

    const pet = await prisma.pet.upsert({
      where: { userId: session.userId },
      create: { userId: session.userId, species },
      update: { species },
    });

    return NextResponse.json({ success: true, pet }, { status: 200 });
  } catch (error) {
    console.error("Error choosing pet species:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
