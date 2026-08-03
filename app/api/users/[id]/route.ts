import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { getSessionUser } from "../../../../lib/session";
import { isSuperAdminRole } from "../../../../lib/roles";
import { ensureCentralInventoryUser } from "../../../../lib/centralInventory";

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

const ALLOWED_ROLES = ["SUPER_ADMIN", "ADMIN", "PACKING", "STOREFRONT"];

function stripPassword<T extends { password?: string | null }>(user: T) {
  const { password, ...rest } = user;
  return { ...rest, hasPassword: !!password };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionUser();
    if (!session || !isSuperAdminRole(session.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "ไม่พบ user นี้" }, { status: 404 });
    }
    if (existing.role === "CENTRAL_INVENTORY" || existing.role === "DEV") {
      return NextResponse.json({ error: "ไม่สามารถแก้ไข user นี้ได้" }, { status: 400 });
    }

    const updateData: any = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: "กรุณาใส่ชื่อ" }, { status: 400 });
      updateData.name = name;
    }
    // Only set when demoting an existing SUPER_ADMIN — the actual count
    // check has to happen inside the same transaction as the write (see
    // below), not here, or two concurrent demotions could both read "2 left"
    // before either commits and both proceed, leaving 0 Super Admins.
    let mustKeepOneSuperAdmin = false;
    if (body.role !== undefined) {
      if (!ALLOWED_ROLES.includes(body.role)) {
        return NextResponse.json({ error: "ตำแหน่งไม่ถูกต้อง" }, { status: 400 });
      }
      if (existing.role === "SUPER_ADMIN" && body.role !== "SUPER_ADMIN") {
        mustKeepOneSuperAdmin = true;
      }
      updateData.role = body.role;
    }
    if (body.password) {
      if (String(body.password).length < 4) {
        return NextResponse.json({ error: "รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร" }, { status: 400 });
      }
      updateData.password = await bcrypt.hash(String(body.password), 10);
    }
    if (body.nickname !== undefined) {
      const nickname = String(body.nickname).trim();
      updateData.nickname = nickname || null;
    }

    const user = await prisma.$transaction(async (tx) => {
      if (mustKeepOneSuperAdmin) {
        const superAdminCount = await tx.user.count({ where: { role: "SUPER_ADMIN" } });
        if (superAdminCount <= 1) {
          throw new Error("LAST_SUPER_ADMIN");
        }
      }
      return tx.user.update({
        where: { id },
        data: updateData,
        include: { racks: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ user: stripPassword(user) }, { status: 200 });
  } catch (error: any) {
    console.error("Error updating user:", error);
    if (error?.message === "LAST_SUPER_ADMIN") {
      return NextResponse.json({ error: "ต้องมี Super Admin เหลืออย่างน้อย 1 คนเสมอ" }, { status: 400 });
    }
    if (error?.code === "P2034" || error?.cause?.kind === "TransactionWriteConflict") {
      return NextResponse.json({ error: "มีการแก้ไขพร้อมกันจากที่อื่น กรุณาลองใหม่อีกครั้ง" }, { status: 409 });
    }
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionUser();
    if (!session || !isSuperAdminRole(session.role)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "ไม่พบ user นี้" }, { status: 404 });
    }
    if (existing.role === "CENTRAL_INVENTORY" || existing.role === "DEV") {
      return NextResponse.json({ error: "ไม่สามารถลบ user นี้ได้" }, { status: 400 });
    }
    // Rack pieces are cascade-deleted with the user by default — return them
    // to Central Inventory first so deleting an account never destroys pork
    // that's still physically there. Independent of the Super-Admin-count
    // guard below, so it's fine to run outside that transaction (upsert is
    // already atomic on its own).
    const centralUser = await ensureCentralInventoryUser(prisma);

    // The count check and the actual delete have to be one atomic unit —
    // otherwise two concurrent deletes of the last two Super Admins could
    // both read "2 left" before either commits and both proceed, leaving 0
    // Super Admins with no way to manage users/roles anymore.
    await prisma.$transaction(async (tx) => {
      if (existing.role === "SUPER_ADMIN") {
        const superAdminCount = await tx.user.count({ where: { role: "SUPER_ADMIN" } });
        if (superAdminCount <= 1) {
          throw new Error("LAST_SUPER_ADMIN");
        }
      }
      await tx.rackAssignment.updateMany({
        where: { userId: id },
        data: { userId: centralUser.id },
      });
      await tx.user.delete({ where: { id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error("Error deleting user:", error);
    if (error?.message === "LAST_SUPER_ADMIN") {
      return NextResponse.json({ error: "ต้องมี Super Admin เหลืออย่างน้อย 1 คนเสมอ" }, { status: 400 });
    }
    if (error?.code === "P2034" || error?.cause?.kind === "TransactionWriteConflict") {
      return NextResponse.json({ error: "มีการแก้ไขพร้อมกันจากที่อื่น กรุณาลองใหม่อีกครั้ง" }, { status: 409 });
    }
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
