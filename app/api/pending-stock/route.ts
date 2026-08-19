import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../lib/session";
import { PRODUCT_TYPES } from "../../../lib/rackCode";
import { isValidPhone, isValidZip } from "../../../lib/addressParse";
import { findDuplicatePendingStock, findDuplicateOrder } from "../../../lib/orderDuplicate";
import { isSuperAdminRole } from "../../../lib/roles";

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

export const dynamic = "force-dynamic";

const ENTRY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayBangkokDateKey(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Newest first — the client splits this single list into an "unfulfilled"
// section (customers still owed pork) and a "fulfilled" history section
// underneath, both already in the right order for their own display.
//
// Each admin's own waiting-list is their own — a regular admin only ever
// sees entries they themselves logged (createdBy), same "your own stock,
// your own customers" boundary the rest of the app already draws (racks,
// Order Entry's own "ออเดอร์ของฉัน"). Only a Super Admin can see across
// everyone, either everyone at once (no `admin` param) or one admin's list
// at a time (`?admin=<name>`, mirroring Dashboard's own viewTarget switch).
export async function GET(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const adminParam = searchParams.get("admin");
    // dateFrom/dateTo (YYYY-MM-DD) scope by entryDate — used by Dashboard to
    // total up a date range's worth of still-waiting entries, same
    // "entryDate is the day this counts as" rule Order already follows. A
    // row from before entryDate existed (null) falls back to createdAt's
    // own Bangkok calendar day instead.
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const whereClause: any = {};
    if (isSuperAdminRole(session.role)) {
      if (adminParam) whereClause.createdBy = adminParam;
    } else {
      whereClause.createdBy = session.name;
    }
    if (dateFrom || dateTo) {
      const entryDateRange = {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      };
      const createdAtRange = {
        ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00+07:00`) } : {}),
        ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999+07:00`) } : {}),
      };
      whereClause.OR = [
        { entryDate: entryDateRange },
        { entryDate: null, createdAt: createdAtRange },
      ];
    }

    const entries = await prisma.pendingStock.findMany({ where: whereClause, orderBy: { createdAt: "desc" } });
    return NextResponse.json({ success: true, entries }, { status: 200 });
  } catch (error) {
    console.error("Error fetching pending stock entries:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

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
      entryDate,
      note,
      bypassDuplicateCheck,
    } = await req.json();

    if (typeof customerName !== "string" || !customerName.trim()) {
      return NextResponse.json({ error: "กรุณากรอกชื่อลูกค้า" }, { status: 400 });
    }
    if (typeof platform !== "string" || !platform) {
      return NextResponse.json({ error: "กรุณาเลือกช่องทางการขาย" }, { status: 400 });
    }
    // Same phone/zip requirement as Order Entry — see
    // components/OrderEntryForm.tsx's handleSubmit for the matching check.
    if (!isValidPhone(customerPhone) || !isValidZip(customerZip)) {
      return NextResponse.json({ error: "กรุณากรอกเบอร์โทร (10 หลัก) และรหัสไปรษณีย์ (5 หลัก) ให้ครบ" }, { status: 400 });
    }

    // Client already computes price/pricePerKg from Settings (same trust
    // model as POST /api/orders' own items handling) — this just sanitizes
    // types and drops any line the admin never actually filled in.
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

    const totalWeightKg = validItems.reduce((sum, it) => sum + it.weightKg, 0);

    // Same "risky duplicate" guard as Order Entry (POST /api/orders) — same
    // customer name + total weight logged again within 7 days is flagged
    // for a human to confirm, rather than silently creating a second
    // waiting-list entry for what might be an accidental double-submit.
    if (!bypassDuplicateCheck) {
      const duplicateWindowCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      // Scoped to this admin's own entries — a same-named customer someone
      // ELSE logged isn't this admin's accidental double-submit.
      const recentEntries = await prisma.pendingStock.findMany({
        where: { createdAt: { gte: duplicateWindowCutoff }, createdBy: session.name },
      });
      const recentForCheck = recentEntries.map((e) => ({
        customerName: e.customerName,
        totalWeightKg: (Array.isArray(e.items) ? (e.items as any[]) : []).reduce((sum, it) => sum + (Number(it?.weightKg) || 0), 0),
        entry: e,
      }));
      const match = findDuplicatePendingStock(customerName, totalWeightKg, recentForCheck);
      if (match) {
        return NextResponse.json(
          {
            duplicate: true,
            message: `ชื่อ "${customerName}" และหมูมีน้ำหนักรวม ${totalWeightKg} กก. ตรงกับรายการรอหมูที่มีอยู่แล้ว อาจมีความเสี่ยงบันทึกซ้ำ ต้องการบันทึกรายการนี้ต่อไปหรือไม่?`,
          },
          { status: 200 }
        );
      }

      // Same check against real Orders — logging a waiting-list entry for a
      // customer who already has a real order (this weight, this window)
      // is the same duplicate-shipment risk as two real Orders, just not
      // caught by the check above since it only looks at PendingStock.
      // Global across admins (not scoped to session.name like the check
      // above), matching POST /api/orders' own reasoning: which staff
      // member logged which one doesn't change the risk of shipping the
      // same customer's pork twice.
      const recentOrders = await prisma.order.findMany({
        where: { createdAt: { gte: duplicateWindowCutoff } },
      });
      const matchingOrder = findDuplicateOrder(customerName, totalWeightKg, recentOrders);
      if (matchingOrder) {
        return NextResponse.json(
          {
            duplicate: true,
            message: `ชื่อ "${customerName}" และหมูมีน้ำหนักรวม ${totalWeightKg} กก. ตรงกับออเดอร์จริงที่มีอยู่แล้ว อาจเป็นลูกค้าคนเดียวกันที่ถูกลงซ้ำ ต้องการบันทึกรายการนี้ต่อไปหรือไม่?`,
          },
          { status: 200 }
        );
      }
    }

    const entry = await prisma.pendingStock.create({
      data: {
        customerName: customerName.trim(),
        platform,
        socialMediaName: typeof socialMediaName === "string" && socialMediaName.trim() ? socialMediaName.trim() : null,
        customerAddress: typeof customerAddress === "string" && customerAddress.trim() ? customerAddress.trim() : null,
        customerPhone,
        customerZip,
        needsTaxInvoice: !!needsTaxInvoice,
        items: validItems,
        shippingMethod: typeof shippingMethod === "string" && shippingMethod ? shippingMethod : null,
        additionalShippingCost: additionalShippingCost != null ? Number(additionalShippingCost) || 0 : null,
        codAmount: codAmount != null ? Number(codAmount) || 0 : null,
        actualReceivedAmount: actualReceivedAmount != null ? Number(actualReceivedAmount) || 0 : null,
        transferSlip: typeof transferSlip === "string" && transferSlip ? transferSlip : null,
        extraSlipUrls: Array.isArray(extraSlipUrls) ? extraSlipUrls.filter((u: any) => typeof u === "string" && u.trim()) : [],
        expectedShipDate: typeof expectedShipDate === "string" && expectedShipDate ? expectedShipDate : null,
        entryDate: typeof entryDate === "string" && ENTRY_DATE_RE.test(entryDate) ? entryDate : todayBangkokDateKey(),
        note: typeof note === "string" && note.trim() ? note.trim() : null,
        createdBy: session.name,
      },
    });

    return NextResponse.json({ success: true, entry }, { status: 200 });
  } catch (error) {
    console.error("Error creating pending stock entry:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
