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
    const { userId, racks } = await req.json();

    if (!userId || !racks || !Array.isArray(racks)) {
      return NextResponse.json({ error: "User ID and an array of racks are required" }, { status: 400 });
    }

    const rackNos = racks.map((r: any) => r.rackNo);
    const existingActiveRacks = await prisma.rackAssignment.findMany({
      where: {
        rackNo: { in: rackNos },
        isUsedUp: false
      }
    });

    if (existingActiveRacks.length > 0) {
      const duplicateNames = existingActiveRacks.map(r => r.rackNo).join(', ');
      return NextResponse.json({ error: `ไม่สามารถบันทึกได้ เนื่องจากมี Rack ต่อไปนี้กำลังถูกใช้งานอยู่: ${duplicateNames}` }, { status: 400 });
    }

    const createdAssignments = [];

    for (const rack of racks) {
      const assignment = await prisma.rackAssignment.create({
        data: {
          userId,
          rackNo: rack.rackNo,
          initialWeight: rack.weight,
          remainingWeight: rack.weight,
        },
      });
      createdAssignments.push(assignment);
    }

    return NextResponse.json({ success: true, count: createdAssignments.length }, { status: 201 });
  } catch (error: any) {
    console.error("Error batch assigning racks:", error);
    if (error.code === 'P2002') {
      return NextResponse.json({ error: "One or more racks are already assigned to this user." }, { status: 400 });
    }
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
