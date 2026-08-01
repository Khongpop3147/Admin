import "server-only";
import { PrismaClient } from "@prisma/client";

const SETTINGS_ID = "singleton";

function currentBangkokMonth(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Clears out fully-used-up rack pieces (isUsedUp: true) once per calendar
// month, the first time any request runs after the month rolls over. There's
// no cron infrastructure in this app, so this piggybacks on a
// frequently-hit endpoint instead — cheap on every call (one row read) and
// only does real work the first time each month.
//
// The Settings row's lastPorkCleanupMonth field doubles as a lock: the
// updateMany below only succeeds for whichever concurrent request gets
// there first, so two requests racing at the month boundary can't both run
// the cleanup.
export async function runMonthlyPorkCleanupIfNeeded(prisma: PrismaClient): Promise<void> {
  const thisMonth = currentBangkokMonth();

  // Settings is created lazily elsewhere (GET /api/settings) — don't assume
  // it exists yet, or the cleanup could never run on a fresh install.
  const settings = await prisma.settings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
  if (settings.lastPorkCleanupMonth === thisMonth) return;

  // NULL != thisMonth is NULL (not true) in SQL, so a plain `not: thisMonth`
  // would never match a fresh row that's never been cleaned up — explicitly
  // include the null case too.
  const claimed = await prisma.settings.updateMany({
    where: {
      id: SETTINGS_ID,
      OR: [{ lastPorkCleanupMonth: null }, { lastPorkCleanupMonth: { not: thisMonth } }],
    },
    data: { lastPorkCleanupMonth: thisMonth },
  });
  if (claimed.count === 0) return;

  const usedUpPieces = await prisma.rackAssignment.findMany({
    where: { isUsedUp: true },
    include: { user: true },
  });
  if (usedUpPieces.length === 0) return;

  await prisma.$transaction([
    prisma.deletedPorkLog.createMany({
      data: usedUpPieces.map((r) => ({
        rackNo: r.rackNo,
        weight: r.initialWeight,
        userName: r.user?.name || "ไม่ระบุ",
      })),
    }),
    prisma.rackAssignment.deleteMany({
      where: { id: { in: usedUpPieces.map((r) => r.id) } },
    }),
  ]);
}
