"use client";

import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { useUser } from "../../components/UserProvider";
import { useSettings } from "../../components/SettingsProvider";
import { isSuperAdminRole } from "../../lib/roles";
import { BASE_PATH } from "../../lib/basePath";
import { previousDayStr } from "../../lib/packingCutoff";
import PasswordField from "../../components/PasswordField";
import styles from "../page.module.css";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "แอดมิน",
  PACKING: "แพ็คของ",
  STOREFRONT: "หน้าร้าน",
  CENTRAL_INVENTORY: "คลังกลาง",
  HR: "HR",
};

const ROLE_ICONS: Record<string, string> = {
  SUPER_ADMIN: "👑",
  ADMIN: "🧑‍💼",
  PACKING: "📦",
  STOREFRONT: "🏪",
  CENTRAL_INVENTORY: "🏭",
  HR: "🗂️",
};

const DEFAULT_PLATFORM_OPTIONS = ["Facebook", "Line", "TikTok", "Shopee", "Other"];
const PLATFORM_LABELS: Record<string, string> = {
  Facebook: "Facebook",
  Line: "Line",
  TikTok: "TikTok",
  Shopee: "Shopee",
  Other: "อื่นๆ",
};

const CLEAR_CONFIRM_PHRASE = "ลบข้อมูล";

interface AuditLog {
  id: string;
  orderId: string | null;
  action: string;
  summary: string;
  performedBy: string | null;
  createdAt: string;
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel" style={{ padding: "20px 24px", borderRadius: "16px", marginBottom: "24px" }}>
      <h3 style={{ fontSize: "16px", marginBottom: subtitle ? "4px" : "16px" }}>{title}</h3>
      {subtitle && <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>{subtitle}</p>}
      {children}
    </div>
  );
}

