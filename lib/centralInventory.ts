import "server-only";
import { PrismaClient, User } from "@prisma/client";

export const CENTRAL_INVENTORY_ID = "central-inventory-id";

// Was previously a findFirst-then-create — racy the same way the rack
// duplication bug was: two concurrent requests on a fresh install (no
// Central Inventory user yet) could both see "not found" and both try to
// create it, and the second create would throw on the id collision instead
// of just succeeding. upsert is atomic at the DB level, so only one side
// ever actually inserts; the other just gets the row back.
export async function ensureCentralInventoryUser(prisma: PrismaClient): Promise<User> {
  return prisma.user.upsert({
    where: { id: CENTRAL_INVENTORY_ID },
    update: {},
    create: {
      id: CENTRAL_INVENTORY_ID,
      name: "Central Inventory",
      role: "CENTRAL_INVENTORY",
    },
  });
}
