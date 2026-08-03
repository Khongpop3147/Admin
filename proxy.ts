import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "./lib/session";

// Paths that work without being logged in at all.
const PUBLIC_PATHS = ["/login"];
const PUBLIC_API_PREFIXES = ["/api/auth/"];
// Uploaded slip images must stay reachable without login — Thunder's
// slip-verification API fetches the URL directly from its own servers (no
// session cookie), same as before auth existed at all. New uploads are
// served via /api/uploads/[filename] (a route handler, so it always reads
// the current disk state); /uploads/ is kept public too for slip links
// saved before that change, which the static public/ folder can still serve.
const PUBLIC_PATH_PREFIXES = ["/uploads/", "/api/uploads/"];

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // request.nextUrl.pathname is already basePath-stripped (a request for
  // /admin/orders reports pathname "/orders" here — verified empirically).
  // Since basePath IS "/admin", visiting /admin itself strips to pathname
  // "/", which already lines up exactly with the app's real root page
  // (app/page.tsx's role-based router) — no separate bridging needed here;
  // that only happens for the bare domain root, which sits outside
  // basePath's scope entirely and is handled by redirects() in
  // next.config.ts instead (proxy never even sees those requests).
  const basePath = request.nextUrl.basePath || "";
  const withBase = (path: string) => new URL(basePath + path, request.url);

  if (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p)) ||
    PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get("session")?.value;
  const session = await verifySession(token);

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    }
    return NextResponse.redirect(withBase("/login"));
  }

  return NextResponse.next();
}

export const config = {
  // The plain "/" entry matters: a request for the bare basePath root
  // (i.e. exactly /admin, no trailing segment) strips to an empty pathname
  // that the broad regex below doesn't match on its own (it requires a
  // leading "/") — verified empirically, this proxy silently never ran for
  // that exact one request shape without this explicit entry.
  matcher: ["/", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
