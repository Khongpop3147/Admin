"use client";

import Link from "next/link";
import styles from "./Sidebar.module.css";
import { useUser } from "./UserProvider";
import { usePathname } from "next/navigation";
import { isSuperAdminRole } from "../lib/roles";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "แอดมิน",
  PACKING: "แพ็คของ",
  STOREFRONT: "หน้าร้าน",
  CENTRAL_INVENTORY: "คลังกลาง",
  DEV: "Dev",
};

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { currentUser, sessionUser, setCurrentUser, users, logout } = useUser();
  const pathname = usePathname();

  const isDev = sessionUser?.role === "DEV";

  const handleUserChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = users.find(u => u.id === e.target.value);
    if (selected) setCurrentUser(selected);
  };

  if (!currentUser) return null;

  return (
    <aside className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`}>
      <div className={styles.logo}>
        <div className={styles.logoIcon}>A</div>
        <h2>AdminSpace</h2>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="ปิดเมนู">✕</button>
      </div>

      <nav className={styles.nav}>
        {currentUser?.role !== "PACKING" && currentUser?.role !== "STOREFRONT" && (
          <Link href="/dashboard" className={`${styles.navItem} ${pathname === '/dashboard' ? styles.active : ''}`}>
            Dashboard
          </Link>
        )}
        {currentUser?.role !== "PACKING" && (
          <Link href="/orders" className={`${styles.navItem} ${pathname === '/orders' ? styles.active : ''}`}>
            {currentUser?.role === "STOREFRONT" ? "ขายหน้าร้าน" : "Order Details"}
          </Link>
        )}
        {(isSuperAdminRole(currentUser?.role) || currentUser?.role === "PACKING") && (
          <Link href="/packing" className={`${styles.navItem} ${pathname === '/packing' ? styles.active : ''}`}>
            Packing & Export
          </Link>
        )}
        {isSuperAdminRole(currentUser?.role) && (
          <>
            <Link href="/storefront" className={`${styles.navItem} ${pathname === '/storefront' ? styles.active : ''}`}>
              Storefront Orders
            </Link>
            <Link href="/racks" className={`${styles.navItem} ${pathname === '/racks' ? styles.active : ''}`}>
              Rack Management
            </Link>
            <Link href="/users" className={`${styles.navItem} ${pathname === '/users' ? styles.active : ''}`}>
              Super Admin Setting
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
            {isDev ? (
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
                  const remaining = u.role !== "SUPER_ADMIN" && u.role !== "DEV" && u.racks
                    ? u.racks.reduce((sum, r) => sum + (!r.isUsedUp ? (r.remainingWeight || 0) : 0), 0).toFixed(2)
                    : null;
                  return (
                    <option key={u.id} value={u.id} style={{ color: "black" }}>
                      {u.name} ({u.role}){remaining !== null ? ` | ${remaining} kg` : ''}
                    </option>
                  );
                })}
              </select>
            ) : (
              <div style={{ fontSize: "13px" }}>
                <div style={{ fontWeight: "bold" }}>{currentUser.name}</div>
                <div style={{ fontSize: "11px", opacity: 0.7 }}>{ROLE_LABELS[currentUser.role] || currentUser.role}</div>
              </div>
            )}
            <button
              onClick={logout}
              style={{
                width: "100%",
                marginTop: "8px",
                background: "rgba(255,255,255,0.08)",
                color: "white",
                border: "none",
                padding: "6px 8px",
                borderRadius: "4px",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
