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

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Ensure Central Inventory exists
    let centralUser = await prisma.user.findFirst({ where: { role: 'CENTRAL_INVENTORY' } });
    if (!centralUser) {
      centralUser = await prisma.user.create({
        data: {
          id: 'central-inventory-id',
          name: 'Central Inventory',
          role: 'CENTRAL_INVENTORY'
        }
      });
    }

    const users = await prisma.user.findMany({
      include: {
        racks: true,
      },
      orderBy: {
        name: "asc",
      },
    });
    return NextResponse.json({ users }, { status: 200 });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
