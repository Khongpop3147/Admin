import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import fs from "fs/promises";
import path from "path";
import { getSessionUser } from "../../../../lib/session";

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

// One-time reset requested by the DEV/business owner ahead of switching
// this deployment over to real production data: wipes every order, rack
// (pork) assignment, and their supporting logs/counters, plus the slip
// image files themselves — but deliberately leaves User accounts and
// Settings (pork price, commission rate, etc.) untouched. Meant to be
// called once and then deleted from the codebase, not a standing feature.
export async function POST() {
  try {
    const session = await getSessionUser();
    if (!session || session.role !== "DEV") {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const uploadsDir = path.join(process.cwd(), "public/uploads");
    let deletedFiles = 0;
    try {
      const files = await fs.readdir(uploadsDir);
      for (const file of files) {
        try {
          await fs.unlink(path.join(uploadsDir, file));
          deletedFiles++;
        } catch {
          // ignore individual file failures, keep going
        }
      }
    } catch {
      // uploads dir doesn't exist — nothing to delete
    }

    const [orders, racks, auditLogs, deletedPorkLogs, dailyCounters] = await prisma.$transaction([
      prisma.order.deleteMany({}),
      prisma.rackAssignment.deleteMany({}),
      prisma.orderAuditLog.deleteMany({}),
      prisma.deletedPorkLog.deleteMany({}),
      prisma.dailyCounter.deleteMany({}),
    ]);

    return NextResponse.json({
      success: true,
      deleted: {
        orders: orders.count,
        racks: racks.count,
        orderAuditLog: auditLogs.count,
        deletedPorkLog: deletedPorkLogs.count,
        dailyCounters: dailyCounters.count,
        slipFiles: deletedFiles,
      },
    });
  } catch (error) {
    console.error("Error purging old data:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
