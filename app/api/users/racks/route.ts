import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../lib/session";
import { isSuperAdminRole } from "../../../../lib/roles";

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

    const { userId, rackNo, weight } = await req.json();

    if (!userId || !rackNo) {
      return NextResponse.json({ error: "User ID and Rack No are required" }, { status: 400 });
    }

    const data: any = {
      userId,
      rackNo,
    };

    if (weight !== undefined) {
      data.initialWeight = Number(weight);
      data.remainingWeight = Number(weight);
    }

    // Check-then-create has to be one atomic unit — otherwise two overlapping
    // requests for the same rackNo (e.g. added from two tabs, or a
    // double-click) can both pass the "not already active" check before
    // either commits, assigning the same physical piece to two different
    // users. Serializable isolation makes Postgres abort one of the two
    // transactions instead of letting that happen.
    const assignment = await prisma.$transaction(async (tx) => {
      const existingActiveRack = await tx.rackAssignment.findFirst({
        where: {
          rackNo,
          isUsedUp: false
        }
      });

      if (existingActiveRack) {
        throw new Error(`DUPLICATE_RACK:${rackNo}`);
      }

      return tx.rackAssignment.create({ data });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ success: true, assignment }, { status: 201 });
  } catch (error: any) {
    console.error("Error assigning rack:", error);
    if (typeof error?.message === 'string' && error.message.startsWith('DUPLICATE_RACK:')) {
      const rackName = error.message.slice('DUPLICATE_RACK:'.length);
      return NextResponse.json({ error: `ไม่สามารถเพิ่มได้ เนื่องจากมีชิ้นหมู ${rackName} กำลังถูกใช้งานอยู่` }, { status: 400 });
    }
    if (error.code === 'P2002') {
      return NextResponse.json({ error: "ชิ้นนี้ถูกมอบหมายให้ผู้ใช้คนนี้อยู่แล้ว" }, { status: 400 });
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

export async function DELETE(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session || !isSuperAdminRole(session.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const idsParam = searchParams.get("ids");
    const ids = idsParam ? idsParam.split(",").filter(Boolean) : (id ? [id] : []);

    if (ids.length === 0) {
      return NextResponse.json({ error: "Assignment ID is required" }, { status: 400 });
    }

    const racksToDelete = await prisma.rackAssignment.findMany({
      where: { id: { in: ids } },
      include: { user: true }
    });

    if (racksToDelete.length === 0) {
      return NextResponse.json({ error: "ไม่พบชิ้นหมูนี้ อาจถูกลบไปแล้ว" }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.deletedPorkLog.createMany({
        data: racksToDelete.map((r) => ({
          rackNo: r.rackNo,
          weight: r.remainingWeight,
          userName: r.user.name,
        })),
      }),
      prisma.rackAssignment.deleteMany({
        where: { id: { in: racksToDelete.map((r) => r.id) } },
      }),
    ]);

    return NextResponse.json({ success: true, count: racksToDelete.length }, { status: 200 });
  } catch (error) {
    console.error("Error revoking rack:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session || !isSuperAdminRole(session.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { id, rackNo, weight } = await req.json();

    if (!id || !rackNo) {
      return NextResponse.json({ error: "Assignment ID and new Rack No are required" }, { status: 400 });
    }

    const dataToUpdate: any = { rackNo };
    if (weight !== undefined) {
      dataToUpdate.remainingWeight = Number(weight);
      const isNowUsedUp = Number(weight) <= 0;
      dataToUpdate.isUsedUp = isNowUsedUp;
      // Drives the monthly cleanup's "keep last day of the month one extra
      // cycle" grace window (see lib/porkCleanup.ts) — null when not used up.
      dataToUpdate.usedUpAt = isNowUsedUp ? new Date() : null;
    }

    const updated = await prisma.rackAssignment.update({
      where: { id },
      data: dataToUpdate,
    });

    return NextResponse.json({ success: true, updated }, { status: 200 });
  } catch (error: any) {
    console.error("Error updating rack name:", error);
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "ไม่พบชิ้นหมูนี้ อาจถูกลบไปแล้ว" }, { status: 404 });
    }
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
