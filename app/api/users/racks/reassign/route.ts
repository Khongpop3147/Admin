import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

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

export async function POST(req: Request) {
  try {
    const { rackIds, newUserId } = await req.json();

    if (!rackIds || !Array.isArray(rackIds) || rackIds.length === 0 || !newUserId) {
      return NextResponse.json({ error: "Rack IDs array and New User ID are required" }, { status: 400 });
    }

    // Verify racks exist and are not used up
    const existingRacks = await prisma.rackAssignment.findMany({
      where: {
        id: { in: rackIds },
        isUsedUp: false
      }
    });

    if (existingRacks.length !== rackIds.length) {
      return NextResponse.json({ error: "Some racks were not found or are already used up." }, { status: 400 });
    }

    // Check if the new user already has a rack with the same rackNo
    const existingRackNos = existingRacks.map(r => r.rackNo);
    const conflicts = await prisma.rackAssignment.findMany({
      where: {
        userId: newUserId,
        rackNo: { in: existingRackNos }
      }
    });

    if (conflicts.length > 0) {
      const conflictNames = conflicts.map(c => c.rackNo).join(', ');
      return NextResponse.json({ error: `ย้ายไม่ได้ เนื่องจากผู้รับมีชิ้นรหัสนี้อยู่แล้ว: ${conflictNames}` }, { status: 400 });
    }

    // Reassign racks in a transaction
    await prisma.$transaction(async (tx) => {
      for (const rackId of rackIds) {
        await tx.rackAssignment.update({
          where: { id: rackId },
          data: { userId: newUserId }
        });
      }
    });

    return NextResponse.json({ success: true, count: rackIds.length }, { status: 200 });
  } catch (error: any) {
    console.error("Error reassigning racks:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
