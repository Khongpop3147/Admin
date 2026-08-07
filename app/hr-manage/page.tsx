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
  entryDate: string;
  crispyPorkWeight: string | null;
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
  const [customerSearch, setCustomerSearch] = useState("");

  // Clicking a customer's name looks up their order history across every
  // date (not just the one selected above) — a separate fetch, not a
  // client-side filter of `orders`, since that's scoped to selectedDate only.
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [customerHistory, setCustomerHistory] = useState<Order[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

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

  useEffect(() => {
    if (!selectedCustomer) return;
    setIsHistoryLoading(true);
    fetch(`${BASE_PATH}/api/orders?customerName=${encodeURIComponent(selectedCustomer)}`)
      .then((res) => res.json())
      .then((data) => {
        // The API's customerName filter is a substring match (so it can
        // power the search box above) — narrow to an exact match here so
        // e.g. clicking "ลูกค้า 1" doesn't also pull in "ลูกค้า 10", "ลูกค้า 11"...
        const list: Order[] = (data.orders || []).filter((o: Order) => o.customerName === selectedCustomer);
        list.sort((a, b) => (b.entryDate || "").localeCompare(a.entryDate || ""));
        setCustomerHistory(list);
      })
      .catch(() => {})
      .finally(() => setIsHistoryLoading(false));
  }, [selectedCustomer]);

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

  const filteredOrders = customerSearch.trim()
    ? orders.filter((o) => o.customerName.toLowerCase().includes(customerSearch.trim().toLowerCase()))
    : orders;

  const adminGroups = groupOrdersForPrint<Order>(filteredOrders, nicknameByName);
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
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "12px", color: "var(--text-secondary)" }}>ค้นหาชื่อลูกค้า</label>
          <input
            type="text"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            placeholder="พิมพ์ชื่อลูกค้า..."
            style={{ padding: "10px 16px", borderRadius: "8px", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "white", fontSize: "14px", width: "220px" }}
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
        <div className={styles.emptyState}>{customerSearch.trim() ? "ไม่พบลูกค้าที่ตรงกับคำค้นหา" : "ยังไม่มีออเดอร์ในวันที่เลือก"}</div>
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
                      <button
                        onClick={() => setSelectedCustomer(order.customerName)}
                        style={{ flex: "1 1 160px", textAlign: "left", background: "none", border: "none", padding: 0, color: "var(--accent-blue)", cursor: "pointer", fontSize: "13px", textDecoration: "underline" }}
                      >
                        {order.customerName}
                      </button>
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

      {selectedCustomer && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ background: '#1a1a1a', width: '100%', maxWidth: '500px', maxHeight: '80vh', borderRadius: '8px', display: 'flex', flexDirection: 'column', border: '1px solid #333' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>ประวัติออเดอร์: {selectedCustomer}</h2>
              <button onClick={() => { setSelectedCustomer(null); setCustomerHistory([]); }} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px' }}>✕</button>
            </div>

            <div style={{ padding: '24px', overflowY: 'auto' }}>
              {isHistoryLoading ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>กำลังโหลด...</div>
              ) : customerHistory.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>ไม่พบประวัติออเดอร์</div>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {customerHistory.map((o) => (
                    <li key={o.id} style={{ background: 'rgba(255,255,255,0.05)', padding: '12px 14px', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 'bold' }}>{o.entryDate}</span>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>#{o.orderNo || '?'}</span>
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                        {o.crispyPorkWeight ? `${o.crispyPorkWeight} กก.` : 'ไม่ระบุน้ำหนัก'} · {getShippingLabel(o)} · {(o.orderStatus && STATUS_LABELS[o.orderStatus]) || 'รอดำเนินการ'}
                      </div>
                      {o.sellerName && (
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>โดย: {nicknameByName[o.sellerName] || o.sellerName}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
