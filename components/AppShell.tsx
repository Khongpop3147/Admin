"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

// The login page has no identity yet, so it renders full-page without the
// Sidebar (which assumes a logged-in user is available).
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") {
    // body is `display: flex; flex-direction: row` (to sit Sidebar + main
    // side by side). Without a Sidebar here, this page is body's only flex
    // item and would otherwise shrink to its content width instead of
    // spanning the viewport, throwing off the login form's centering.
    return <div style={{ width: "100%" }}>{children}</div>;
  }

  return (
    <>
      <Sidebar />
      <main style={{ flex: 1, overflowY: "auto" }}>{children}</main>
    </>
  );
}
