"use client";

import { useState, useEffect } from "react";
import { useUser } from "../../components/UserProvider";
import { isSuperAdminRole } from "../../lib/roles";
import { BASE_PATH } from "../../lib/basePath";
import { groupOrdersForPrint, getShippingLabel, PrintableOrder } from "../../lib/porkSlip";
import { nextDayStr, previousDayStr } from "../../lib/packingCutoff";
import { formatMoney, getOrderStatusInfo, DetailSection, DetailRow } from "../../components/OrderDetailShared";
import styles from "../page.module.css";

interface Order extends PrintableOrder {
  id: string;
  customerName: string;
  customerAddress: string | null;
  socialMediaName: string | null;
  orderStatus: string | null;
  paymentStatus: string | null;
  trackingNumber: string | null;
  transferSlip: string | null;
  adminNote: string | null;
  price: number | null;
  actualReceivedAmount: number | null;
  codConfirmed: boolean;
  entryDate: string;
  crispyPorkWeight: string | null;
  crispyPorkPiece: string | null;
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
  // selectedDate means "วันที่จะจัดส่ง" (shipping date), same framing
  // Packing/Order Details use — defaults to tomorrow (today's entries ship
  // tomorrow), and gets converted to the underlying entryDate at the fetch
  // boundary via previousDayStr, same conversion those pages do.
  const [selectedDate, setSelectedDate] = useState(() => nextDayStr(todayStr()));
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  // When searching, results come from a separate all-dates fetch instead of
  // filtering `orders` (which is scoped to selectedDate) — null means "not
  // searching, show the selected date's orders instead".
  const [searchResults, setSearchResults] = useState<Order[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Clicking a customer's name looks up their order history across every
  // date (not just the one selected above) — a separate fetch, not a
  // client-side filter of `orders`, since that's scoped to selectedDate only.
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [customerHistory, setCustomerHistory] = useState<Order[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  // Clicking one order in that history opens its full detail — same
  // information the order-entry page's own detail view shows, minus which
  // rack pieces were used (not HR's concern), plus a basic edit form.
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null);
  const [isEditingViewOrder, setIsEditingViewOrder] = useState(false);
  const [editViewOrderData, setEditViewOrderData] = useState<any>(null);
  const [isSavingViewOrder, setIsSavingViewOrder] = useState(false);

  const canAccess = !!currentUser && (isSuperAdminRole(currentUser.role) || currentUser.role === "HR");

  useEffect(() => {
    if (!canAccess) return;
    setIsLoading(true);
    fetch(`${BASE_PATH}/api/orders?entryDate=${previousDayStr(selectedDate)}`)
      .then((res) => res.json())
      .then((data) => setOrders(data.orders || []))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [selectedDate, canAccess]);

  // Debounced — searching goes to the server (every date, not just
  // selectedDate), so this shouldn't fire on every keystroke.
  useEffect(() => {
    if (!canAccess) return;
    const term = customerSearch.trim();
    if (!term) {
      setSearchResults(null);
      return;
    }
    setIsSearching(true);
    const timeout = setTimeout(() => {
      fetch(`${BASE_PATH}/api/orders?customerName=${encodeURIComponent(term)}`)
        .then((res) => res.json())
        .then((data) => setSearchResults(data.orders || []))
        .catch(() => setSearchResults([]))
        .finally(() => setIsSearching(false));
    }, 400);
    return () => clearTimeout(timeout);
  }, [customerSearch, canAccess]);

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

  const closeViewingOrder = () => {
    setViewingOrder(null);
    setIsEditingViewOrder(false);
    setEditViewOrderData(null);
  };

  const startEditViewOrder = () => {
    setEditViewOrderData({ ...viewingOrder });
    setIsEditingViewOrder(true);
  };

  const saveViewOrderEdit = async () => {
    if (!editViewOrderData) return;
    setIsSavingViewOrder(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/orders/${editViewOrderData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: editViewOrderData.customerName,
          customerAddress: editViewOrderData.customerAddress,
          price: editViewOrderData.price,
          codAmount: editViewOrderData.codAmount,
          crispyPorkWeight: editViewOrderData.crispyPorkWeight,
          crispyPorkPiece: editViewOrderData.crispyPorkPiece,
          trackingNumber: editViewOrderData.trackingNumber,
          paymentStatus: editViewOrderData.paymentStatus,
          adminNote: editViewOrderData.adminNote,
          editedBy: currentUser?.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "บันทึกไม่สำเร็จ");
        return;
      }
      setViewingOrder(data.order);
      setIsEditingViewOrder(false);
      setEditViewOrderData(null);
      // Refresh whatever list is currently on screen so counts/highlights
      // (tracking-missing badges, etc.) stay in sync with the edit.
      setCustomerHistory((prev) => prev.map((o) => (o.id === data.order.id ? { ...o, ...data.order } : o)));
      setOrders((prev) => prev.map((o) => (o.id === data.order.id ? { ...o, ...data.order } : o)));
      if (searchResults) setSearchResults((prev) => (prev ? prev.map((o) => (o.id === data.order.id ? { ...o, ...data.order } : o)) : prev));
    } catch (e) {
      alert("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsSavingViewOrder(false);
    }
  };

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

  const isSearchMode = searchResults !== null;
  const activeOrders = isSearchMode ? searchResults : orders;
  const displayLoading = isSearchMode ? isSearching : isLoading;

  const adminGroups = groupOrdersForPrint<Order>(activeOrders, nicknameByName);
  const totalMissingTracking = activeOrders.filter(isMissingTracking).length;

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto", color: "#fff" }}>
      <div className={styles.header} style={{ textAlign: "left", marginBottom: "24px" }}>
        <h1 className={styles.title} style={{ fontSize: "2rem" }}>HR Manage</h1>
        <p className={styles.subtitle}>ดูสถานะออเดอร์ของแต่ละแอดมิน และออเดอร์ EMS ที่ยังไม่มีเลข Tracking</p>
      </div>

      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center", marginBottom: "24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "12px", color: "var(--text-secondary)" }}>วันที่จะจัดส่ง</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ padding: "10px 16px", borderRadius: "8px", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "white", fontSize: "14px" }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "12px", color: "var(--text-secondary)" }}>ค้นหาชื่อลูกค้า (ทุกวันที่)</label>
          <input
            type="text"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            placeholder="พิมพ์ชื่อลูกค้า..."
            style={{ padding: "10px 16px", borderRadius: "8px", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "white", fontSize: "14px", width: "220px" }}
          />
        </div>
        {isSearchMode && (
          <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            🔍 กำลังค้นหา "{customerSearch.trim()}" จากทุกวันที่ — ไม่ใช่แค่วันที่เลือกไว้
          </div>
        )}
        {totalMissingTracking > 0 && (
          <div style={{ padding: "10px 16px", borderRadius: "8px", background: "rgba(255,107,107,0.15)", border: "1px solid rgba(255,107,107,0.4)", color: "#ff6b6b", fontSize: "14px", fontWeight: "bold" }}>
            ⚠️ EMS ที่ยังไม่มีเลข Tracking: {totalMissingTracking} รายการ
          </div>
        )}
      </div>

      {displayLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "var(--text-secondary)" }}>กำลังโหลด...</div>
      ) : adminGroups.length === 0 ? (
        <div className={styles.emptyState}>{isSearchMode ? "ไม่พบลูกค้าที่ตรงกับคำค้นหา" : "ยังไม่มีออเดอร์ในวันที่เลือก"}</div>
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
                      {isSearchMode && (
                        <span style={{ color: "var(--text-secondary)", fontSize: "12px" }}>📅 ส่ง {nextDayStr(order.entryDate)}</span>
                      )}
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
                    <li key={o.id}>
                      <button
                        onClick={() => setViewingOrder(o)}
                        style={{ width: '100%', textAlign: 'left', background: 'rgba(255,255,255,0.05)', border: 'none', padding: '12px 14px', borderRadius: '8px', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <span style={{ fontWeight: 'bold' }}>ส่ง {nextDayStr(o.entryDate)}</span>
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>#{o.orderNo || '?'}</span>
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                          {o.crispyPorkWeight ? `${o.crispyPorkWeight} กก.` : 'ไม่ระบุน้ำหนัก'} · {getShippingLabel(o)} · {(o.orderStatus && STATUS_LABELS[o.orderStatus]) || 'รอดำเนินการ'}
                        </div>
                        {o.sellerName && (
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>โดย: {nicknameByName[o.sellerName] || o.sellerName}</div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {viewingOrder && (() => {
        const statusInfo = getOrderStatusInfo(viewingOrder.orderStatus || undefined);
        return (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }} onClick={closeViewingOrder}>
            <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '12px', maxWidth: '760px', width: '92%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>ออเดอร์ {viewingOrder.orderNo || '-'}</div>
                  <h3 style={{ fontSize: '1.3rem', marginBottom: '10px' }}>{viewingOrder.customerName}</h3>
                  <span style={{ display: 'inline-block', fontSize: '12px', fontWeight: 'bold', color: statusInfo.color, background: statusInfo.bg, padding: '4px 12px', borderRadius: '999px' }}>
                    {statusInfo.label}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  {!isEditingViewOrder && (
                    <button onClick={startEditViewOrder} style={{ background: 'rgba(255,172,51,0.15)', border: 'none', color: '#ffac33', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', padding: '6px 14px', borderRadius: '8px' }}>
                      ✏️ แก้ไข
                    </button>
                  )}
                  <button onClick={closeViewingOrder} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>✕</button>
                </div>
              </div>

              {isEditingViewOrder && editViewOrderData ? (
                <>
                  <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>ชื่อลูกค้า</label>
                      <input type="text" className={styles.input} value={editViewOrderData.customerName || ''} onChange={(e) => setEditViewOrderData({ ...editViewOrderData, customerName: e.target.value })} />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>ที่อยู่</label>
                      <textarea className={styles.textarea} value={editViewOrderData.customerAddress || ''} onChange={(e) => setEditViewOrderData({ ...editViewOrderData, customerAddress: e.target.value })}></textarea>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                        <label className={styles.label}>ราคาสินค้า (บาท)</label>
                        <input type="number" step="0.01" className={styles.input} value={editViewOrderData.price ?? ''} onChange={(e) => setEditViewOrderData({ ...editViewOrderData, price: e.target.value })} />
                      </div>
                      <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                        <label className={styles.label}>เก็บปลายทาง (บาท)</label>
                        <input type="number" step="0.01" className={styles.input} value={editViewOrderData.codAmount ?? ''} onChange={(e) => setEditViewOrderData({ ...editViewOrderData, codAmount: e.target.value })} />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                        <label className={styles.label}>น้ำหนัก (กก.)</label>
                        <input type="text" className={styles.input} value={editViewOrderData.crispyPorkWeight || ''} onChange={(e) => setEditViewOrderData({ ...editViewOrderData, crispyPorkWeight: e.target.value })} />
                      </div>
                      <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                        <label className={styles.label}>จำนวนชิ้น</label>
                        <input type="text" className={styles.input} value={editViewOrderData.crispyPorkPiece || ''} onChange={(e) => setEditViewOrderData({ ...editViewOrderData, crispyPorkPiece: e.target.value })} />
                      </div>
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>เลขพัสดุ</label>
                      <input type="text" className={styles.input} value={editViewOrderData.trackingNumber || ''} onChange={(e) => setEditViewOrderData({ ...editViewOrderData, trackingNumber: e.target.value })} />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>สถานะการชำระเงิน</label>
                      <select className={styles.input} value={editViewOrderData.paymentStatus || ''} onChange={(e) => setEditViewOrderData({ ...editViewOrderData, paymentStatus: e.target.value })}>
                        <option value="">-- เลือกสถานะ --</option>
                        <option value="Unpaid">ยังไม่จ่ายเงิน</option>
                        <option value="Paid">จ่ายเงินแล้ว</option>
                        <option value="COD">เก็บปลายทาง</option>
                      </select>
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>หมายเหตุแอดมิน</label>
                      <input type="text" className={styles.input} value={editViewOrderData.adminNote || ''} onChange={(e) => setEditViewOrderData({ ...editViewOrderData, adminNote: e.target.value })} />
                    </div>
                  </div>
                  <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'flex-end', gap: '12px', flexShrink: 0 }}>
                    <button onClick={() => { setIsEditingViewOrder(false); setEditViewOrderData(null); }} className={styles.button} style={{ background: 'rgba(255,255,255,0.08)' }}>ยกเลิก</button>
                    <button onClick={saveViewOrderEdit} disabled={isSavingViewOrder} className={styles.button}>
                      {isSavingViewOrder ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ padding: '20px 24px', overflowY: 'auto' }}>
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
                    <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '12px 8px', textAlign: 'center' }}>
                      <div style={{ fontSize: '19px', fontWeight: 'bold', color: '#fff' }}>฿{formatMoney(viewingOrder.price)}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>ราคาสินค้า</div>
                    </div>
                    <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '12px 8px', textAlign: 'center' }}>
                      <div style={{ fontSize: '19px', fontWeight: 'bold', color: '#fff' }}>฿{formatMoney(viewingOrder.codAmount)}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>เก็บปลายทาง</div>
                    </div>
                    <div style={{ flex: 1, background: 'rgba(63,185,80,0.12)', border: '1px solid rgba(63,185,80,0.35)', borderRadius: '10px', padding: '12px 8px', textAlign: 'center' }}>
                      <div style={{ fontSize: '19px', fontWeight: 'bold', color: 'var(--accent-green)' }}>฿{formatMoney(viewingOrder.actualReceivedAmount)}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>ยอดรับจริง</div>
                    </div>
                  </div>

                  {Number(viewingOrder.codAmount) > 0 && (
                    <div style={{ marginBottom: '24px', marginTop: '-12px', fontSize: '13px' }}>
                      {viewingOrder.codConfirmed ? (
                        <span style={{ color: 'var(--accent-green)' }}>✅ ยืนยันรับ COD แล้ว — นับเข้ายอดขายแล้ว</span>
                      ) : (
                        <span style={{ color: '#ffac33' }}>🔒 รอยืนยันรับ COD — ยังไม่นับเข้ายอดขาย (Hold ไว้)</span>
                      )}
                    </div>
                  )}

                  <DetailSection title="ข้อมูลลูกค้า">
                    <DetailRow label="ช่องทาง" value={viewingOrder.platform || '-'} />
                    <DetailRow label="ชื่อบัญชี" value={viewingOrder.socialMediaName || '-'} />
                    <DetailRow label="ที่อยู่" value={viewingOrder.customerAddress || '-'} />
                  </DetailSection>

                  <DetailSection title="สินค้า">
                    <DetailRow label="น้ำหนัก" value={`${viewingOrder.crispyPorkWeight || '-'} กก.`} />
                    <DetailRow label="จำนวนชิ้น" value={viewingOrder.crispyPorkPiece || '-'} />
                  </DetailSection>

                  <DetailSection title="การจัดส่ง">
                    <DetailRow
                      label="เลขพัสดุ"
                      value={viewingOrder.trackingNumber ? <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>{viewingOrder.trackingNumber}</span> : '-'}
                    />
                    <DetailRow
                      label="สลิปโอนเงิน"
                      value={viewingOrder.transferSlip ? <a href={viewingOrder.transferSlip} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>ดูสลิป</a> : '-'}
                    />
                  </DetailSection>

                  {viewingOrder.adminNote && (
                    <div style={{ background: 'rgba(255,172,51,0.1)', border: '1px solid #ffac33', padding: '10px 12px', borderRadius: '8px', color: '#ffac33', fontSize: '14px' }}>
                      <span style={{ fontWeight: 'bold' }}>⚠️ หมายเหตุแอดมิน:</span> {viewingOrder.adminNote}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
