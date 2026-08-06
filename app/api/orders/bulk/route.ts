import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../lib/session";
import { isSuperAdminRole } from "../../../../lib/roles";
import { previousDayStr } from "../../../../lib/packingCutoff";

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

export async function PATCH(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session || (!isSuperAdminRole(session.role) && session.role !== "PACKING")) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const body = await req.json();
    const { date, status } = body;

    if (!date || !status) {
      return NextResponse.json({ error: "Date and status are required." }, { status: 400 });
    }

    // `date` is "the day Packing is working" (matches the date picker on
    // /packing) — the orders being finished were entered under the day
    // *before* that (see the matching comment on selectedDate in
    // app/packing/page.tsx), so both the order lookup and the
    // numbering-cutoff marker below need this shifted-back date, not `date`
    // itself.
    const orderDate = previousDayStr(date);

    // "End of day" also closes out order numbering for this date — any order
    // created for the rest of this calendar day gets numbered as tomorrow's
    // instead (see effectiveOrderDateKey in POST /api/orders), so a late
    // order doesn't get folded into a batch Packing already marked shipped.
    await prisma.settings.upsert({
      where: { id: "singleton" },
      update: { packingCutoffDate: orderDate },
      create: { id: "singleton", packingCutoffDate: orderDate },
    });

    const result = await prisma.order.updateMany({
      where: {
        entryDate: orderDate,
        // Only update Pending and Packed orders. Storefront/Private-Client
        // orders are normally already "Completed" so this excludes them
        // anyway, but check platform and shipping method directly too rather
        // than relying on that alone — otherwise any such order that isn't
        // "Completed" (edited, imported, a bug elsewhere) would get swept up
        // into a shipping-day bulk action. Same exclusion the Packing list
        // and the printable pork slip already use (see app/packing/page.tsx
        // and lib/porkSlip.ts) — both sell/settle immediately and never go
        // through Packing at all.
        AND: [
          {
            OR: [
              { orderStatus: { in: ["Pending", "Packed", ""] } },
              { orderStatus: null }
            ]
          },
          {
            OR: [
              { platform: { notIn: ["Storefront", "PrivateClient"] } },
              { platform: null }
            ]
          },
          {
            OR: [
              { shippingMethod: { notIn: ["รับหน้าร้าน", "ส่งเอง"] } },
              { shippingMethod: null }
            ]
          }
        ]
      },
      data: {
        orderStatus: status,
      },
    });

    return NextResponse.json({ success: true, count: result.count }, { status: 200 });
  } catch (error) {
    console.error("Error bulk updating orders:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
