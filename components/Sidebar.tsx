"use client";

import Link from "next/link";
import styles from "./Sidebar.module.css";
import { useUser } from "./UserProvider";
import { usePathname } from "next/navigation";
import { isSuperAdminRole } from "../lib/roles";
import { BASE_PATH } from "../lib/basePath";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "แอดมิน",
  PACKING: "แพ็คของ",
  STOREFRONT: "หน้าร้าน",
  CENTRAL_INVENTORY: "คลังกลาง",
  DEV: "Dev",
  HR: "HR",
};

// Swatch colors mirror the actual --accent-* values each [data-theme="..."]
// block defines in globals.css — kept in sync by hand since a swatch has to
// show its color before that theme is ever applied to pick it.
const THEME_OPTIONS: { key: string | null; label: string; color: string }[] = [
  { key: null, label: "ฟ้า (ปกติ)", color: "#58a6ff" },
  { key: "purple", label: "ม่วง", color: "#a371f7" },
  { key: "green", label: "เขียว", color: "#2dd4bf" },
  { key: "orange", label: "ส้ม", color: "#f0883e" },
  { key: "blood", label: "เลือดหมู", color: "#d9636c" },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { currentUser, sessionUser, setCurrentUser, users, logout, setTheme, setThemeMode } = useUser();
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
        <img src={`${BASE_PATH}/logo.png`} alt="EASY Crispy Pork" className={styles.logoIcon} />
        <h2>AdminSpace</h2>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="ปิดเมนู">✕</button>
      </div>

      <nav className={styles.nav}>
        {currentUser?.role !== "PACKING" && currentUser?.role !== "STOREFRONT" && (
          <Link href="/dashboard" className={`${styles.navItem} ${pathname === '/dashboard' ? styles.active : ''}`}>
            Dashboard
          </Link>
        )}
        {(isSuperAdminRole(currentUser?.role) || currentUser?.role === "HR") && (
          <Link href="/hr-manage" className={`${styles.navItem} ${pathname === '/hr-manage' ? styles.active : ''}`}>
            HR Manage
          </Link>
        )}
        {currentUser?.role !== "PACKING" && currentUser?.role !== "STOREFRONT" && (
          <Link href="/orders" className={`${styles.navItem} ${pathname === '/orders' ? styles.active : ''}`}>
            ออเดอร์
          </Link>
        )}
        {currentUser?.role !== "PACKING" && currentUser?.role !== "STOREFRONT" && (
          <Link href="/pending-stock" className={`${styles.navItem} ${pathname === '/pending-stock' ? styles.active : ''}`}>
            ลูกค้ารอหมู
          </Link>
        )}
        {isSuperAdminRole(currentUser?.role) && (
          <Link href="/private-clients" className={`${styles.navItem} ${pathname === '/private-clients' ? styles.active : ''}`}>
            ลูกค้าส่วนตัว
          </Link>
        )}
        {(isSuperAdminRole(currentUser?.role) || currentUser?.role === "PACKING") && (
          <Link href="/packing" className={`${styles.navItem} ${pathname === '/packing' ? styles.active : ''}`}>
            แพ็คของ
          </Link>
        )}
        {(isSuperAdminRole(currentUser?.role) || currentUser?.role === "STOREFRONT" || currentUser?.canAccessStorefront) && (
          <Link href="/storefront" className={`${styles.navItem} ${pathname === '/storefront' ? styles.active : ''}`}>
            หน้าร้าน
          </Link>
        )}
        {isSuperAdminRole(currentUser?.role) && (
          <>
            <Link href="/racks" className={`${styles.navItem} ${pathname === '/racks' ? styles.active : ''}`}>
              จัดการชิ้นหมู
            </Link>
            <Link href="/users" className={`${styles.navItem} ${pathname === '/users' ? styles.active : ''}`}>
              Super Admin Setting
            </Link>
            <Link href="/audit-log" className={`${styles.navItem} ${pathname === '/audit-log' ? styles.active : ''}`}>
              ประวัติการทำงาน
            </Link>
          </>
        )}
        {/* Just-for-fun feature — visible to everyone logged in, no role
            gate, unlike every other link in this file. Kept last so it
            never displaces a real work link above it. */}
        <Link href="/pets" className={`${styles.navItem} ${pathname === '/pets' ? styles.active : ''}`}>
          สัตว์เลี้ยง
        </Link>
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
                  background: "rgba(var(--surface-rgb),0.1)",
                  color: "var(--text-primary)",
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

            {/* Self-service accent-color theme — own login only, applied off
                sessionUser not currentUser (see UserProvider's own comment
                on setTheme), so this always reflects/sets the real account's
                preference even while a DEV is locally previewing someone
                else. */}
            <div style={{ display: "flex", gap: "6px", marginTop: "10px", alignItems: "center" }}>
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.key ?? "default"}
                  type="button"
                  onClick={() => setTheme(opt.key)}
                  title={opt.label}
                  aria-label={`ธีมสี${opt.label}`}
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    background: opt.color,
                    border: (sessionUser?.themePreference || null) === opt.key ? "2px solid var(--bg-color)" : "2px solid transparent",
                    boxShadow: (sessionUser?.themePreference || null) === opt.key ? "0 0 0 1px rgba(var(--surface-rgb),0.3)" : "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
              ))}

              {/* Independent axis from accent color — same self-service
                  pattern, own field (themeMode) via setThemeMode. */}
              <button
                type="button"
                onClick={() => setThemeMode(sessionUser?.themeMode === "light" ? null : "light")}
                title={sessionUser?.themeMode === "light" ? "โหมดสว่าง (กดเพื่อเปลี่ยนเป็นมืด)" : "โหมดมืด (กดเพื่อเปลี่ยนเป็นสว่าง)"}
                aria-label="สลับโหมดสว่าง/มืด"
                style={{
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  marginLeft: "4px",
                  background: sessionUser?.themeMode === "light" ? "#f6f8fa" : "#0d1117",
                  border: "2px solid var(--border-color)",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: "10px",
                  lineHeight: "16px",
                  textAlign: "center",
                }}
              >
                {sessionUser?.themeMode === "light" ? "☀" : "☾"}
              </button>
            </div>

            <button
              onClick={logout}
              style={{
                width: "100%",
                marginTop: "8px",
                background: "rgba(var(--surface-rgb),0.08)",
                color: "var(--text-primary)",
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
