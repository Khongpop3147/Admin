import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database with default users...");

  // Create Super Admin
  const superAdmin = await prisma.user.upsert({
    where: { id: "user-super-admin" },
    update: {},
    create: {
      id: "user-super-admin",
      name: "Kongphop (Super Admin)",
      role: "SUPER_ADMIN",
    },
  });

  // Create standard Admin
  const admin = await prisma.user.upsert({
    where: { id: "user-admin-1" },
    update: {},
    create: {
      id: "user-admin-1",
      name: "Employee A (Admin)",
      role: "ADMIN",
    },
  });

  console.log("Seed complete:");
  console.log({ superAdmin, admin });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
