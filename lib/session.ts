import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
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

export interface SessionPayload {
  userId: string;
  name: string;
  role: string;
  sessionVersion: number;
}

const rawSecret = process.env.SESSION_SECRET;
if (!rawSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET is required in production — generate one with: openssl rand -base64 32");
}
const encodedKey = new TextEncoder().encode(rawSecret || "dev-only-insecure-secret-do-not-use-in-prod");

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export async function encryptSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(encodedKey);
}

// Pure JWT verification — no DB. Confirms the token is authentic and
// unexpired, but NOT that the session hasn't been force-logged-out since it
// was issued (see verifySession for that).
export async function decryptSession(token?: string | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, { algorithms: ["HS256"] });
    if (
      typeof payload.userId !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.sessionVersion !== "number"
    ) {
      return null;
    }
    return { userId: payload.userId, name: payload.name, role: payload.role, sessionVersion: payload.sessionVersion };
  } catch {
    return null;
  }
}

// A JWT is self-verifying and stateless — there's no way to revoke one
// before it expires just by looking at the token itself. To support forcing
// a specific user's existing logins to stop working (DEV-only "kick"
// feature, see app/api/users/[id]/kick/route.ts), every token carries a
// sessionVersion snapshot from when it was issued; bumping the user's
// sessionVersion in the DB makes every token issued before that bump fail
// this check on its very next request, regardless of how much of its 30-day
// expiry is left.
export async function verifySession(token?: string | null): Promise<SessionPayload | null> {
  const session = await decryptSession(token);
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { sessionVersion: true } });
  if (!user || user.sessionVersion !== session.sessionVersion) return null;
  return session;
}

export async function createSessionCookie(payload: SessionPayload) {
  const token = await encryptSession(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return verifySession(token);
}
