import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../../lib/session";
import { isSuperAdminRole } from "../../../../../lib/roles";

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

    const { startRackNo, direction } = await req.json(); // direction: 'up' or 'down'

    if (!startRackNo || !direction) {
      return NextResponse.json({ error: "กรุณากรอกข้อมูลให้ครบ" }, { status: 400 });
    }

    const match = startRackNo.match(/^(.*?)(\d+)-(\d+)$/);
    if (!match) {
      return NextResponse.json({ error: "รูปแบบรหัสถาดไม่ถูกต้อง ต้องเป็น อักษรนำหน้า+เลข+ชิ้น (เช่น A005-3)" }, { status: 400 });
    }

    const prefix = match[1];

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
        where: { rackNo: { startsWith: prefix } },
      });

      // Sort manually to be perfectly safe with our format
      allAssignments.sort((a, b) => {
        const aM = a.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
        const bM = b.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
        if (aM && bM) {
          const aNum = parseInt(aM[2], 10) * 10 + parseInt(aM[3], 10);
          const bNum = parseInt(bM[2], 10) * 10 + parseInt(bM[3], 10);
          return aNum - bNum;
        }
        return a.rackNo.localeCompare(b.rackNo);
      });

      const startIndex = allAssignments.findIndex(a => a.rackNo === startRackNo);
      if (startIndex === -1) {
        throw new Error(`NOT_FOUND:${startRackNo}`);
      }

      const targets: { id: string; newName: string }[] = [];
      const unshiftedNames = new Set(allAssignments.slice(0, startIndex).map(a => a.rackNo));

      if (direction === 'down') {
        for (let i = allAssignments.length - 1; i >= startIndex; i--) {
          const item = allAssignments[i];
          const m = item.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
          if (m) {
            const p = m[1];
            let rNum = parseInt(m[2], 10);
            let pNum = parseInt(m[3], 10);
            pNum++;
            if (pNum > 5) { pNum = 1; rNum++; }
            const newName = `${p}${String(rNum).padStart(m[2].length, '0')}-${pNum}`;

            if (unshiftedNames.has(newName)) {
              throw new Error(`COLLISION_DOWN:${newName}`);
            }

            targets.push({ id: item.id, newName });
          }
        }
      } else if (direction === 'up') {
        for (let i = startIndex; i < allAssignments.length; i++) {
          const item = allAssignments[i];
          const m = item.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
          if (m) {
            const p = m[1];
            let rNum = parseInt(m[2], 10);
            let pNum = parseInt(m[3], 10);
            pNum--;
            if (pNum < 1) { pNum = 5; rNum--; }
            const newName = `${p}${String(rNum).padStart(m[2].length, '0')}-${pNum}`;

            if (unshiftedNames.has(newName)) {
              throw new Error(`COLLISION_UP:${newName}`);
            }

            targets.push({ id: item.id, newName });
          }
        }
      }

      for (const t of targets) {
        await tx.rackAssignment.update({ where: { id: t.id }, data: { rackNo: t.newName } });
      }

      return targets.length;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ success: true, count }, { status: 200 });

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
