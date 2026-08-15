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
  customerPhone: "เบอร์โทร",
  customerZip: "รหัสไปรษณีย์",
  needsTaxInvoice: "ใบกำกับภาษี",
  crispyPorkPiece: "จำนวนชิ้น",
  crispyPorkWeight: "น้ำหนัก",
  codAmount: "ยอด COD",
  price: "ราคา",
  paymentStatus: "สถานะจ่ายเงิน",
  transferSlip: "สลิปโอนเงิน",
  isReturned: "ตีกลับ",
  codConfirmed: "ยืนยันรับ COD",
  actualReceivedAmount: "ยอดรับจริง",
  boxPieceCounts: "จำนวนชิ้นต่อกล่อง",
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

    const existingOrder = await prisma.order.findUnique({ where: { id }, include: { items: true } });
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

    // An order with 2+ product lines can't have its flat weight/piece/price
    // edited directly — there'd be nowhere sensible to redistribute the new
    // number back into the underlying items. The client-side edit form
    // already hides those inputs for such orders and sends `items` instead;
    // this is the server-side backstop for a stale client (or a direct API
    // call) that tries the old flat-field shape anyway.
    if (existingOrder.items.length > 1 && !Array.isArray(body.items) && (body.price !== undefined || body.crispyPorkWeight !== undefined || body.crispyPorkPiece !== undefined)) {
      return NextResponse.json({ error: "ออเดอร์นี้มีหลายรายการสินค้า กรุณาแก้ไขที่หน้า Order Entry เท่านั้น" }, { status: 400 });
    }

    // Allow updating orderStatus, trackingNumber, or adminNote
    const updateData: any = {};
    if (body.orderStatus !== undefined) updateData.orderStatus = body.orderStatus;
    if (body.trackingNumber !== undefined) updateData.trackingNumber = body.trackingNumber;
    if (body.adminNote !== undefined) updateData.adminNote = body.adminNote;
    if (body.customerName !== undefined) updateData.customerName = body.customerName;
    if (body.customerAddress !== undefined) updateData.customerAddress = body.customerAddress;
    if (body.customerPhone !== undefined) updateData.customerPhone = body.customerPhone;
    if (body.customerZip !== undefined) updateData.customerZip = body.customerZip;
    if (body.needsTaxInvoice !== undefined) updateData.needsTaxInvoice = !!body.needsTaxInvoice;
    if (body.crispyPorkPiece !== undefined) updateData.crispyPorkPiece = body.crispyPorkPiece;
    if (body.crispyPorkWeight !== undefined) updateData.crispyPorkWeight = body.crispyPorkWeight;
    if (body.codAmount !== undefined) updateData.codAmount = Number(body.codAmount) || 0;
    if (body.price !== undefined) updateData.price = Number(body.price) || 0;
    if (body.paymentStatus !== undefined) updateData.paymentStatus = body.paymentStatus;
    if (body.transferSlip !== undefined) updateData.transferSlip = body.transferSlip;
    if (body.isReturned !== undefined) updateData.isReturned = !!body.isReturned;
    if (body.boxPieceCounts !== undefined) updateData.boxPieceCounts = body.boxPieceCounts;

    // Per-item edits (multi-line orders only) — only weight/pieceCount/price
    // are editable per item; product/rack allocation stay untouched, same
    // trust model as the flat-field edit path (which also never touches
    // RackAssignment rows). The 3 flat aggregate fields are recomputed here
    // as the sum across the just-edited items, so they keep meaning "total
    // across the order" for every downstream reader that only knows the
    // flat shape.
    const itemUpdates: { id: string; weight: number; pieceCount: number | null; price: number }[] = Array.isArray(body.items)
      ? body.items
          .filter((it: any) => it && typeof it.id === "string" && existingOrder.items.some((eo) => eo.id === it.id))
          .map((it: any) => ({
            id: it.id,
            weight: Number(it.weight) || 0,
            pieceCount: it.pieceCount != null ? Number(it.pieceCount) : null,
            price: Number(it.price) || 0,
          }))
      : [];
    if (itemUpdates.length > 0) {
      const totalWeight = itemUpdates.reduce((sum, it) => sum + it.weight, 0);
      const totalPieces = itemUpdates.reduce((sum, it) => sum + (it.pieceCount || 0), 0);
      const totalPrice = itemUpdates.reduce((sum, it) => sum + it.price, 0);
      updateData.crispyPorkWeight = totalWeight > 0 ? String(Number(totalWeight.toFixed(2))) : "";
      updateData.crispyPorkPiece = String(totalPieces);
      updateData.price = totalPrice;
    }

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

    // extraSlips is a relation write, not a scalar column — kept out of
    // updateData (and so out of the change-diff loop below, which only
    // makes sense for plain field values) and merged in separately. Full
    // replace: whatever list the client sends becomes the complete set of
    // extra slips, same "current state wins" semantics as every other field
    // here (not an append).
    const extraSlipsData = Array.isArray(body.extraSlipUrls)
      ? {
          extraSlips: {
            deleteMany: {},
            create: body.extraSlipUrls
              .filter((u: unknown) => typeof u === "string" && u.trim())
              .map((url: string) => ({ url })),
          },
        }
      : {};

    const updatedOrder = await prisma.$transaction(async (tx) => {
      for (const it of itemUpdates) {
        await tx.orderItem.update({
          where: { id: it.id },
          data: { weight: it.weight, pieceCount: it.pieceCount, price: it.price },
        });
      }
      return tx.order.update({
        where: { id },
        data: { ...updateData, ...extraSlipsData },
        include: { extraSlips: true, items: true },
      });
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

      // A second, separate log entry purely for Dashboard's cancelled-sales
      // banner (see GET /api/dashboard/cancelled-count) — this order's money
      // already counted as sold in Dashboard's totals the moment it was
      // created, so deleting it is a real reversal. Deliberately attributed
      // to order.sellerName (whoever's revenue this reverses), not
      // session.name (the Super Admin who clicked delete here — this route
      // is Super-Admin-only, so session.name would never match a regular
      // admin's own Dashboard view otherwise).
      await tx.orderAuditLog.create({
        data: {
          orderId: id,
          action: "ORDER_CANCELLED",
          summary: `ลบออเดอร์ #${order.orderNo || "-"} (${order.customerName}) จาก Packing (฿${Math.round(order.actualReceivedAmount || 0)})`,
          performedBy: order.sellerName,
          amount: order.actualReceivedAmount,
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
