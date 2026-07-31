import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

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

// Only the Super Admin gets a starter password — everyone else stays locked
// out (password: null) until the Super Admin sets one for them from the
// Super Admin Setting page. This default only applies on first create; a
// re-run of seed never overwrites a password someone already set.
const DEFAULT_SUPER_ADMIN_PASSWORD = "changeme123";

async function main() {
  console.log("Seeding database with default users...");

  for (const u of users) {
    const isSuperAdmin = u.role === "SUPER_ADMIN";
    const result = await prisma.user.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        name: u.name,
        role: u.role,
        password: isSuperAdmin ? await bcrypt.hash(DEFAULT_SUPER_ADMIN_PASSWORD, 10) : null,
      },
    });
    console.log(" -", result.name, `(${result.role})`);
  }

  console.log("Seed complete.");
  console.log(`Super Admin starter password (only set if the account was just created): ${DEFAULT_SUPER_ADMIN_PASSWORD} — change it immediately from Super Admin Setting.`);
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
