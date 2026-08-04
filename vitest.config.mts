import { defineConfig } from "vitest/config";

// Logic-only test suite for now (lib/*.ts pure functions + API route unit
// tests) — no React/DOM rendering involved, so no jsdom environment needed.
export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname,
      // Next.js's bundler substitutes this with a no-op when compiling for
      // the server target; outside that bundler (i.e. here) the real
      // package unconditionally throws, so tests need the same no-op.
      "server-only": `${import.meta.dirname}/lib/__test-stubs__/server-only.ts`,
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
