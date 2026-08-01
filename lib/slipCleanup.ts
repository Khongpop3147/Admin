import "server-only";
import { PrismaClient } from "@prisma/client";
import fs from "fs/promises";
import path from "path";

const SETTINGS_ID = "singleton";
const RETENTION_MONTHS = 6;

function todayBangkokStr(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A 6-month rolling window only needs checking once a day (unlike the
// monthly pork cleanup, there's no calendar boundary to catch right at
// rollover), so this piggybacks on the same frequently-hit endpoint but
// gates on "already ran today" instead of "already ran this month".
//
// Deletes the on-disk file for any order's payment slip once that order
// turns 6 months old, and clears the order's transferSlip field so the UI
// doesn't keep linking to a now-missing file. Orders/records themselves are
// never touched — only the slip image, which is what actually consumes
// storage.
export async function runSlipCleanupIfNeeded(prisma: PrismaClient): Promise<void> {
  const today = todayBangkokStr();

  const settings = await prisma.settings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
  if (settings.lastSlipCleanupDate === today) return;

  // Explicit null-or-not-today OR, same fix as the pork cleanup's NULL
  // pitfall — `not: today` alone would never match a fresh NULL row.
  const claimed = await prisma.settings.updateMany({
    where: {
      id: SETTINGS_ID,
      OR: [{ lastSlipCleanupDate: null }, { lastSlipCleanupDate: { not: today } }],
    },
    data: { lastSlipCleanupDate: today },
  });
  if (claimed.count === 0) return;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);

  const staleOrders = await prisma.order.findMany({
    where: {
      createdAt: { lt: cutoff },
      transferSlip: { not: null },
    },
    select: { id: true, transferSlip: true, orderNo: true, customerName: true },
  });
  // transferSlip can be an empty string rather than null (never uploaded),
  // which the `not: null` filter above doesn't exclude — skip those here.
  const withRealSlip = staleOrders.filter((o) => o.transferSlip);
  if (withRealSlip.length === 0) return;

  const uploadsDir = path.join(process.cwd(), "public/uploads");
  let deletedCount = 0;
  for (const order of withRealSlip) {
    const filename = order.transferSlip!.split("/").pop();
    if (!filename) continue;
    try {
      await fs.unlink(path.join(uploadsDir, filename));
      deletedCount++;
    } catch {
      // Already gone (or never existed on disk) — still clear the DB
      // reference below so the UI doesn't keep pointing at it.
    }
  }

  await prisma.order.updateMany({
    where: { id: { in: withRealSlip.map((o) => o.id) } },
    data: { transferSlip: null },
  });

  await prisma.orderAuditLog.create({
    data: {
      action: "EDIT",
      summary: `ลบไฟล์สลิปที่เก่ากว่า ${RETENTION_MONTHS} เดือนอัตโนมัติ ${withRealSlip.length} รายการ (ลบไฟล์สำเร็จ ${deletedCount} ไฟล์)`,
    },
  });
}
