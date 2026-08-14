import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../../lib/session";
import { isSuperAdminRole } from "../../../../../lib/roles";
import { sortRackAssignments, computeShiftTargets, syncOrderRackDetails } from "../../../../../lib/rackShift";
import { parseRackCode, getRackScopePrefix, DEFAULT_PRODUCT_TYPE } from "../../../../../lib/rackCode";

const globalForPrisma = global as unknown as { prisma: PrismaClient };
let prisma: PrismaClient;
if (globalForPrisma.prisma) {
  prisma = globalForPrisma.prisma;
} else {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
}

export async function POST(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session || !isSuperAdminRole(session.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { startRackNo, direction, productType: rawProductType } = await req.json(); // direction: 'up' or 'down'
    const productType = rawProductType || DEFAULT_PRODUCT_TYPE;

    if (!startRackNo || !direction) {
      return NextResponse.json({ error: "กรุณากรอกข้อมูลให้ครบ" }, { status: 400 });
    }

    const match = parseRackCode(startRackNo, productType);
    if (!match) {
      return NextResponse.json({ error: "รูปแบบรหัสถาดไม่ถูกต้อง ต้องเป็น อักษรนำหน้า+เลข+ชิ้น (เช่น A005-3)" }, { status: 400 });
    }

    // Scoping by prefix (in the format the DB actually stores it) is not
    // just a performance narrowing — sortRackAssignments/computeShiftTargets
    // assume every item in the batch shares the same letter prefix, so
    // mixing prefixes here would silently corrupt the ordering. Filtering by
    // productType as well closes a real cross-product collision: a classic
    // rack starting with letter "L" (e.g. "L005-1") used to `startsWith`-match
    // every PORK_LOIN rack too, since "L-A001-1" also starts with "L".
    const dbPrefix = getRackScopePrefix(match.prefix, productType);

    // The whole read -> collision-check -> write sequence has to happen as
    // one atomic unit under Serializable isolation — otherwise a piece
    // created/renamed by a totally different concurrent request (e.g.
    // someone adding a new rack piece via POST /api/users/racks) into a
    // rackNo this shift is about to write to isn't caught by the collision
    // check (which only compares against this transaction's own read
    // snapshot), and rackNo has no global uniqueness constraint — the same
    // physical piece code could end up duplicated across two owners.
    // Errors are thrown (not returned) from inside the callback, since
    // returning a NextResponse here would just become the transaction's
    // resolved VALUE, not an actual HTTP response.
    const count = await prisma.$transaction(async (tx) => {
      const allAssignments = await tx.rackAssignment.findMany({
        where: { rackNo: { startsWith: dbPrefix }, productType },
      });

      const sortedAssignments = sortRackAssignments(allAssignments, productType);
      const targets = computeShiftTargets(sortedAssignments, startRackNo, direction, productType);

      for (const t of targets) {
        await tx.rackAssignment.update({ where: { id: t.id }, data: { rackNo: t.newName } });
      }

      // A piece's rackNo is also snapshotted into every order that ever drew
      // from it (Order.rackDetails, keyed by assignmentId) — without this,
      // an already-confirmed order's printed slip / detail view would keep
      // showing the pre-shift code forever, no longer matching what's
      // actually on the shelf. Only the rackNo inside each matching entry
      // changes; weight and assignmentId are untouched.
      const targetMap = new Map(targets.map((t) => [t.id, t.newName]));
      const ordersWithRacks = await tx.order.findMany({
        where: { rackDetails: { not: null } },
        select: { id: true, rackDetails: true },
      });

      const orderUpdates = syncOrderRackDetails(ordersWithRacks, targetMap);
      for (const u of orderUpdates) {
        await tx.order.update({ where: { id: u.id }, data: { rackDetails: u.newRackDetails } });
      }

      return { count: targets.length, ordersUpdated: orderUpdates.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ success: true, count: count.count, ordersUpdated: count.ordersUpdated }, { status: 200 });

  } catch (error: any) {
    console.error("Bulk shift error:", error);
    const msg = typeof error?.message === 'string' ? error.message : '';
    if (msg.startsWith('NOT_FOUND:')) {
      return NextResponse.json({ error: `ไม่พบชิ้น ${msg.slice('NOT_FOUND:'.length)} ในรายการที่มอบหมายไว้` }, { status: 404 });
    }
    if (msg.startsWith('COLLISION_DOWN:')) {
      return NextResponse.json({ error: `เลื่อนลงไม่ได้: รหัส ${msg.slice('COLLISION_DOWN:'.length)} ชนกับชิ้นที่มีอยู่แล้ว` }, { status: 400 });
    }
    if (msg.startsWith('COLLISION_UP:')) {
      return NextResponse.json({ error: `เลื่อนขึ้นไม่ได้: รหัส ${msg.slice('COLLISION_UP:'.length)} ชนกับชิ้นที่มีอยู่แล้ว` }, { status: 400 });
    }
    if (error?.code === 'P2034' || error?.cause?.kind === 'TransactionWriteConflict') {
      return NextResponse.json({ error: "มีการแก้ไขคลังพร้อมกันจากที่อื่น กรุณาลองใหม่อีกครั้ง" }, { status: 409 });
    }
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
