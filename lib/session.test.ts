import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { encryptSession, decryptSession, verifySession, SessionPayload } from "./session";

// verifySession is DB-backed (checks the user's sessionVersion hasn't been
// bumped since the token was issued — the core mechanism behind the DEV-only
// "kick user" force-logout feature), so this suite hits the real local dev
// database rather than mocking Prisma.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
let testUserId: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { name: "__vitest session test user__", role: "ADMIN", sessionVersion: 5 },
  });
  testUserId = user.id;
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: testUserId } });
  await prisma.$disconnect();
});

function payload(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return { userId: testUserId, name: "Test User", role: "ADMIN", sessionVersion: 5, ...overrides };
}

describe("encryptSession / decryptSession", () => {
  it("round-trips a valid payload", async () => {
    const token = await encryptSession(payload());
    const decoded = await decryptSession(token);
    expect(decoded).toEqual(payload());
  });

  it("rejects a tampered token", async () => {
    const token = await encryptSession(payload());
    const tampered = token.slice(0, -4) + "abcd";
    expect(await decryptSession(tampered)).toBeNull();
  });

  it("rejects a missing/empty token", async () => {
    expect(await decryptSession(null)).toBeNull();
    expect(await decryptSession(undefined)).toBeNull();
    expect(await decryptSession("")).toBeNull();
  });

  it("rejects a well-formed but garbage string", async () => {
    expect(await decryptSession("not.a.jwt")).toBeNull();
  });
});

describe("verifySession", () => {
  it("accepts a token whose sessionVersion still matches the DB", async () => {
    const token = await encryptSession(payload({ sessionVersion: 5 }));
    expect(await verifySession(token)).toEqual(payload({ sessionVersion: 5 }));
  });

  it("rejects a token whose sessionVersion has been bumped since issue (the kick-user mechanism)", async () => {
    const token = await encryptSession(payload({ sessionVersion: 5 }));
    await prisma.user.update({ where: { id: testUserId }, data: { sessionVersion: 6 } });
    try {
      expect(await verifySession(token)).toBeNull();
    } finally {
      await prisma.user.update({ where: { id: testUserId }, data: { sessionVersion: 5 } });
    }
  });

  it("rejects a token for a user that no longer exists", async () => {
    const token = await encryptSession(payload({ userId: "00000000-0000-0000-0000-000000000000" }));
    expect(await verifySession(token)).toBeNull();
  });

  it("rejects a null/invalid token without hitting the DB error path", async () => {
    expect(await verifySession(null)).toBeNull();
  });
});
