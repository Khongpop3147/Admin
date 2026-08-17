import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../lib/session";
import { PRODUCT_TYPES } from "../../../../lib/rackCode";
import { isValidPhone, isValidZip } from "../../../../lib/addressParse";

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

// Edits a still-waiting entry (customer info, items, shipping/COD, slip,
// note, expected ship date) — only while it hasn't been sent to packing
// yet; once fulfilled, the real Order (viewable via "ดูข้อมูล order") is
// the record that matters going forward. Items are matched to their
// PREVIOUS line by array index (not id — these are plain JSON objects with
// no identity of their own), so this assumes lines are only appended/
// removed from the end, never reordered — same assumption the client's
// item-editor UI makes.
//
// A line whose product changed, or that got removed outright, has whatever
// real stock was already assigned to it (rackDetails, from assign-stock)
// restored back to the rack it came from — that stock no longer applies to
// whatever's in that slot now. A line that keeps the same product but
// changes weight/price keeps its existing assignment as-is; if that leaves
// it over/under the new target, the "ใส่หมู" panel's own shortage warning
// already surfaces that live, no special-casing needed here.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { id } = await params;
    const {
      customerName,
      platform,
      socialMediaName,
      customerAddress,
      customerPhone,
      customerZip,
      needsTaxInvoice,
      items,
      shippingMethod,
      additionalShippingCost,
      codAmount,
      actualReceivedAmount,
      transferSlip,
      extraSlipUrls,
      expectedShipDate,
      note,
    } = await req.json();

    if (typeof customerName !== "string" || !customerName.trim()) {
      return NextResponse.json({ error: "กรุณากรอกชื่อลูกค้า" }, { status: 400 });
    }
    if (typeof platform !== "string" || !platform) {
      return NextResponse.json({ error: "กรุณาเลือกช่องทางการขาย" }, { status: 400 });
    }
    if (!isValidPhone(customerPhone) || !isValidZip(customerZip)) {
      return NextResponse.json({ error: "กรุณากรอกเบอร์โทร (10 หลัก) และรหัสไปรษณีย์ (5 หลัก) ให้ครบ" }, { status: 400 });
    }
    const validItems = Array.isArray(items)
      ? items
          .map((it: any) => ({
            productType: typeof it?.productType === "string" && PRODUCT_TYPES[it.productType] ? it.productType : "PORK",
            weightKg: Number(it?.weightKg) || 0,
            pricePerKg: Number(it?.pricePerKg) || 0,
            price: Number(it?.price) || 0,
          }))
          .filter((it) => it.weightKg > 0)
      : [];
    if (validItems.length === 0) {
      return NextResponse.json({ error: "กรุณากรอกน้ำหนักสินค้าอย่างน้อย 1 รายการ" }, { status: 400 });
    }

    const updatedEntry = await prisma.$transaction(async (tx) => {
      const entry = await tx.pendingStock.findUnique({ where: { id } });
      if (!entry) throw new Error("ไม่พบรายการนี้");
      if (entry.fulfilledAt) throw new Error("รายการนี้ส่งไป packing ไปแล้ว แก้ไขไม่ได้");

      const oldItems = Array.isArray(entry.items) ? (entry.items as any[]) : [];

      // Restore stock for any old line whose product changed or that
      // disappeared entirely in the new list — see the function comment.
      for (let i = 0; i < oldItems.length; i++) {
        const oldIt = oldItems[i];
        const newIt = validItems[i];
        const pieces = Array.isArray(oldIt?.rackDetails) ? oldIt.rackDetails : [];
        if (pieces.length === 0) continue;
        const productChanged = !newIt || oldIt.productType !== newIt.productType;
        if (!productChanged) continue;
        for (const piece of pieces) {
          if (!piece?.assignmentId || !piece?.weight) continue;
          await tx.rackAssignment.updateMany({
            where: { id: piece.assignmentId },
            data: { remainingWeight: { increment: piece.weight }, isUsedUp: false },
          });
        }
      }

      const mergedItems = validItems.map((newIt, i) => {
        const oldIt = oldItems[i];
        if (oldIt && oldIt.productType === newIt.productType && Array.isArray(oldIt.rackDetails) && oldIt.rackDetails.length > 0) {
          return { ...newIt, rackDetails: oldIt.rackDetails };
        }
        return newIt;
      });

      return tx.pendingStock.update({
        where: { id },
        data: {
          customerName: customerName.trim(),
          platform,
          socialMediaName: typeof socialMediaName === "string" && socialMediaName.trim() ? socialMediaName.trim() : null,
          customerAddress: typeof customerAddress === "string" && customerAddress.trim() ? customerAddress.trim() : null,
          customerPhone,
          customerZip,
          needsTaxInvoice: !!needsTaxInvoice,
          items: mergedItems,
          shippingMethod: typeof shippingMethod === "string" && shippingMethod ? shippingMethod : null,
          additionalShippingCost: additionalShippingCost != null ? Number(additionalShippingCost) || 0 : null,
          codAmount: codAmount != null ? Number(codAmount) || 0 : null,
          actualReceivedAmount: actualReceivedAmount != null ? Number(actualReceivedAmount) || 0 : null,
          transferSlip: typeof transferSlip === "string" && transferSlip ? transferSlip : null,
          extraSlipUrls: Array.isArray(extraSlipUrls) ? extraSlipUrls.filter((u: any) => typeof u === "string" && u.trim()) : [],
          expectedShipDate: typeof expectedShipDate === "string" && expectedShipDate ? expectedShipDate : null,
          note: typeof note === "string" && note.trim() ? note.trim() : null,
        },
      });
    });

    return NextResponse.json({ success: true, entry: updatedEntry }, { status: 200 });
  } catch (error) {
    console.error("Error updating pending stock entry:", error);
    const message = error instanceof Error && /[฀-๿]/.test(error.message) ? error.message : "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Handles two very different reasons an admin deletes a waiting-list entry
// — the client asks which one via a popup and sends it as `reason`:
//   - "mistake": typo'd customer/wrong product, nothing was ever really
//     sold. Deleted with no trace in Dashboard's cancelled-sales banner.
//   - "cancelled" (default if the client sends neither, for safety): the
//     customer genuinely backed out and got refunded — a real reversal of
//     money Dashboard already counted as sold the moment this was logged
//     (see app/dashboard/page.tsx), so it's logged to OrderAuditLog
//     (reusing the table, orderId left null) so Dashboard can surface
//     "N รายการถูกยกเลิก" for the period instead of the number just quietly
//     dropping with no explanation.
// Either way: if real stock was already assigned to some lines (see
// assign-stock/route.ts) but the entry never got sent to packing, that
// weight goes back to the racks it came from first, so deleting an entry
// never silently strands deducted stock nobody actually received. An entry
// that HAS already become a real order (its own orderId, via
// send-to-packing/route.ts) is skipped entirely — that stock legitimately
// belongs to that order now, restoring it here would double-book the same
// pieces. A FULFILLED entry's delete is never logged to the cancelled-sales
// banner either way — its money already belongs to a real Order that's
// untouched by this delete, so there's nothing to reverse.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { reason } = await req.json().catch(() => ({ reason: "cancelled" }));
    const isMistake = reason === "mistake";

    const { id } = await params;
    await prisma.$transaction(async (tx) => {
      const entry = await tx.pendingStock.findUnique({ where: { id } });
      if (!entry) return;
      if (!entry.orderId) {
        const items = Array.isArray(entry.items) ? (entry.items as any[]) : [];
        for (const item of items) {
          const pieces = Array.isArray(item?.rackDetails) ? item.rackDetails : [];
          for (const piece of pieces) {
            if (!piece?.assignmentId || !piece?.weight) continue;
            await tx.rackAssignment.updateMany({
              where: { id: piece.assignmentId },
              data: { remainingWeight: { increment: piece.weight }, isUsedUp: false },
            });
          }
        }
      }
      if (!entry.fulfilledAt && !isMistake) {
        await tx.orderAuditLog.create({
          data: {
            orderId: null,
            action: "PENDING_STOCK_CANCELLED",
            summary: `ยกเลิกรายการลูกค้ารอหมู: ${entry.customerName} (฿${Math.round(entry.actualReceivedAmount || 0)})`,
            performedBy: entry.createdBy,
            amount: entry.actualReceivedAmount,
          },
        });
      }
      await tx.pendingStock.delete({ where: { id } });
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error deleting pending stock entry:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
