import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getSessionUser } from "../../../../../lib/session";

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

const VALID_THEMES = new Set(["purple", "green", "orange", "blood"]);
const VALID_MODES = new Set(["light"]);

// Self-service, unlike every other User field an admin doesn't manage
// themselves (defaultPlatform, role, etc. — all Super-Admin-only via
// /api/users/[id]) — always acts on the real logged-in session (never a
// DEV's local preview override), same "server-side authorization trusts
// the real session" rule UserProvider's own comment documents.
//
// `theme` (accent color) and `mode` (light/dark) are independent — each is
// only touched when its own key is present in the body, so setTheme() and
// setThemeMode() in UserProvider.tsx can each PATCH just their own field
// without accidentally clearing the other back to default.
export async function PATCH(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
    }

    const body = await req.json();
    const data: { themePreference?: string | null; themeMode?: string | null } = {};
    // null/"" clears back to the default (blue accent / dark mode) — not an
    // error case, just an explicit reset.
    if ("theme" in body) {
      data.themePreference = typeof body.theme === "string" && VALID_THEMES.has(body.theme) ? body.theme : null;
    }
    if ("mode" in body) {
      data.themeMode = typeof body.mode === "string" && VALID_MODES.has(body.mode) ? body.mode : null;
    }

    const user = await prisma.user.update({
      where: { id: session.userId },
      data,
    });

    return NextResponse.json({ success: true, themePreference: user.themePreference, themeMode: user.themeMode }, { status: 200 });
  } catch (error) {
    console.error("Error updating theme preference:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
