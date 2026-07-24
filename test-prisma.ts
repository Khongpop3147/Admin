import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import path from "path";

async function main() {
  console.log("Initializing DB...");
  const dbPath = path.join(process.cwd(), "dev.db");
  console.log("DB path:", dbPath);
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  const prisma = new PrismaClient({ adapter });

  console.log("Fetching orders...");
  try {
    const orders = await prisma.order.findMany();
    console.log("Orders:", orders);
  } catch (e) {
    console.error("Error:", e);
  }
}

main();
