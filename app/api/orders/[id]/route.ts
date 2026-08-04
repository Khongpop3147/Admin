import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../lib/session";
import { isSuperAdminRole } from "../../../../lib/roles";
import { computeActualReceivedAmount } from "../../../../lib/money";

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
  actualReceivedAmount: "ยอดรับจริง",
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionUser();
    // Every staff role (ADMIN/PACKING/STOREFRONT/SUPER_ADMIN/DEV) has a
    // legitimate reason to edit orders through one page or another —
    // CENTRAL_INVENTORY is the only role with no order-editing UI at all.
    if (!session || session.role === "CENTRAL_INVENTORY") {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const resolvedParams = await params;
    const { id } = resolvedParams;
    const body = await req.json();

    const existingOrder = await prisma.order.findUnique({ where: { id } });
    if (!existingOrder) {
      return NextResponse.json({ error: "ไม่พบออเดอร์นี้ อาจถูกลบไปแล้ว" }, { status: 404 });
    }
    // STOREFRONT's own edit UI only ever operates on its own platform's
    // orders — scope it server-side too, so that role can't be used to
    // rewrite price/COD/payment-status on a Shopee/Lazada/other admin's
    // order by just calling this route directly with a different id.
    if (session.role === "STOREFRONT" && existingOrder.platform !== "Storefront") {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

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

    // actualReceivedAmount is never sent by any client — it's derived once
    // at order creation as round((price + shipping) * 1.07 + codAmount) and
    // then never touched again. If price or codAmount changes here without
    // recomputing it, every downstream consumer that trusts it (Dashboard's
    // "ยอดรับจริงรวม", the Postone COD export column, Packing/Storefront's
    // order-total display) keeps showing the stale pre-edit figure — for
    // COD orders that means the courier gets told to collect the WRONG cash
    // amount from the customer.
    if (updateData.price !== undefined || updateData.codAmount !== undefined) {
      const finalPrice = updateData.price !== undefined ? updateData.price : (Number(existingOrder.price) || 0);
      const finalCod = updateData.codAmount !== undefined ? updateData.codAmount : (Number(existingOrder.codAmount) || 0);
      const finalShipping = Number(existingOrder.additionalShippingCost) || 0;
      updateData.actualReceivedAmount = computeActualReceivedAmount(finalPrice, finalShipping, finalCod);
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: updateData,
    });

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
      // weight from inventory instead of just undoing the sale. Uses an
      // atomic increment (not read-then-write) so two orders being deleted
      // concurrently, both restoring weight to the same rack piece, can't
      // lose one of the two restorations — updateMany also just no-ops if
      // the assignment no longer exists, same as the old findUnique guard.
      for (const detail of rackDetails) {
        if (!detail.assignmentId || !detail.weight) continue;
        await tx.rackAssignment.updateMany({
          where: { id: detail.assignmentId },
          data: {
            remainingWeight: { increment: detail.weight },
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
