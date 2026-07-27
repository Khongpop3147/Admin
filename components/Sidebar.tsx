"use client";

import Link from "next/link";
import styles from "./Sidebar.module.css";
import { useUser } from "./UserProvider";
import { usePathname } from "next/navigation";

export default function Sidebar() {
  const { currentUser, setCurrentUser, users } = useUser();
  const pathname = usePathname();

  const handleUserChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = users.find(u => u.id === e.target.value);
    if (selected) setCurrentUser(selected);
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <div className={styles.logoIcon}>A</div>
        <h2>AdminSpace</h2>
      </div>

      <nav className={styles.nav}>
        <Link href="/" className={styles.navItem}>
          <span className={styles.icon}>📊</span>
          Dashboard
        </Link>
        <Link href="/" className={`${styles.navItem} ${pathname === '/' ? styles.active : ''}`}>
          <span className={styles.icon}>📝</span>
          Order Details
        </Link>
        <Link href="/packing" className={`${styles.navItem} ${pathname === '/packing' ? styles.active : ''}`}>
          <span className={styles.icon}>📦</span>
          Packing & Export
        </Link>
        {currentUser?.role === "SUPER_ADMIN" && (
          <>
            <Link href="/storefront" className={`${styles.navItem} ${pathname === '/storefront' ? styles.active : ''}`}>
              <span className={styles.icon}>🏪</span>
              Storefront Orders
            </Link>
            <Link href="/racks" className={`${styles.navItem} ${pathname === '/racks' ? styles.active : ''}`}>
              <span className={styles.icon}>⚙️</span>
              Rack Management
            </Link>
          </>
        )}
      </nav>

      <div className={styles.footer}>
        <div className={styles.user}>
          <div className={styles.avatar}>
            {currentUser ? currentUser.name.charAt(0) : "?"}
          </div>
          <div className={styles.userInfo} style={{ width: "100%" }}>
            <select 
              value={currentUser?.id || ""} 
              onChange={handleUserChange}
              style={{ 
                width: "100%", 
                background: "rgba(255,255,255,0.1)", 
                color: "white", 
                border: "none", 
                padding: "4px 8px", 
                borderRadius: "4px",
                fontSize: "12px",
                marginTop: "4px"
              }}
            >
              {users.filter(u => u.role !== "CENTRAL_INVENTORY").map(u => {
                const remaining = u.role !== "SUPER_ADMIN" && u.racks 
                  ? u.racks.reduce((sum, r) => sum + (!r.isUsedUp ? (r.remainingWeight || 0) : 0), 0).toFixed(2)
                  : null;
                return (
                  <option key={u.id} value={u.id} style={{ color: "black" }}>
                    {u.name} ({u.role}){remaining !== null ? ` | ${remaining} kg` : ''}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>
    </aside>
  );
}
