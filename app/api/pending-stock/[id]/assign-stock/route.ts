import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../../lib/session";

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

interface RackPiece {
  assignmentId: string;
  rackNo: string;
  weight: number;
}

// Lets an admin who now has real pork on hand pick actual pieces from their
// own rack stock (same picker/deduction pipeline as normal Order Entry) to
// cover one line item on a waiting entry — the whole entry still needs a
// separate "ส่งไป packing" click, once EVERY line has stock assigned, this
// step just answers "which physical pieces will cover this one line".
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { id } = await params;
    const { itemIndex, rackDetails } = await req.json();

    if (!Number.isInteger(itemIndex) || itemIndex < 0) {
      return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
    }
    const nextPieces: RackPiece[] = Array.isArray(rackDetails)
      ? rackDetails
          .map((r: any) => ({ assignmentId: String(r?.assignmentId || ""), rackNo: String(r?.rackNo || ""), weight: Number(r?.weight) || 0 }))
          .filter((r: RackPiece) => r.assignmentId && r.weight > 0)
      : [];

    const updatedEntry = await prisma.$transaction(async (tx) => {
      const entry = await tx.pendingStock.findUnique({ where: { id } });
      if (!entry) throw new Error("ไม่พบรายการนี้");
      if (entry.fulfilledAt) throw new Error("รายการนี้ส่งไป packing ไปแล้ว แก้ไขไม่ได้");
      const items = Array.isArray(entry.items) ? (entry.items as any[]) : [];
      if (itemIndex >= items.length) throw new Error("ไม่พบรายการสินค้านี้");

      const prevPieces: RackPiece[] = Array.isArray(items[itemIndex]?.rackDetails) ? items[itemIndex].rackDetails : [];
      const prevIds = new Set(prevPieces.map((p) => p.assignmentId));
      const nextIds = new Set(nextPieces.map((p) => p.assignmentId));

      // Only touch stock for the actual diff — pieces removed from the
      // selection give their weight back, newly added ones get deducted.
      // Pieces present in both are left untouched.
      const removed = prevPieces.filter((p) => !nextIds.has(p.assignmentId));
      const added = nextPieces.filter((p) => !prevIds.has(p.assignmentId));

      // updateMany (not update) for the restore — atomic increment that
      // just no-ops if the assignment is gone, rather than throwing, same
      // reasoning as the matching restore in PATCH /api/orders/[id].
      for (const piece of removed) {
        await tx.rackAssignment.updateMany({
          where: { id: piece.assignmentId },
          data: { remainingWeight: { increment: piece.weight }, isUsedUp: false },
        });
      }

      for (const piece of added) {
        const updatedCount = await tx.rackAssignment.updateMany({
          where: { id: piece.assignmentId, remainingWeight: { gte: piece.weight - 0.001 } },
          data: { remainingWeight: { decrement: piece.weight } },
        });
        if (updatedCount.count === 0) {
          throw new Error("ชิ้นหมูที่เลือกถูกใช้งานไปแล้ว (น้ำหนักคงเหลือไม่พอ) กรุณาเลือกใหม่");
        }
        const updatedRack = await tx.rackAssignment.findUnique({ where: { id: piece.assignmentId } });
        if (updatedRack && updatedRack.remainingWeight <= 0.001) {
          await tx.rackAssignment.update({ where: { id: piece.assignmentId }, data: { isUsedUp: true, remainingWeight: 0, usedUpAt: new Date() } });
        }
      }

      const nextItems = items.map((it, i) => (i === itemIndex ? { ...it, rackDetails: nextPieces } : it));
      return tx.pendingStock.update({ where: { id }, data: { items: nextItems } });
    });

    return NextResponse.json({ success: true, entry: updatedEntry }, { status: 200 });
  } catch (error) {
    console.error("Error assigning stock to pending entry:", error);
    const message = error instanceof Error && /[฀-๿]/.test(error.message) ? error.message : "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
