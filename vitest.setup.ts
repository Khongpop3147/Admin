// Vitest doesn't auto-load .env the way Next.js's own dev/build commands do
// — needed here for tests (lib/session.test.ts) that hit the real local dev
// database via DATABASE_URL, matching how this whole project verifies
// against a real DB rather than mocks.
import "dotenv/config";
