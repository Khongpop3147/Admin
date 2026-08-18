"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import HrAlertPopup from "./HrAlertPopup";
import styles from "./AppShell.module.css";

// The login page has no identity yet, so it renders full-page without the
// Sidebar (which assumes a logged-in user is available).
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Close the drawer automatically whenever the route changes, so tapping a
  // nav link doesn't leave it hanging open over the new page.
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [pathname]);

  if (pathname === "/login") {
    // body is `display: flex; flex-direction: row` (to sit Sidebar + main
    // side by side). Without a Sidebar here, this page is body's only flex
    // item and would otherwise shrink to its content width instead of
    // spanning the viewport, throwing off the login form's centering.
    return <div style={{ width: "100%" }}>{children}</div>;
  }

  return (
    <>
      <div className={styles.mobileTopBar}>
        <button
          type="button"
          className={styles.hamburger}
          onClick={() => setIsSidebarOpen(true)}
          aria-label="เปิดเมนู"
        >
          <span />
          <span />
          <span />
        </button>
        <div className={styles.mobileLogo}>
          <div className={styles.mobileLogoIcon}>A</div>
          <span>AdminSpace</span>
        </div>
      </div>

      {isSidebarOpen && <div className={styles.overlay} onClick={() => setIsSidebarOpen(false)} />}

      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <main style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>{children}</main>
      <HrAlertPopup />
    </>
  );
}