export default function UsersPage() {
  const { currentUser, sessionUser, users, fetchUsers } = useUser();
  // Real session role, not the DEV "view as" override — a DEV browsing as
  // someone else shouldn't lose access to this DEV-only button, and no
  // other role should ever see it regardless of what they're viewing as.
  const isRealDev = sessionUser?.role === "DEV";
  const { settings, fetchSettings } = useSettings();

  // --- User management state ---
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNickname, setNewNickname] = useState("");
  const [newRole, setNewRole] = useState("ADMIN");
  const [newPassword, setNewPassword] = useState("");
  const [newCanAccessStorefront, setNewCanAccessStorefront] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNickname, setEditNickname] = useState("");
  const [editRole, setEditRole] = useState("ADMIN");
  const [editPassword, setEditPassword] = useState("");
  const [editDefaultPlatform, setEditDefaultPlatform] = useState("");
  const [editCanAccessStorefront, setEditCanAccessStorefront] = useState(false);

  const [errorMsg, setErrorMsg] = useState("");

  // --- Settings form state ---
  const [settingsForm, setSettingsForm] = useState(settings);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");

  useEffect(() => {
    setSettingsForm(settings);
  }, [settings]);

  // --- Full export state ---
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");

  // --- Clear data state ---
  const [clearMode, setClearMode] = useState<"range" | "all">("range");
  const [clearFrom, setClearFrom] = useState("");
  const [clearTo, setClearTo] = useState("");
  const [clearConfirmText, setClearConfirmText] = useState("");
  const [isClearing, setIsClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState("");

  // --- Fix order date state ---
  const [moveDateViewDate, setMoveDateViewDate] = useState("");
  const [moveDateOrders, setMoveDateOrders] = useState<any[]>([]);
  const [isLoadingMoveDateOrders, setIsLoadingMoveDateOrders] = useState(false);
  const [moveDateSelected, setMoveDateSelected] = useState<Set<string>>(new Set());
  const [moveDateTarget, setMoveDateTarget] = useState("");
  const [isMovingDate, setIsMovingDate] = useState(false);
  const [moveDateMsg, setMoveDateMsg] = useState("");

  // --- Audit log state ---
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isLoadingLog, setIsLoadingLog] = useState(false);

  if (!currentUser) return null;
  if (!isSuperAdminRole(currentUser.role)) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>ไม่มีสิทธิ์เข้าถึง</h1>
          <p className={styles.subtitle}>เฉพาะ Super Admin เท่านั้นที่เข้าหน้านี้ได้</p>
        </div>
      </div>
    );
  }

  const visibleUsers = users.filter((u) => u.role !== "CENTRAL_INVENTORY" && u.role !== "DEV");

  // --- User management handlers ---
  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) {
      setErrorMsg("กรุณาใส่ชื่อ");
      return;
    }
    if (!newPassword || newPassword.length < 4) {
      setErrorMsg("รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร");
      return;
    }
    setIsSaving(true);
    setErrorMsg("");
    try {
      const res = await fetch(`${BASE_PATH}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, nickname: newNickname.trim(), role: newRole, password: newPassword, canAccessStorefront: newCanAccessStorefront }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "เกิดข้อผิดพลาด");
        return;
      }
      await fetchUsers();
      setNewName("");
      setNewNickname("");
      setNewRole("ADMIN");
      setNewPassword("");
      setNewCanAccessStorefront(false);
      setIsAddOpen(false);
    } catch (e) {
      setErrorMsg("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (u: (typeof users)[number]) => {
    setEditingId(u.id);
    setEditName(u.name);
    setEditNickname((u as any).nickname || "");
    setEditRole(u.role);
    setEditPassword("");
    setEditDefaultPlatform((u as any).defaultPlatform || "");
    setEditCanAccessStorefront(!!(u as any).canAccessStorefront);
    setErrorMsg("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setErrorMsg("");
  };

  const saveEdit = async (id: string) => {
    const name = editName.trim();
    if (!name) {
      setErrorMsg("กรุณาใส่ชื่อ");
      return;
    }
    if (editPassword && editPassword.length < 4) {
      setErrorMsg("รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร");
      return;
    }
    setIsSaving(true);
    setErrorMsg("");
    try {
      const body: any = { name, role: editRole, nickname: editNickname.trim(), defaultPlatform: editDefaultPlatform, canAccessStorefront: editCanAccessStorefront };
      if (editPassword) body.password = editPassword;
      const res = await fetch(`${BASE_PATH}/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "เกิดข้อผิดพลาด");
        return;
      }
      await fetchUsers();
      setEditingId(null);
      setEditPassword("");
    } catch (e) {
      setErrorMsg("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (u: (typeof users)[number]) => {
    const rackCount = u.racks?.length || 0;
    const rackWarning = rackCount > 0 ? `\n\n📦 คนนี้มีชิ้นหมูที่มอบหมายอยู่ ${rackCount} รายการ จะถูกย้ายกลับเข้าคลังกลางให้อัตโนมัติ` : "";
    const confirmed = confirm(`ลบ "${u.name}" (${ROLE_LABELS[u.role] || u.role}) ออกจากระบบ?${rackWarning}\n\nออเดอร์เก่าที่คนนี้เคยสร้างไว้จะยังอยู่ครบ ไม่ถูกลบ`);
    if (!confirmed) return;

    try {
      const res = await fetch(`${BASE_PATH}/api/users/${u.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "เกิดข้อผิดพลาดในการลบ");
        return;
      }
      await fetchUsers();
    } catch (e) {
      alert("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    }
  };

  const handleKick = async (u: (typeof users)[number]) => {
    const confirmed = confirm(`บังคับให้ "${u.name}" ออกจากระบบทุกอุปกรณ์ที่ล็อกอินอยู่?\n\nต้องล็อกอินใหม่ถึงจะใช้งานได้อีกครั้ง`);
    if (!confirmed) return;

    try {
      const res = await fetch(`${BASE_PATH}/api/users/${u.id}/kick`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "เกิดข้อผิดพลาดในการบังคับออกจากระบบ");
        return;
      }
      alert(`บังคับ "${u.name}" ออกจากระบบเรียบร้อย`);
    } catch (e) {
      alert("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    }
  };

  // --- Settings handlers ---
  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setSettingsMsg("");
    try {
      const res = await fetch(`${BASE_PATH}/api/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setSettingsMsg(data.error || "เกิดข้อผิดพลาด");
        return;
      }
      await fetchSettings();
      setSettingsMsg("✅ บันทึกเรียบร้อย");
      setTimeout(() => setSettingsMsg(""), 3000);
    } catch (e) {
      setSettingsMsg("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsSavingSettings(false);
    }
  };

  // --- Export handler ---
  const handleExportFull = async () => {
    if (!exportFrom || !exportTo) {
      setExportMsg("กรุณาเลือกช่วงวันที่");
      return;
    }
    setIsExporting(true);
    setExportMsg("");
    try {
      const res = await fetch(`${BASE_PATH}/api/orders?dateFrom=${exportFrom}&dateTo=${exportTo}`);
      const data = await res.json();
      const orders = data.orders || [];
      if (orders.length === 0) {
        setExportMsg("ไม่พบออเดอร์ในช่วงวันที่นี้");
        return;
      }
      const rows = orders.map((o: any) => ({
        "เลขออเดอร์": o.orderNo,
        "วันที่": new Date(o.createdAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }),
        "ชื่อลูกค้า": o.customerName,
        "ช่องทางขาย": o.platform || "",
        "ชื่อโซเชียล": o.socialMediaName || "",
        "จำนวนชิ้น": o.crispyPorkPiece || "",
        "น้ำหนัก (กก.)": o.crispyPorkWeight || "",
        "โปรโมชั่น": o.promotion || "",
        "ราคาสินค้า": o.price ?? "",
        "วิธีจัดส่ง": o.shippingMethod || "",
        "ค่าส่งเพิ่มเติม": o.additionalShippingCost ?? "",
        "ยอด COD": o.codAmount ?? "",
        "ยืนยันรับ COD แล้ว": o.codConfirmed ? "ใช่" : "ไม่",
        "ตีกลับ": o.isReturned ? "ใช่" : "ไม่",
        "ยอดรับจริง": o.actualReceivedAmount ?? "",
        "สถานะจ่ายเงิน": o.paymentStatus || "",
        "ที่อยู่": o.customerAddress || "",
        "สถานะออเดอร์": o.orderStatus || "",
        "แอดมิน": o.sellerName || "",
        "เลขพัสดุ": o.trackingNumber || "",
        "โน้ต": o.adminNote || "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Orders");
      XLSX.writeFile(wb, `Orders_${exportFrom}_to_${exportTo}.xlsx`);
    } catch (e) {
      setExportMsg("เกิดข้อผิดพลาดขณะ export");
    } finally {
      setIsExporting(false);
    }
  };

  // --- Clear data handler ---
  const fetchAuditLog = async () => {
    setIsLoadingLog(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/audit-log`);
      const data = await res.json();
      setAuditLogs(data.logs || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingLog(false);
    }
  };

  const openLog = () => {
    setIsLogOpen(true);
    fetchAuditLog();
  };

  const handleClearOrders = async () => {
    if (clearMode === "range" && (!clearFrom || !clearTo)) {
      setClearMsg("กรุณาเลือกช่วงวันที่");
      return;
    }
    if (clearConfirmText !== CLEAR_CONFIRM_PHRASE) {
      setClearMsg(`พิมพ์ "${CLEAR_CONFIRM_PHRASE}" ให้ตรงเพื่อยืนยัน`);
      return;
    }
    const finalConfirm = confirm(
      clearMode === "all"
        ? "⚠️ ยืนยันลบออเดอร์ทั้งหมดในระบบ?\n\nการกระทำนี้ย้อนกลับไม่ได้ (ผู้ใช้งานจะไม่ถูกลบ)"
        : `⚠️ ยืนยันลบออเดอร์ช่วง ${clearFrom} ถึง ${clearTo}?\n\nการกระทำนี้ย้อนกลับไม่ได้`
    );
    if (!finalConfirm) return;

    setIsClearing(true);
    setClearMsg("");
    try {
      const res = await fetch(`${BASE_PATH}/api/admin/clear-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: clearMode,
          dateFrom: clearFrom,
          dateTo: clearTo,
          confirmText: clearConfirmText,
          performedBy: currentUser?.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setClearMsg(data.error || "เกิดข้อผิดพลาด");
        return;
      }
      setClearMsg(`✅ ลบออเดอร์ไปแล้ว ${data.deletedCount} รายการ`);
      setClearConfirmText("");
      if (isLogOpen) fetchAuditLog();
    } catch (e) {
      setClearMsg("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsClearing(false);
    }
  };

  // The date pickers in this section are all "วันที่จัดส่ง" (shipping day,
  // same thing Packing's own date picker means) since that's how admins
  // actually think about and refer to an order — "ส่งวันที่ 8" — not the
  // underlying entryDate (always shipping day minus 1) they'd otherwise have
  // to compute by hand every time. Convert at the boundary; the API itself
  // still deals in entryDate, same as every other order endpoint.
  const fetchMoveDateOrders = async (shippingDate: string) => {
    if (!shippingDate) {
      setMoveDateOrders([]);
      return;
    }
    setIsLoadingMoveDateOrders(true);
    setMoveDateSelected(new Set());
    try {
      const res = await fetch(`${BASE_PATH}/api/orders?entryDate=${previousDayStr(shippingDate)}`);
      const data = await res.json();
      const list = (data.orders || []).slice().sort((a: any, b: any) => (a.orderNo || 0) - (b.orderNo || 0));
      setMoveDateOrders(list);
    } catch (e) {
      setMoveDateOrders([]);
    } finally {
      setIsLoadingMoveDateOrders(false);
    }
  };

  const handleMoveDate = async () => {
    if (moveDateSelected.size === 0) {
      setMoveDateMsg("กรุณาเลือกออเดอร์อย่างน้อย 1 รายการ");
      return;
    }
    if (!moveDateTarget) {
      setMoveDateMsg("กรุณาเลือกวันที่จัดส่งปลายทาง");
      return;
    }
    if (moveDateTarget === moveDateViewDate) {
      setMoveDateMsg("วันที่จัดส่งปลายทางต้องต่างจากวันที่ต้นทาง");
      return;
    }
    if (!confirm(`ยืนยันย้ายออเดอร์ ${moveDateSelected.size} รายการ จากส่งวันที่ ${moveDateViewDate} ไปส่งวันที่ ${moveDateTarget}?`)) return;

    setIsMovingDate(true);
    setMoveDateMsg("");
    try {
      const res = await fetch(`${BASE_PATH}/api/orders/move-date`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: Array.from(moveDateSelected), newEntryDate: previousDayStr(moveDateTarget) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMoveDateMsg(data.error || "เกิดข้อผิดพลาด");
        return;
      }
      setMoveDateMsg(`✅ ย้ายไปส่งวันที่ ${moveDateTarget} แล้ว เป็นเลข #${data.destRange[0]}-${data.destRange[1]}`);
      await fetchMoveDateOrders(moveDateViewDate);
      if (isLogOpen) fetchAuditLog();
    } catch (e) {
      setMoveDateMsg("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsMovingDate(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Super Admin Setting</h1>
        <p className={styles.subtitle}>จัดการผู้ใช้งาน ตั้งค่าระบบ และเครื่องมือสำหรับ Super Admin</p>
      </div>

      {/* ===== User management ===== */}
      <SectionCard title="👤 จัดการ User">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
          <button
            className={styles.button}
            style={{ marginTop: 0, padding: "12px 20px" }}
            onClick={() => { setIsAddOpen(true); setErrorMsg(""); }}
          >
            ➕ เพิ่ม User ใหม่
          </button>
        </div>

        <div style={{ border: "1px solid var(--border-color)", borderRadius: "10px", overflow: "hidden" }}>
          {visibleUsers.map((u) => (
            <div
              key={u.id}
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              {editingId === u.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                    <div style={{ fontSize: "22px" }}>{ROLE_ICONS[editRole]}</div>
                    <input
                      className={styles.input}
                      style={{ flex: "1 1 200px", padding: "8px 12px", fontSize: "14px" }}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="ชื่อ"
                    />
                    <input
                      className={styles.input}
                      style={{ flex: "1 1 160px", padding: "8px 12px", fontSize: "14px" }}
                      value={editNickname}
                      onChange={(e) => setEditNickname(e.target.value)}
                      placeholder="ชื่อเล่น (แสดงในใบเบิกหมู)"
                    />
                    <select
                      className={styles.input}
                      style={{ padding: "8px 12px", fontSize: "14px" }}
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                    >
                      <option value="SUPER_ADMIN">Super Admin</option>
                      <option value="ADMIN">แอดมิน</option>
                      <option value="PACKING">แพ็คของ</option>
                      <option value="STOREFRONT">หน้าร้าน</option>
                      <option value="HR">HR (ดูได้แค่ Dashboard)</option>
                    </select>
                    {editRole !== "STOREFRONT" && editRole !== "SUPER_ADMIN" && (
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--text-secondary)" }}>
                        <input
                          type="checkbox"
                          checked={editCanAccessStorefront}
                          onChange={(e) => setEditCanAccessStorefront(e.target.checked)}
                        />
                        ให้สิทธิ์เข้า Store Front เพิ่มเติม
                      </label>
                    )}
                    <select
                      className={styles.input}
                      style={{ padding: "8px 12px", fontSize: "14px" }}
                      value={editDefaultPlatform}
                      onChange={(e) => setEditDefaultPlatform(e.target.value)}
                      title="ช่องทางการขายเริ่มต้น — จะถูกเลือกไว้ให้อัตโนมัติทุกครั้งที่คนนี้เปิดหน้าลงออเดอร์"
                    >
                      <option value="">ไม่ตั้งค่าช่องทางเริ่มต้น</option>
                      {DEFAULT_PLATFORM_OPTIONS.map((p) => (
                        <option key={p} value={p}>ช่องทางเริ่มต้น: {PLATFORM_LABELS[p]}</option>
                      ))}
                    </select>
                    <div style={{ flex: "1 1 180px" }}>
                      <PasswordField
                        className={styles.input}
                        style={{ padding: "8px 12px", fontSize: "14px" }}
                        value={editPassword}
                        onChange={setEditPassword}
                        placeholder="ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)"
                      />
                    </div>
                    <button
                      onClick={() => saveEdit(u.id)}
                      disabled={isSaving}
                      style={{ background: "var(--accent-green)", color: "#fff", border: "none", borderRadius: "6px", padding: "8px 14px", cursor: "pointer", fontSize: "13px" }}
                    >
                      บันทึก
                    </button>
                    <button
                      onClick={cancelEdit}
                      style={{ background: "rgba(var(--surface-rgb),0.08)", color: "#fff", border: "none", borderRadius: "6px", padding: "8px 14px", cursor: "pointer", fontSize: "13px" }}
                    >
                      ยกเลิก
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                  <div style={{ fontSize: "22px" }}>{ROLE_ICONS[u.role]}</div>
                  <div style={{ flex: "1 1 140px" }}>
                    <div style={{ fontWeight: "bold", fontSize: "15px" }}>
                      {u.name}
                      {u.id === currentUser.id && (
                        <span style={{ marginLeft: "8px", fontSize: "11px", color: "var(--text-secondary)", fontWeight: "normal" }}>(คุณ)</span>
                      )}
                      {!u.hasPassword && (
                        <span style={{ marginLeft: "8px", fontSize: "11px", color: "#ffac33", fontWeight: "normal" }}>⚠️ ยังไม่ได้ตั้งรหัสผ่าน — ล็อกอินไม่ได้</span>
                      )}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      {ROLE_LABELS[u.role] || u.role}
                      {(u as any).canAccessStorefront && u.role !== "STOREFRONT" && u.role !== "SUPER_ADMIN" && " · + สิทธิ์ Store Front"}
                      {(u as any).nickname && ` · ชื่อเล่น: ${(u as any).nickname}`}
                      {(u as any).defaultPlatform && ` · ช่องทางเริ่มต้น: ${PLATFORM_LABELS[(u as any).defaultPlatform] || (u as any).defaultPlatform}`}
                      {u.role !== "SUPER_ADMIN" && u.racks && u.racks.length > 0 && ` · ชิ้นหมู ${u.racks.length} รายการ`}
                    </div>
                  </div>
                  <button
                    onClick={() => startEdit(u)}
                    style={{ background: "rgba(var(--surface-rgb),0.08)", color: "#fff", border: "none", borderRadius: "6px", padding: "8px 14px", cursor: "pointer", fontSize: "13px" }}
                  >
                    ✏️ แก้ไข
                  </button>
                  {isRealDev && u.hasPassword && (
                    <button
                      onClick={() => handleKick(u)}
                      title="บังคับออกจากระบบทุกอุปกรณ์ที่ล็อกอินอยู่"
                      style={{ background: "rgba(255,172,51,0.15)", color: "#ffac33", border: "1px solid rgba(255,172,51,0.3)", borderRadius: "6px", padding: "8px 14px", cursor: "pointer", fontSize: "13px" }}
                    >
                      🥾 เตะออก
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(u)}
                    style={{ background: "rgba(255,107,107,0.15)", color: "#ff6b6b", border: "1px solid rgba(255,107,107,0.3)", borderRadius: "6px", padding: "8px 14px", cursor: "pointer", fontSize: "13px" }}
                  >
                    🗑️ ลบ
                  </button>
                </div>
              )}
            </div>
          ))}
          {visibleUsers.length === 0 && (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-secondary)" }}>ยังไม่มี user</div>
          )}
        </div>

        {errorMsg && !isAddOpen && (
          <div style={{ color: "#ff6b6b", fontSize: "13px", marginTop: "12px" }}>{errorMsg}</div>
        )}
      </SectionCard>

      {/* ===== System settings ===== */}
      <SectionCard title="⚙️ ตั้งค่าระบบ" subtitle="ค่าพวกนี้ใช้คำนวณค่าคอมมิชชั่นและ COD ทั่วทั้งระบบ แก้ที่นี่แล้วมีผลทันที ไม่ต้องแก้โค้ด">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px", marginBottom: "20px" }}>
          <div className={styles.formGroup}>
            <label className={styles.label}>อัตราค่าคอมมิชชั่น (%)</label>
            <input
              type="number"
              className={styles.input}
              value={Number((settingsForm.commissionRate * 100).toFixed(4))}
              onChange={(e) => setSettingsForm((prev) => ({ ...prev, commissionRate: (Number(e.target.value) || 0) / 100 }))}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label}>ค่าปรับออเดอร์ตีกลับ (บาท)</label>
            <input
              type="number"
              className={styles.input}
              value={settingsForm.returnPenalty}
              onChange={(e) => setSettingsForm((prev) => ({ ...prev, returnPenalty: Number(e.target.value) || 0 }))}
            />
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "16px", marginBottom: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
            <div className={styles.formGroup} style={{ maxWidth: "240px" }}>
              <label className={styles.label}>ราคาหมูกรอบ (บาท/กก.)</label>
              <input
                type="number"
                className={styles.input}
                value={settingsForm.porkPricePerKg}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, porkPricePerKg: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className={styles.formGroup} style={{ maxWidth: "240px" }}>
              <label className={styles.label}>ราคาหมูกรอบสันนอก (บาท/กก.)</label>
              <input
                type="number"
                className={styles.input}
                value={settingsForm.porkLoinPricePerKg}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, porkLoinPricePerKg: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className={styles.formGroup} style={{ maxWidth: "240px" }}>
              <label className={styles.label}>ราคาหมูกรอบสะโพก (บาท/กก.)</label>
              <input
                type="number"
                className={styles.input}
                value={settingsForm.porkHipPricePerKg}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, porkHipPricePerKg: Number(e.target.value) || 0 }))}
              />
            </div>
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "16px", marginBottom: "8px" }}>
          <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px" }}>
            สูตรคำนวณค่า COD: ถ้าน้ำหนัก ≤ <strong>{settingsForm.codFlatFeeThreshold}</strong> กก. คิดเหมา <strong>{settingsForm.codFlatFee}</strong> บาท,
            ถ้ามากกว่านั้นคิด (น้ำหนัก ÷ <strong>{settingsForm.codDivisor}</strong>) × <strong>{settingsForm.codMultiplier}</strong> บาท
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
            <div className={styles.formGroup}>
              <label className={styles.label}>น้ำหนักไม่เกิน (กก.) ให้คิดเหมา</label>
              <input
                type="number"
                className={styles.input}
                value={settingsForm.codFlatFeeThreshold}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, codFlatFeeThreshold: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>ค่า COD เหมา (บาท)</label>
              <input
                type="number"
                className={styles.input}
                value={settingsForm.codFlatFee}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, codFlatFee: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>หารด้วย (กก.)</label>
              <input
                type="number"
                className={styles.input}
                value={settingsForm.codDivisor}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, codDivisor: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>คูณด้วย (บาท)</label>
              <input
                type="number"
                className={styles.input}
                value={settingsForm.codMultiplier}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, codMultiplier: Number(e.target.value) || 0 }))}
              />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "16px" }}>
          <button className={styles.button} style={{ marginTop: 0 }} onClick={handleSaveSettings} disabled={isSavingSettings}>
            {isSavingSettings ? "กำลังบันทึก..." : "บันทึกการตั้งค่า"}
          </button>
          {settingsMsg && <span style={{ fontSize: "13px", color: settingsMsg.startsWith("✅") ? "var(--accent-green)" : "#ff6b6b" }}>{settingsMsg}</span>}
        </div>
      </SectionCard>

      {/* ===== Full export ===== */}
      <SectionCard title="📤 Export ข้อมูลเต็มรูปแบบ" subtitle="ดึงออเดอร์ทั้งหมดตามช่วงวันที่เป็นไฟล์ Excel สำหรับส่งบัญชี/ทำรายงาน">
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "end" }}>
          <div className={styles.formGroup}>
            <label className={styles.label}>จากวันที่</label>
            <input type="date" className={styles.input} value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label}>ถึงวันที่</label>
            <input type="date" className={styles.input} value={exportTo} onChange={(e) => setExportTo(e.target.value)} />
          </div>
          <button className={styles.button} style={{ marginTop: 0 }} onClick={handleExportFull} disabled={isExporting}>
            {isExporting ? "กำลังเตรียมไฟล์..." : "📥 ดาวน์โหลด Excel"}
          </button>
        </div>
        {exportMsg && <div style={{ fontSize: "13px", color: "#ff6b6b", marginTop: "12px" }}>{exportMsg}</div>}
      </SectionCard>

      {/* ===== Fix order date ===== */}
      <SectionCard title="🗓️ แก้วันที่จัดส่งออเดอร์" subtitle="ย้ายออเดอร์ที่แอดมินลงผิดวันไปวันที่จัดส่งที่ถูกต้อง — เลขออเดอร์ของทั้งสองวันจะถูกเรียงใหม่ให้ต่อเนื่องอัตโนมัติ">
        <div className={styles.formGroup} style={{ maxWidth: "220px", marginBottom: "16px" }}>
          <label className={styles.label}>ดูออเดอร์ที่จะจัดส่งวันที่</label>
          <input
            type="date"
            className={styles.input}
            value={moveDateViewDate}
            onChange={(e) => {
              setMoveDateViewDate(e.target.value);
              setMoveDateMsg("");
              fetchMoveDateOrders(e.target.value);
            }}
          />
        </div>

        {isLoadingMoveDateOrders ? (
          <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>กำลังโหลด...</div>
        ) : moveDateViewDate && moveDateOrders.length === 0 ? (
          <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>ไม่มีออเดอร์ที่จะจัดส่งวันที่เลือก</div>
        ) : moveDateOrders.length > 0 ? (
          <>
            <div style={{ border: "1px solid var(--border-color)", borderRadius: "8px", maxHeight: "280px", overflowY: "auto", marginBottom: "16px" }}>
              {moveDateOrders.map((o) => (
                <label
                  key={o.id}
                  style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderBottom: "1px solid var(--border-color)", cursor: "pointer", fontSize: "13px" }}
                >
                  <input
                    type="checkbox"
                    checked={moveDateSelected.has(o.id)}
                    onChange={(e) => {
                      const next = new Set(moveDateSelected);
                      if (e.target.checked) next.add(o.id); else next.delete(o.id);
                      setMoveDateSelected(next);
                    }}
                  />
                  <span style={{ fontWeight: "bold", minWidth: "32px" }}>#{o.orderNo}</span>
                  <span style={{ flex: "1 1 160px" }}>{o.customerName}</span>
                  <span style={{ color: "var(--text-secondary)" }}>{o.sellerName || "-"}</span>
                </label>
              ))}
            </div>

            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "end" }}>
              <div className={styles.formGroup} style={{ maxWidth: "220px", marginBottom: 0 }}>
                <label className={styles.label}>ย้ายที่เลือก ({moveDateSelected.size}) ไปจัดส่งวันที่</label>
                <input type="date" className={styles.input} value={moveDateTarget} onChange={(e) => setMoveDateTarget(e.target.value)} />
              </div>
              <button className={styles.button} style={{ marginTop: 0 }} onClick={handleMoveDate} disabled={isMovingDate || moveDateSelected.size === 0}>
                {isMovingDate ? "กำลังย้าย..." : "ย้ายออเดอร์ที่เลือก"}
              </button>
            </div>
          </>
        ) : null}

        {moveDateMsg && <div style={{ fontSize: "13px", color: moveDateMsg.startsWith("✅") ? "var(--accent-green)" : "#ff6b6b", marginTop: "12px" }}>{moveDateMsg}</div>}
      </SectionCard>

      {/* ===== Database tools ===== */}
      <SectionCard title="🗄️ เครื่องมือจัดการฐานข้อมูล" subtitle="ใช้ระวัง — การลบข้อมูลย้อนกลับไม่ได้ ผู้ใช้งานจะไม่ถูกลบไม่ว่าโหมดไหน">
        <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
          <button
            onClick={() => setClearMode("range")}
            style={{
              padding: "8px 16px", borderRadius: "8px", fontSize: "13px", cursor: "pointer",
              border: clearMode === "range" ? "1px solid var(--accent-blue)" : "1px solid var(--border-color)",
              background: clearMode === "range" ? "rgba(88,166,255,0.15)" : "rgba(var(--surface-rgb),0.04)",
              color: "#fff",
            }}
          >
            ลบตามช่วงวันที่
          </button>
          <button
            onClick={() => setClearMode("all")}
            style={{
              padding: "8px 16px", borderRadius: "8px", fontSize: "13px", cursor: "pointer",
              border: clearMode === "all" ? "1px solid #ff6b6b" : "1px solid var(--border-color)",
              background: clearMode === "all" ? "rgba(255,107,107,0.15)" : "rgba(var(--surface-rgb),0.04)",
              color: "#fff",
            }}
          >
            ลบออเดอร์ทั้งหมด
          </button>
        </div>

        {clearMode === "range" && (
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
            <div className={styles.formGroup}>
              <label className={styles.label}>จากวันที่</label>
              <input type="date" className={styles.input} value={clearFrom} onChange={(e) => setClearFrom(e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>ถึงวันที่</label>
              <input type="date" className={styles.input} value={clearTo} onChange={(e) => setClearTo(e.target.value)} />
            </div>
          </div>
        )}
        {clearMode === "all" && (
          <div style={{ fontSize: "13px", color: "#ff6b6b", marginBottom: "16px" }}>
            ⚠️ จะลบออเดอร์ทุกรายการในระบบ และรีเซ็ตเลขออเดอร์รายวันกลับไปเริ่มใหม่
          </div>
        )}

        <div className={styles.formGroup} style={{ marginBottom: "16px", maxWidth: "300px" }}>
          <label className={styles.label}>พิมพ์ "{CLEAR_CONFIRM_PHRASE}" เพื่อยืนยัน</label>
          <input
            className={styles.input}
            value={clearConfirmText}
            onChange={(e) => setClearConfirmText(e.target.value)}
            placeholder={CLEAR_CONFIRM_PHRASE}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
          <button
            onClick={handleClearOrders}
            disabled={isClearing}
            style={{ background: "#ff6b6b", color: "#fff", border: "none", borderRadius: "8px", padding: "12px 20px", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
          >
            {isClearing ? "กำลังลบ..." : "🗑️ ลบข้อมูล"}
          </button>
          {clearMsg && <span style={{ fontSize: "13px", color: clearMsg.startsWith("✅") ? "var(--accent-green)" : "#ff6b6b" }}>{clearMsg}</span>}
        </div>

        <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "16px" }}>
          <button
            onClick={openLog}
            style={{ background: "rgba(var(--surface-rgb),0.08)", color: "#fff", border: "none", borderRadius: "8px", padding: "10px 18px", fontSize: "13px", cursor: "pointer" }}
          >
            📜 ดู Log การแก้ไข/ลบออเดอร์
          </button>
        </div>
      </SectionCard>

      {/* ===== Add user modal ===== */}
      {isAddOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--modal-bg)", padding: "32px", borderRadius: "12px", width: "90%", maxWidth: "420px", border: "1px solid var(--border-color)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, color: "var(--accent-blue)", fontSize: "20px" }}>เพิ่ม User ใหม่</h2>
              <button
                onClick={() => setIsAddOpen(false)}
                style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer", fontSize: "24px" }}
              >✕</button>
            </div>

            <div className={styles.formGroup} style={{ marginBottom: "16px" }}>
              <label className={styles.label}>ชื่อ</label>
              <input
                className={styles.input}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="ชื่อพนักงาน"
                autoFocus
              />
            </div>

            <div className={styles.formGroup} style={{ marginBottom: "16px" }}>
              <label className={styles.label}>ชื่อเล่น (แสดงในใบเบิกหมู)</label>
              <input
                className={styles.input}
                value={newNickname}
                onChange={(e) => setNewNickname(e.target.value)}
                placeholder="ไม่บังคับ — ถ้าไม่ใส่จะใช้ชื่อด้านบนแทน"
              />
            </div>

            <div className={styles.formGroup} style={{ marginBottom: "16px" }}>
              <label className={styles.label}>ตำแหน่ง</label>
              <select
                className={styles.input}
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
              >
                <option value="ADMIN">แอดมิน (รับออเดอร์)</option>
                <option value="SUPER_ADMIN">Super Admin</option>
                <option value="PACKING">แพ็คของ</option>
                <option value="STOREFRONT">หน้าร้าน</option>
                <option value="HR">HR (ดูได้แค่ Dashboard)</option>
              </select>
            </div>

            {newRole !== "STOREFRONT" && newRole !== "SUPER_ADMIN" && (
              <div className={styles.formGroup} style={{ marginBottom: "16px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
                  <input
                    type="checkbox"
                    checked={newCanAccessStorefront}
                    onChange={(e) => setNewCanAccessStorefront(e.target.checked)}
                  />
                  ให้สิทธิ์เข้า Store Front เพิ่มเติม
                </label>
              </div>
            )}

            <div className={styles.formGroup} style={{ marginBottom: "8px" }}>
              <label className={styles.label}>รหัสผ่าน</label>
              <PasswordField
                className={styles.input}
                value={newPassword}
                onChange={setNewPassword}
                placeholder="อย่างน้อย 4 ตัวอักษร"
              />
            </div>

            {errorMsg && (
              <div style={{ color: "#ff6b6b", fontSize: "13px", marginTop: "8px" }}>{errorMsg}</div>
            )}

            <button className={styles.button} style={{ width: "100%" }} onClick={handleAdd} disabled={isSaving}>
              {isSaving ? "กำลังบันทึก..." : "เพิ่ม User"}
            </button>
          </div>
        </div>
      )}

      {/* ===== Audit log modal ===== */}
      {isLogOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--modal-bg)", padding: "32px", borderRadius: "12px", width: "90%", maxWidth: "800px", maxHeight: "85vh", overflowY: "auto", border: "1px solid var(--border-color)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h2 style={{ margin: 0, color: "var(--accent-blue)", fontSize: "20px" }}>📜 Log การแก้ไข/ลบออเดอร์</h2>
              <button
                onClick={() => setIsLogOpen(false)}
                style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer", fontSize: "24px" }}
              >✕</button>
            </div>

            {isLoadingLog ? (
              <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>กำลังโหลด...</div>
            ) : auditLogs.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>ยังไม่มีประวัติ</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {auditLogs.map((log) => (
                  <div key={log.id} style={{ padding: "12px 14px", background: "rgba(var(--surface-rgb),0.04)", borderRadius: "8px", borderLeft: `3px solid ${log.action === "BULK_CLEAR" ? "#ff6b6b" : "var(--accent-blue)"}` }}>
                    <div style={{ fontSize: "13px", marginBottom: "4px" }}>{log.summary}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                      {new Date(log.createdAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}
                      {log.performedBy && ` · โดย ${log.performedBy}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
