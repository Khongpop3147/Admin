"use client";

import { useState, useEffect } from "react";
import { useUser } from "../../components/UserProvider";
import { isSuperAdminRole } from "../../lib/roles";
import { BASE_PATH } from "../../lib/basePath";
import { groupOrdersForPrint, getShippingLabel, PrintableOrder } from "../../lib/porkSlip";
import styles from "../page.module.css";

interface Order extends PrintableOrder {
  id: string;
  customerName: string;
  orderStatus: string | null;
  trackingNumber: string | null;
}

function todayStr(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_LABELS: Record<string, string> = {
  Pending: "รอดำเนินการ",
  Packed: "แพ็คแล้ว",
  Shipped: "จัดส่งแล้ว",
  Completed: "เสร็จสิ้น",
};

// Only EMS orders ever need a tracking number filled in — matches the same
// rule Packing's own post-import warning uses (see bulk-tracking import),
// so this page flags exactly the orders Packing would also flag.
const isMissingTracking = (o: Order) => o.shippingMethod === "EMS" && !o.trackingNumber;

export default function HrManagePage() {
  const { currentUser, users } = useUser();
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const canAccess = !!currentUser && (isSuperAdminRole(currentUser.role) || currentUser.role === "HR");

  useEffect(() => {
    if (!canAccess) return;
    setIsLoading(true);
    fetch(`${BASE_PATH}/api/orders?entryDate=${selectedDate}`)
      .then((res) => res.json())
      .then((data) => setOrders(data.orders || []))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [selectedDate, canAccess]);

  if (!currentUser) return null;

  if (!canAccess) {
    return (
      <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto", color: "#fff" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>ไม่มีสิทธิ์เข้าถึง</h1>
        <p style={{ color: "var(--text-secondary)" }}>เฉพาะ Super Admin และ HR เท่านั้นที่เข้าหน้านี้ได้</p>
      </div>
    );
  }

  const nicknameByName: Record<string, string> = {};
  users.forEach((u) => {
    if (u.nickname) nicknameByName[u.name] = u.nickname;
  });

  const adminGroups = groupOrdersForPrint<Order>(orders, nicknameByName);
  const totalMissingTracking = orders.filter(isMissingTracking).length;

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto", color: "#fff" }}>
      <div className={styles.header} style={{ textAlign: "left", marginBottom: "24px" }}>
        <h1 className={styles.title} style={{ fontSize: "2rem" }}>HR Manage</h1>
        <p className={styles.subtitle}>ดูสถานะออเดอร์ของแต่ละแอดมิน และออเดอร์ EMS ที่ยังไม่มีเลข Tracking</p>
      </div>

      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center", marginBottom: "24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "12px", color: "var(--text-secondary)" }}>วันที่</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ padding: "10px 16px", borderRadius: "8px", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "white", fontSize: "14px" }}
          />
        </div>
        {totalMissingTracking > 0 && (
          <div style={{ padding: "10px 16px", borderRadius: "8px", background: "rgba(255,107,107,0.15)", border: "1px solid rgba(255,107,107,0.4)", color: "#ff6b6b", fontSize: "14px", fontWeight: "bold" }}>
            ⚠️ EMS ที่ยังไม่มีเลข Tracking: {totalMissingTracking} รายการ
          </div>
        )}
      </div>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "var(--text-secondary)" }}>กำลังโหลด...</div>
      ) : adminGroups.length === 0 ? (
        <div className={styles.emptyState}>ยังไม่มีออเดอร์ในวันที่เลือก</div>
      ) : (
        adminGroups.map((group) => {
          const missingInGroup = group.orders.filter(isMissingTracking).length;
          return (
            <div key={group.sellerName} className="glass-panel" style={{ padding: "20px 24px", borderRadius: "16px", marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
                <h3 style={{ fontSize: "16px", margin: 0 }}>{group.displayName}</h3>
                <div style={{ display: "flex", gap: "12px", alignItems: "center", fontSize: "13px", color: "var(--text-secondary)" }}>
                  <span>{group.orders.length} ออเดอร์</span>
                  {missingInGroup > 0 && (
                    <span style={{ color: "#ff6b6b", fontWeight: "bold" }}>⚠️ ไม่มีเลข track {missingInGroup} รายการ</span>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {group.orders.map((order) => {
                  const missing = isMissingTracking(order);
                  return (
                    <div
                      key={order.id}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "6px 16px",
                        alignItems: "center",
                        padding: "10px 14px",
                        borderRadius: "8px",
                        background: missing ? "rgba(255,107,107,0.1)" : "rgba(255,255,255,0.03)",
                        border: missing ? "1px solid rgba(255,107,107,0.3)" : "1px solid transparent",
                        fontSize: "13px",
                      }}
                    >
                      <span style={{ fontWeight: "bold", minWidth: "36px" }}>#{order.orderNo || "?"}</span>
                      <span style={{ flex: "1 1 160px" }}>{order.customerName}</span>
                      <span style={{ color: "var(--text-secondary)" }}>{getShippingLabel(order)}</span>
                      <span style={{ color: "var(--text-secondary)" }}>{(order.orderStatus && STATUS_LABELS[order.orderStatus]) || "รอดำเนินการ"}</span>
                      {missing ? (
                        <span style={{ color: "#ff6b6b", fontWeight: "bold" }}>⚠️ ยังไม่มีเลข track</span>
                      ) : order.trackingNumber ? (
                        <span style={{ color: "var(--accent-green)" }}>track: {order.trackingNumber}</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
