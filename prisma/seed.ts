import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Fixed ids matching the local dev database exactly, so a fresh deploy ends
// up with the same accounts the team already knows.
const users = [
  { id: "user-super-admin", name: "Kongphop (Super Admin)", role: "SUPER_ADMIN" },
  { id: "user-admin-1", name: "Employee A", role: "ADMIN" },
  { id: "5d68f064-0be9-4035-ad4f-288261d886f6", name: "Employee C", role: "ADMIN" },
  { id: "665cfe8a-afcf-45f9-b75f-0691a35abad9", name: "Employee D", role: "ADMIN" },
  { id: "central-inventory-id", name: "Central Inventory", role: "CENTRAL_INVENTORY" },
  { id: "user-packing-1", name: "Packing Staff", role: "PACKING" },
];

async function main() {
  console.log("Seeding database with default users...");

  for (const u of users) {
    const result = await prisma.user.upsert({
      where: { id: u.id },
      update: {},
      create: { id: u.id, name: u.name, role: u.role },
    });
    console.log(" -", result.name, `(${result.role})`);
  }

  console.log("Seed complete.");
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
