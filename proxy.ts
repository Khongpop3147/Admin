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

  // "/admin" is the entry point people are told to visit — bounce to the
  // real root, which already sends an unauthenticated visitor to /login
  // (via the check below) or a logged-in one straight to their role's
  // landing page, so this never double-prompts someone already signed in.
  if (pathname === "/admin" || pathname === "/admin/") {
    return NextResponse.redirect(new URL("/", request.url));
  }

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
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
