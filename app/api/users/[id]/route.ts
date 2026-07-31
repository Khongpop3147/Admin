import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { getSessionUser } from "../../../../lib/session";
import { isSuperAdminRole } from "../../../../lib/roles";

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
    if (body.role !== undefined) {
      if (!ALLOWED_ROLES.includes(body.role)) {
        return NextResponse.json({ error: "ตำแหน่งไม่ถูกต้อง" }, { status: 400 });
      }
      if (existing.role === "SUPER_ADMIN" && body.role !== "SUPER_ADMIN") {
        const superAdminCount = await prisma.user.count({ where: { role: "SUPER_ADMIN" } });
        if (superAdminCount <= 1) {
          return NextResponse.json({ error: "ต้องมี Super Admin เหลืออย่างน้อย 1 คนเสมอ" }, { status: 400 });
        }
      }
      updateData.role = body.role;
    }
    if (body.password) {
      if (String(body.password).length < 4) {
        return NextResponse.json({ error: "รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร" }, { status: 400 });
      }
      updateData.password = await bcrypt.hash(String(body.password), 10);
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      include: { racks: true },
    });
    return NextResponse.json({ user: stripPassword(user) }, { status: 200 });
  } catch (error) {
    console.error("Error updating user:", error);
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
    if (existing.role === "SUPER_ADMIN") {
      const superAdminCount = await prisma.user.count({ where: { role: "SUPER_ADMIN" } });
      if (superAdminCount <= 1) {
        return NextResponse.json({ error: "ต้องมี Super Admin เหลืออย่างน้อย 1 คนเสมอ" }, { status: 400 });
      }
    }

    // Rack pieces are cascade-deleted with the user by default — return them
    // to Central Inventory first so deleting an account never destroys pork
    // that's still physically there.
    let centralUser = await prisma.user.findFirst({ where: { role: "CENTRAL_INVENTORY" } });
    if (!centralUser) {
      centralUser = await prisma.user.create({
        data: { id: "central-inventory-id", name: "Central Inventory", role: "CENTRAL_INVENTORY" },
      });
    }
    await prisma.rackAssignment.updateMany({
      where: { userId: id },
      data: { userId: centralUser.id },
    });

    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
