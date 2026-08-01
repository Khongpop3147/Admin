import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../lib/session";
import { isSuperAdminRole } from "../../../../lib/roles";

const globalForPrisma = global as unknown as { prisma2: PrismaClient };
let prisma: PrismaClient;

if (globalForPrisma.prisma2) {
  prisma = globalForPrisma.prisma2;
} else {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
}

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma2 = prisma;

const FIELD_LABELS: Record<string, string> = {
  orderStatus: "สถานะออเดอร์",
  trackingNumber: "เลขพัสดุ",
  adminNote: "โน้ต",
  customerName: "ชื่อลูกค้า",
  customerAddress: "ที่อยู่",
  crispyPorkPiece: "จำนวนชิ้น",
  crispyPorkWeight: "น้ำหนัก",
  codAmount: "ยอด COD",
  price: "ราคา",
  paymentStatus: "สถานะจ่ายเงิน",
  transferSlip: "สลิปโอนเงิน",
  isReturned: "ตีกลับ",
  codConfirmed: "ยืนยันรับ COD",
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const { id } = resolvedParams;
    const body = await req.json();

    // Allow updating orderStatus, trackingNumber, or adminNote
    const updateData: any = {};
    if (body.orderStatus !== undefined) updateData.orderStatus = body.orderStatus;
    if (body.trackingNumber !== undefined) updateData.trackingNumber = body.trackingNumber;
    if (body.adminNote !== undefined) updateData.adminNote = body.adminNote;
    if (body.customerName !== undefined) updateData.customerName = body.customerName;
    if (body.customerAddress !== undefined) updateData.customerAddress = body.customerAddress;
    if (body.crispyPorkPiece !== undefined) updateData.crispyPorkPiece = body.crispyPorkPiece;
    if (body.crispyPorkWeight !== undefined) updateData.crispyPorkWeight = body.crispyPorkWeight;
    if (body.codAmount !== undefined) updateData.codAmount = Number(body.codAmount) || 0;
    if (body.price !== undefined) updateData.price = Number(body.price) || 0;
    if (body.paymentStatus !== undefined) updateData.paymentStatus = body.paymentStatus;
    if (body.transferSlip !== undefined) updateData.transferSlip = body.transferSlip;
    if (body.isReturned !== undefined) updateData.isReturned = !!body.isReturned;

    const existingOrder = await prisma.order.findUnique({ where: { id } });

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: updateData,
    });

    if (existingOrder) {
      const changes: string[] = [];
      for (const field of Object.keys(updateData)) {
        const oldVal = (existingOrder as any)[field];
        const newVal = (updatedOrder as any)[field];
        if (String(oldVal ?? "") !== String(newVal ?? "")) {
          const label = FIELD_LABELS[field] || field;
          changes.push(`${label}: "${oldVal ?? "-"}" → "${newVal ?? "-"}"`);
        }
      }
      if (changes.length > 0) {
        await prisma.orderAuditLog.create({
          data: {
            orderId: id,
            action: "EDIT",
            summary: `แก้ไขออเดอร์ #${updatedOrder.orderNo || "-"} (${updatedOrder.customerName}) — ${changes.join(", ")}`,
            performedBy: body.editedBy || null,
          },
        });
      }
    }

    return NextResponse.json({ success: true, order: updatedOrder }, { status: 200 });
  } catch (error: any) {
    console.error("Error updating order:", error);
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "ไม่พบออเดอร์นี้ อาจถูกลบไปแล้ว" }, { status: 404 });
    }
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionUser();
    if (!session || !isSuperAdminRole(session.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const resolvedParams = await params;
    const { id } = resolvedParams;

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) {
      return NextResponse.json({ error: "ไม่พบออเดอร์นี้ อาจถูกลบไปแล้ว" }, { status: 404 });
    }

    let rackDetails: { assignmentId?: string; rackNo?: string; weight?: number }[] = [];
    if (order.rackDetails) {
      try {
        rackDetails = JSON.parse(order.rackDetails);
      } catch (e) { }
    }

    await prisma.$transaction(async (tx) => {
      // Give back the pork weight this order took out of the rack it was
      // allocated from — otherwise deleting the order permanently loses that
      // weight from inventory instead of just undoing the sale.
      for (const detail of rackDetails) {
        if (!detail.assignmentId || !detail.weight) continue;
        const assignment = await tx.rackAssignment.findUnique({ where: { id: detail.assignmentId } });
        if (!assignment) continue;
        await tx.rackAssignment.update({
          where: { id: detail.assignmentId },
          data: {
            remainingWeight: assignment.remainingWeight + detail.weight,
            isUsedUp: false,
          },
        });
      }

      await tx.orderAuditLog.create({
        data: {
          orderId: id,
          action: "DELETE",
          summary: `ลบออเดอร์ #${order.orderNo || "-"} (${order.customerName}) — คืนน้ำหนักหมู ${rackDetails.length} รายการเข้าคลัง`,
          performedBy: session.name,
        },
      });

      await tx.order.delete({ where: { id } });
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error("Error deleting order:", error);
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "ไม่พบออเดอร์นี้ อาจถูกลบไปแล้ว" }, { status: 404 });
    }
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
