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

// Lets an admin retrofit real rack stock onto an order that already exists
// with none — the gap POST /api/orders' own "no real stock behind this
// weight" check now blocks at creation time, but an order created before
// that check existed (or edited some other way) can still be sitting there
// with a claimed weight and nothing actually deducted from inventory. Same
// picker/deduction pipeline as /api/pending-stock/[id]/assign-stock, just
// against Order.rackDetails — a single flat JSON string for the whole
// order (not itemized per OrderItem the way PendingStock's own items array
// is), which matches how rackDetails has always worked for a real Order
// (see POST /api/orders' own `items.flatMap(it => it.rackDetails)`).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser();
    if (!session || session.role === "CENTRAL_INVENTORY") {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { id } = await params;
    const { rackDetails } = await req.json();
    const nextPieces: RackPiece[] = Array.isArray(rackDetails)
      ? rackDetails
          .map((r: any) => ({ assignmentId: String(r?.assignmentId || ""), rackNo: String(r?.rackNo || ""), weight: Number(r?.weight) || 0 }))
          .filter((r: RackPiece) => r.assignmentId && r.weight > 0)
      : [];

    const updatedOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new Error("ไม่พบออเดอร์นี้");

      let prevPieces: RackPiece[] = [];
      if (order.rackDetails) {
        try {
          const parsed = JSON.parse(order.rackDetails);
          if (Array.isArray(parsed)) prevPieces = parsed;
        } catch (e) { }
      }
      const prevIds = new Set(prevPieces.map((p) => p.assignmentId));
      const nextIds = new Set(nextPieces.map((p) => p.assignmentId));

      // Only touch stock for the actual diff — pieces removed from the
      // selection give their weight back, newly added ones get deducted.
      // Pieces present in both are left untouched.
      const removed = prevPieces.filter((p) => !nextIds.has(p.assignmentId));
      const added = nextPieces.filter((p) => !prevIds.has(p.assignmentId));

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

      return tx.order.update({
        where: { id },
        data: { rackDetails: nextPieces.length > 0 ? JSON.stringify(nextPieces) : null },
        include: { extraSlips: true, items: true },
      });
    });

    return NextResponse.json({ success: true, order: updatedOrder }, { status: 200 });
  } catch (error) {
    console.error("Error assigning stock to order:", error);
    const message = error instanceof Error && /[฀-๿]/.test(error.message) ? error.message : "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
