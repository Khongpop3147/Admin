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
    const { userId, rackNo, weight } = await req.json();

    if (!userId || !rackNo) {
      return NextResponse.json({ error: "User ID and Rack No are required" }, { status: 400 });
    }

    // Check if this rack is already active anywhere globally
    const existingActiveRack = await prisma.rackAssignment.findFirst({
      where: {
        rackNo,
        isUsedUp: false
      }
    });

    if (existingActiveRack) {
      return NextResponse.json({ error: `ไม่สามารถเพิ่มได้ เนื่องจากมีชิ้นหมู ${rackNo} กำลังถูกใช้งานอยู่` }, { status: 400 });
    }

    const data: any = {
      userId,
      rackNo,
    };
    
    if (weight !== undefined) {
      data.initialWeight = Number(weight);
      data.remainingWeight = Number(weight);
    }

    const assignment = await prisma.rackAssignment.create({
      data,
    });

    return NextResponse.json({ success: true, assignment }, { status: 201 });
  } catch (error: any) {
    console.error("Error assigning rack:", error);
    if (error.code === 'P2002') {
      return NextResponse.json({ error: "Rack is already assigned to this user." }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Assignment ID is required" }, { status: 400 });
    }

    const rackToDelete = await prisma.rackAssignment.findUnique({
      where: { id },
      include: { user: true }
    });

    if (rackToDelete) {
      await prisma.deletedPorkLog.create({
        data: {
          rackNo: rackToDelete.rackNo,
          weight: rackToDelete.remainingWeight,
          userName: rackToDelete.user.name,
        }
      });
    }

    await prisma.rackAssignment.delete({
      where: { id },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error revoking rack:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { id, rackNo, weight } = await req.json();

    if (!id || !rackNo) {
      return NextResponse.json({ error: "Assignment ID and new Rack No are required" }, { status: 400 });
    }

    const dataToUpdate: any = { rackNo };
    if (weight !== undefined) {
      dataToUpdate.remainingWeight = Number(weight);
      dataToUpdate.isUsedUp = Number(weight) <= 0;
    }

    const updated = await prisma.rackAssignment.update({
      where: { id },
      data: dataToUpdate,
    });

    return NextResponse.json({ success: true, updated }, { status: 200 });
  } catch (error) {
    console.error("Error updating rack name:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
