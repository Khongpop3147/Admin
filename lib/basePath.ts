// Next.js's basePath (next.config.ts) only auto-prefixes next/link and
// next/navigation router calls — raw fetch()/window.open() calls to
// root-relative paths do NOT get it added automatically, so every such call
// in the app prepends this constant by hand. Single source of truth so a
// future basePath change (or removing it) only touches one line.
export const BASE_PATH = "/admin";
