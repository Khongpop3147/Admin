import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../../lib/session";
import { isSuperAdminRole } from "../../../../../lib/roles";

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
    const session = await getSessionUser();
    if (!session || !isSuperAdminRole(session.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { userId, racks } = await req.json();

    if (!userId || !racks || !Array.isArray(racks)) {
      return NextResponse.json({ error: "User ID and an array of racks are required" }, { status: 400 });
    }

    const rackNos = racks.map((r: any) => r.rackNo);

    // The duplicate check and the creates have to happen as one atomic unit —
    // otherwise two overlapping requests (e.g. distributing to an admin and
    // to Storefront within moments of each other) can both pass the check
    // before either has committed, and the same piece ends up created twice
    // under two different owners. Serializable isolation makes Postgres
    // abort one of the two transactions instead of letting that happen.
    const createdAssignments = await prisma.$transaction(async (tx) => {
      const existingActiveRacks = await tx.rackAssignment.findMany({
        where: {
          rackNo: { in: rackNos },
          isUsedUp: false
        }
      });

      if (existingActiveRacks.length > 0) {
        const duplicateNames = existingActiveRacks.map(r => r.rackNo).join(', ');
        throw new Error(`DUPLICATE_RACK:${duplicateNames}`);
      }

      const created = [];
      for (const rack of racks) {
        const assignment = await tx.rackAssignment.create({
          data: {
            userId,
            rackNo: rack.rackNo,
            initialWeight: rack.weight,
            remainingWeight: rack.weight,
          },
        });
        created.push(assignment);
      }
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ success: true, count: createdAssignments.length }, { status: 201 });
  } catch (error: any) {
    console.error("Error batch assigning racks:", error);
    if (typeof error?.message === 'string' && error.message.startsWith('DUPLICATE_RACK:')) {
      const duplicateNames = error.message.slice('DUPLICATE_RACK:'.length);
      return NextResponse.json({ error: `ไม่สามารถบันทึกได้ เนื่องจากมี Rack ต่อไปนี้กำลังถูกใช้งานอยู่: ${duplicateNames}` }, { status: 400 });
    }
    if (error.code === 'P2002') {
      return NextResponse.json({ error: "One or more racks are already assigned to this user." }, { status: 400 });
    }
    // Serializable-isolation write conflicts surface as P2034 through
    // Prisma's own engine, but as a DriverAdapterError with this `cause`
    // shape when going through @prisma/adapter-pg (as this project does) —
    // check both so the retry message actually gets used either way.
    if (error.code === 'P2034' || error?.cause?.kind === 'TransactionWriteConflict') {
      return NextResponse.json({ error: "มีการแก้ไขคลังพร้อมกันจากที่อื่น กรุณาลองใหม่อีกครั้ง" }, { status: 409 });
    }
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
