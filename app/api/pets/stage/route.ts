import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../lib/session";
import { GrowthStage } from "../../../../lib/petCatalog";

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

const VALID_STAGES = new Set<GrowthStage>(["baby", "adult"]);

// DEV-only: manually pin the session's own pet to a growth stage, bypassing
// the normal order-count derivation — or pass stage: null to go back to
// automatic. Every other role gets 403; this is a "see anything" toggle for
// the role that already gets extra testing/power-user capabilities
// elsewhere (see app/api/users/[id]/kick/route.ts for the same pattern).
export async function PATCH(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session || session.role !== "DEV") {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { stage } = await req.json();
    if (stage !== null && !VALID_STAGES.has(stage)) {
      return NextResponse.json({ error: "ช่วงวัยไม่ถูกต้อง" }, { status: 400 });
    }

    const pet = await prisma.pet.findUnique({ where: { userId: session.userId } });
    if (!pet) {
      return NextResponse.json({ error: "ยังไม่มีสัตว์เลี้ยง กรุณาเลือกสัตว์เลี้ยงก่อน" }, { status: 404 });
    }

    const updated = await prisma.pet.update({
      where: { userId: session.userId },
      data: { stageOverride: stage },
    });

    return NextResponse.json({ success: true, pet: updated }, { status: 200 });
  } catch (error) {
    console.error("Error setting pet stage override:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
