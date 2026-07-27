import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

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
    const { startRackNo, direction } = await req.json(); // direction: 'up' or 'down'

    if (!startRackNo || !direction) {
      return NextResponse.json({ error: "กรุณากรอกข้อมูลให้ครบ" }, { status: 400 });
    }

    const match = startRackNo.match(/^(.*?)(\d+)-(\d+)$/);
    if (!match) {
      return NextResponse.json({ error: "รูปแบบรหัสถาดไม่ถูกต้อง ต้องเป็น อักษรนำหน้า+เลข+ชิ้น (เช่น A005-3)" }, { status: 400 });
    }

    const prefix = match[1];

    const allAssignments = await prisma.rackAssignment.findMany({
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
      return NextResponse.json({ error: `ไม่พบชิ้น ${startRackNo} ในรายการที่มอบหมายไว้` }, { status: 404 });
    }

    const updates = [];
    const unshiftedNames = new Set(allAssignments.slice(0, startIndex).map(a => a.rackNo));
    if (direction === 'down') {
      // For down shift, items after startIndex are not shifted, wait, ALL items from startIndex to the end ARE shifted.
      // So unshifted names are just from 0 to startIndex - 1.
    } else {
      // For up shift, ALL items from startIndex to the end ARE shifted.
    }

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
            return NextResponse.json({ error: `เลื่อนลงไม่ได้: รหัส ${newName} ชนกับชิ้นที่มีอยู่แล้ว` }, { status: 400 });
          }

          updates.push(prisma.rackAssignment.update({
            where: { id: item.id },
            data: { rackNo: newName }
          }));
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
            return NextResponse.json({ error: `เลื่อนขึ้นไม่ได้: รหัส ${newName} ชนกับชิ้นที่มีอยู่แล้ว` }, { status: 400 });
          }

          updates.push(prisma.rackAssignment.update({
            where: { id: item.id },
            data: { rackNo: newName }
          }));
        }
      }
    }

    // Execute in transaction
    await prisma.$transaction(updates);

    return NextResponse.json({ success: true, count: updates.length }, { status: 200 });

  } catch (error) {
    console.error("Bulk shift error:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
