"use client";

import { useState, useEffect, useMemo } from "react";
import { useUser } from "../../components/UserProvider";
import { isSuperAdminRole } from "../../lib/roles";
import { BASE_PATH } from "../../lib/basePath";
import styles from "../page.module.css";

interface AuditLogEntry {
  id: string;
  orderId: string | null;
  action: string;
  summary: string;
  performedBy: string | null;
  createdAt: string;
  amount: number | null;
}

const ACTION_LABELS: Record<string, string> = {
  EDIT: "แก้ไข",
  DELETE: "ลบ",
  ORDER_CANCELLED: "ยกเลิกออเดอร์",
  PENDING_STOCK_CANCELLED: "ยกเลิกลูกค้ารอหมู",
  BULK_CLEAR: "ล้างข้อมูล",
};

const ACTION_COLORS: Record<string, string> = {
  EDIT: "var(--accent-blue)",
  DELETE: "var(--danger-color)",
  ORDER_CANCELLED: "var(--danger-color)",
  PENDING_STOCK_CANCELLED: "var(--danger-color)",
  BULK_CLEAR: "var(--danger-color)",
};

const selectStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: "8px",
  background: "rgba(var(--surface-rgb),0.1)",
  border: "1px solid rgba(var(--surface-rgb),0.2)",
  color: "var(--text-primary)",
  fontSize: "14px",
};

export default function AuditLogPage() {
  const { currentUser } = useUser();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("All");
  const [performedByFilter, setPerformedByFilter] = useState("All");

  const authorized = !!currentUser && isSuperAdminRole(currentUser.role);

  useEffect(() => {
    if (!authorized) return;
    (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`${BASE_PATH}/api/audit-log`);
        const data = await res.json();
        setLogs(data.logs || []);
      } catch (e) {
        console.error("Failed to fetch audit log", e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [authorized]);

  const performers = useMemo(
    () => Array.from(new Set(logs.map((l) => l.performedBy).filter((v): v is string => !!v))).sort(),
    [logs]
  );

  const filteredLogs = logs.filter((l) => {
    if (actionFilter !== "All" && l.action !== actionFilter) return false;
    if (performedByFilter !== "All" && l.performedBy !== performedByFilter) return false;
    return true;
  });

  if (!currentUser) return null;

  if (!authorized) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>ไม่มีสิทธิ์เข้าถึง</h1>
          <p className={styles.subtitle}>เฉพาะ Super Admin เท่านั้นที่เข้าหน้านี้ได้</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>ประวัติการทำงาน</h1>
        <p className={styles.subtitle}>ดูว่าใครแก้ไข/ลบออเดอร์อะไรไปเมื่อไหร่ (ล่าสุด 200 รายการ)</p>
      </div>

      <div style={{ display: "flex", gap: "16px", marginBottom: "24px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>ประเภท</label>
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} style={selectStyle}>
            <option value="All" style={{ color: "#000" }}>ทั้งหมด</option>
            {Object.entries(ACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key} style={{ color: "#000" }}>{label}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>คนทำ</label>
          <select value={performedByFilter} onChange={(e) => setPerformedByFilter(e.target.value)} style={selectStyle}>
            <option value="All" style={{ color: "#000" }}>ทั้งหมด</option>
            {performers.map((p) => (
              <option key={p} value={p} style={{ color: "#000" }}>{p}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className={styles.emptyState}>กำลังโหลด...</div>
      ) : filteredLogs.length === 0 ? (
        <div className={styles.emptyState}>ไม่พบประวัติ</div>
      ) : (
        <>
          <div className={styles.desktopOnly} style={{ overflow: "auto", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              <thead>
                <tr style={{ background: "rgba(var(--surface-rgb),0.05)", textAlign: "left" }}>
                  <th style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>เวลา</th>
                  <th style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>ประเภท</th>
                  <th style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>รายละเอียด</th>
                  <th style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>โดย</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.id} style={{ borderTop: "1px solid var(--border-color)" }}>
                    <td style={{ padding: "12px 16px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                      {new Date(log.createdAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ color: ACTION_COLORS[log.action] || "var(--text-primary)", fontWeight: 600 }}>
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--text-primary)" }}>{log.summary}</td>
                    <td style={{ padding: "12px 16px", color: "var(--text-primary)" }}>{log.performedBy || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.mobileCardList}>
            {filteredLogs.map((log) => (
              <div key={log.id} className={styles.mobileCard}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: ACTION_COLORS[log.action] || "var(--text-primary)", fontWeight: 600, fontSize: "13px" }}>
                    {ACTION_LABELS[log.action] || log.action}
                  </span>
                  <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                    {new Date(log.createdAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}
                  </span>
                </div>
                <div style={{ fontSize: "14px" }}>{log.summary}</div>
                {log.performedBy && <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>โดย: {log.performedBy}</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
