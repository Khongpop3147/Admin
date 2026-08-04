// Stub for the "server-only" import guard, used only by vitest.config.mts's
// alias. The real package unconditionally throws outside Next's own
// webpack/turbopack build (which normally substitutes it with a no-op when
// compiling for the server target) — this replicates that no-op for tests.
export {};
