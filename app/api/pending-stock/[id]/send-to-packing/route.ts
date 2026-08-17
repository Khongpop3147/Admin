import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../../lib/session";
import { createOrderRecord } from "../../../../../lib/createOrder";
import { buildAllocationDiffNote } from "../../../../../lib/rackAllocate";
import { PRODUCT_TYPES, DEFAULT_PRODUCT_TYPE } from "../../../../../lib/rackCode";
import { previousDayStr } from "../../../../../lib/packingCutoff";

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

function bangkokDateKey(date: Date): string {
  const d = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Converts a WHOLE "ลูกค้ารอหมู" waiting entry into one real Order in a
// single click — every line item needs its own stock already assigned (see
// assign-stock/route.ts) before this is allowed; there is no per-line
// sending. entryDate is deliberately backdated to the day the customer
// originally paid (so Order Details/Dashboard show the real sale date), but
// packingEntryDate overrides which day Packing sees it on — the day stock
// actually got assigned, which can be many days later. Shipping cost/total
// carry over from the entry as-is, since this is still one shipment, one
// order.
//
// shipToday (optional, default false) picks WHICH day it shows up in
// Packing — the app-wide convention is "logged today, packed tomorrow"
// (packingEntryDate = today, so Packing's nextDayStr lookup lands on
// tomorrow), same as a normal Order Entry line. Passing shipToday: true is
// the deliberate same-day-dispatch escape hatch — backs packingEntryDate up
// one more day so it shows in TODAY's Packing view instead, for stock that
// just came in and needs to go out same-day rather than wait for tomorrow's
// batch.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { id } = await params;
    const { shipToday } = await req.json().catch(() => ({ shipToday: false }));

    const result = await prisma.$transaction(async (tx) => {
      const entry = await tx.pendingStock.findUnique({ where: { id } });
      if (!entry) throw new Error("ไม่พบรายการนี้");
      if (entry.fulfilledAt) throw new Error("รายการนี้ส่งไป packing ไปแล้ว");

      const items = Array.isArray(entry.items) ? (entry.items as any[]) : [];
      if (items.length === 0) throw new Error("ไม่มีสินค้าในรายการนี้");
      const missingStock = items.some((it) => !Array.isArray(it?.rackDetails) || it.rackDetails.length === 0);
      if (missingStock) throw new Error("กรุณาใส่หมูให้ครบทุกสินค้าก่อนส่งไป packing");

      const allPieces = items.flatMap((it) => it.rackDetails);
      const totalWeight = Number(items.reduce((sum, it) => sum + (Number(it.weightKg) || 0), 0).toFixed(2));

      // Same per-item shortage/excess note Order Entry's own auto-allocation
      // would have left on a normal order — a "ใส่หมู" pick that didn't land
      // exactly on the target weight (rack pieces rarely weigh exactly what
      // was asked for) carries that mismatch onto the real Order too,
      // instead of silently disappearing once converted.
      const diffNotes = items
        .map((it) => {
          const label = it.productType === DEFAULT_PRODUCT_TYPE ? "หมู" : PRODUCT_TYPES[it.productType]?.label || it.productType;
          const allocated = Number((it.rackDetails as any[]).reduce((sum: number, p: any) => sum + (Number(p?.weight) || 0), 0).toFixed(2));
          return buildAllocationDiffNote(label, Number(it.weightKg) || 0, allocated);
        })
        .filter((n): n is string => !!n);
      const combinedNote = [entry.note, ...diffNotes].filter(Boolean).join(" / ");

      const order = await createOrderRecord(tx, {
        customerName: entry.customerName,
        platform: entry.platform,
        socialMediaName: entry.socialMediaName,
        crispyPorkWeight: totalWeight > 0 ? String(totalWeight) : null,
        crispyPorkPiece: String(allPieces.length),
        price: items.reduce((sum, it) => sum + (Number(it.price) || 0), 0),
        shippingMethod: entry.shippingMethod,
        additionalShippingCost: entry.additionalShippingCost,
        codAmount: entry.codAmount,
        actualReceivedAmount: entry.actualReceivedAmount,
        transferSlip: entry.transferSlip,
        extraSlipUrls: entry.extraSlipUrls,
        paymentStatus: (entry.codAmount ?? 0) > 0 ? "COD" : "Paid",
        customerAddress: entry.customerAddress,
        customerPhone: entry.customerPhone,
        customerZip: entry.customerZip,
        needsTaxInvoice: entry.needsTaxInvoice,
        orderStatus: "",
        rackDetails: JSON.stringify(allPieces),
        sellerName: entry.createdBy,
        adminNote: combinedNote,
        entryDate: bangkokDateKey(entry.createdAt),
        packingEntryDate: shipToday ? previousDayStr(bangkokDateKey(new Date())) : bangkokDateKey(new Date()),
        items: items.map((it) => ({
          productType: it.productType,
          weight: Number(it.weightKg) || 0,
          pieceCount: Array.isArray(it.rackDetails) ? it.rackDetails.length : null,
          price: Number(it.price) || 0,
          pricePerKg: it.pricePerKg != null ? Number(it.pricePerKg) : null,
        })),
      });

      const updatedEntry = await tx.pendingStock.update({
        where: { id },
        data: { fulfilledAt: new Date(), orderId: order.id },
      });

      return { order, entry: updatedEntry };
    });

    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (error) {
    console.error("Error sending pending stock entry to packing:", error);
    const message = error instanceof Error && /[฀-๿]/.test(error.message) ? error.message : "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
