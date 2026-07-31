"use client";

import { useState, useEffect } from "react";
import { useUser } from "../../components/UserProvider";
import { isSuperAdminRole } from "../../lib/roles";
import styles from "../page.module.css";

interface Order {
  id: string;
  orderNo: number;
  customerName: string;
  customerAddress: string;
  shippingMethod: string;
  isCod: boolean;
  codAmount: number;
  crispyPorkPiece: string;
  crispyPorkWeight: string;
  adminNote: string;
  orderStatus: string;
  sellerName: string;
  trackingNumber: string;
  createdAt: string;
  price: number;
  additionalShippingCost: number;
  actualReceivedAmount: number;
  rackDetails: string;
}

interface Piece {
  id: string;
  rackNo: string;
  remainingWeight: number;
  isUsedUp?: boolean;
}

function formatMoney(value: unknown): string {
  const num = typeof value === "string" ? parseFloat(value) : (value as number);
  if (num === undefined || num === null || isNaN(num)) return "0";
  return Math.round(num).toLocaleString("th-TH");
}

export default function StorefrontPage() {
  const { currentUser } = useUser();

  const canAccess = !!currentUser && (isSuperAdminRole(currentUser.role) || currentUser.role === "STOREFRONT");
  const isStorefrontRole = currentUser?.role === "STOREFRONT";

  // ===== Sale entry =====
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [selected, setSelected] = useState<Piece[]>([]);
  const [price, setPrice] = useState("");
  const [weightSearch, setWeightSearch] = useState("");
  const [isSubmittingSale, setIsSubmittingSale] = useState(false);
  const [saleMsg, setSaleMsg] = useState("");

  useEffect(() => {
    if (currentUser?.racks) {
      setPieces((currentUser.racks as any[]).filter((r) => !r.isUsedUp));
    }
  }, [currentUser]);

  useEffect(() => {
    setCustomerName(isStorefrontRole ? "ลูกค้าหน้าร้าน" : "");
  }, [isStorefrontRole]);

  const totalWeight = Number(selected.reduce((sum, p) => sum + p.remainingWeight, 0).toFixed(2));

  const togglePiece = (p: Piece) => {
    setSelected((prev) => (prev.some((x) => x.id === p.id) ? prev.filter((x) => x.id !== p.id) : [...prev, p]));
  };

  const handleSubmitSale = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = isStorefrontRole ? "ลูกค้าหน้าร้าน" : customerName.trim();
    if (!isStorefrontRole && !name) {
      setSaleMsg("กรุณาระบุชื่อลูกค้า");
      return;
    }
    if (selected.length === 0) {
      setSaleMsg("กรุณาเลือกชิ้นหมูที่ขายจากคลังหมูของฉัน");
      return;
    }
    const p = Number(price);
    if (!p || p <= 0) {
      setSaleMsg("กรุณาใส่ราคาที่ขายได้");
      return;
    }

    setIsSubmittingSale(true);
    setSaleMsg("");
    try {
      const actualReceivedAmount = Math.round(p * 1.07);
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name,
          platform: "Storefront",
          crispyPorkPiece: String(selected.length),
          crispyPorkWeight: String(totalWeight),
          price: p,
          shippingMethod: "รับหน้าร้าน",
          actualReceivedAmount,
          paymentStatus: "Paid",
          orderStatus: "Completed",
          rackDetails: JSON.stringify(selected.map((s) => ({ assignmentId: s.id, rackNo: s.rackNo, weight: s.remainingWeight }))),
          sellerName: currentUser?.name,
          // Storefront customers are anonymous/repeat by nature (same generic
          // name every time) — the usual same-name-same-weight duplicate
          // check would false-flag almost every sale.
          bypassDuplicateCheck: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setSaleMsg(data.error || "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        return;
      }

      const soldIds = new Set(selected.map((s) => s.id));
      setPieces((prev) => prev.filter((p) => !soldIds.has(p.id)));
      setSelected([]);
      setPrice("");
      setCustomerName(isStorefrontRole ? "ลูกค้าหน้าร้าน" : "");
      setSaleMsg("✅ บันทึกการขายเรียบร้อย");
      setTimeout(() => setSaleMsg(""), 3000);
      fetchOrders();
    } catch (err) {
      console.error(err);
      setSaleMsg("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsSubmittingSale(false);
    }
  };

  // ===== Order history =====
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState("Completed");
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [viewingRacks, setViewingRacks] = useState<Order | null>(null);

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/orders?platform=Storefront");
      const data = await res.json();
      if (res.ok) setOrders(data.orders);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (canAccess) fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  const updateOrderStatus = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderStatus: newStatus, editedBy: currentUser?.name }),
      });
      if (res.ok) {
        setOrders(orders.map((o) => (o.id === id ? { ...o, orderStatus: newStatus } : o)));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;

    try {
      const res = await fetch(`/api/orders/${editingOrder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: editingOrder.customerName,
          customerAddress: editingOrder.customerAddress,
          codAmount: editingOrder.codAmount,
          crispyPorkPiece: editingOrder.crispyPorkPiece,
          crispyPorkWeight: editingOrder.crispyPorkWeight,
          adminNote: editingOrder.adminNote,
          editedBy: currentUser?.name,
        }),
      });

      if (res.ok) {
        setOrders(orders.map((o) => (o.id === editingOrder.id ? editingOrder : o)));
        setEditingOrder(null);
      } else {
        alert("บันทึกไม่สำเร็จ");
      }
    } catch (error) {
      console.error(error);
      alert("เกิดข้อผิดพลาดขณะบันทึก");
    }
  };

  if (!currentUser) return null;

  if (!canAccess) {
    return (
      <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto", color: "#fff" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>ไม่มีสิทธิ์เข้าถึง</h1>
        <p style={{ color: "var(--text-secondary)" }}>เฉพาะ Super Admin และหน้าร้านเท่านั้นที่เข้าหน้านี้ได้</p>
      </div>
    );
  }

  const target = parseFloat(weightSearch);
  const isSearching = weightSearch !== "" && !isNaN(target) && target > 0;
  const displayedPieces = isSearching
    ? [...pieces].map((p) => ({ ...p, diff: Math.abs(p.remainingWeight - target) })).sort((a, b) => a.diff - b.diff)
    : [...pieces].sort((a, b) => b.remainingWeight - a.remainingWeight).map((p) => ({ ...p, diff: null as number | null }));

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto", color: "#fff" }}>
      <div className={styles.header} style={{ textAlign: "left", marginBottom: "24px" }}>
        <h1 className={styles.title} style={{ fontSize: "2rem" }}>ขายหน้าร้าน</h1>
        <p className={styles.subtitle}>บันทึกการขายหน้าร้าน และดูประวัติออเดอร์หน้าร้านทั้งหมด</p>
      </div>

      {/* ===== Sale entry ===== */}
      <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", marginBottom: "32px" }}>
        <form onSubmit={handleSubmitSale} className="glass-panel" style={{ flex: "2 1 380px", padding: "20px 24px", borderRadius: "16px" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "16px" }}>🧾 บันทึกการขาย</h2>

          {isStorefrontRole ? (
            <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
              🏪 ลูกค้าหน้าร้าน (walk-in ไม่ต้องระบุชื่อ)
            </div>
          ) : (
            <div className={styles.formGroup} style={{ marginBottom: "16px" }}>
              <label className={styles.label}>ชื่อลูกค้า</label>
              <input required type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={styles.input} placeholder="ชื่อลูกค้า" />
            </div>
          )}

          <div style={{ background: "rgba(255,255,255,0.05)", padding: "16px", borderRadius: "8px", marginBottom: "16px" }}>
            <label className={styles.label} style={{ display: "block", marginBottom: "8px" }}>หมูที่ขาย</label>
            {selected.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#ff6b6b", margin: 0 }}>⚠️ ยังไม่ได้เลือกชิ้นที่ขาย — เลือกจากรายการ "คลังหมูของฉัน" ด้านขวา</p>
            ) : (
              <>
                <p style={{ fontSize: "20px", fontWeight: "bold", color: "var(--accent-green)", margin: "4px 0 0 0" }}>
                  {totalWeight} กก. ({selected.length} ชิ้น)
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "10px" }}>
                  {selected.map((p) => (
                    <span key={p.id} style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(88,166,255,0.15)", border: "1px solid var(--accent-blue)", borderRadius: "999px", padding: "6px 10px", fontSize: "13px" }}>
                      {p.remainingWeight} กก.
                      <button type="button" onClick={() => togglePiece(p)} style={{ background: "none", border: "none", color: "#ff6b6b", cursor: "pointer", fontWeight: "bold" }}>✕</button>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className={styles.formGroup} style={{ marginBottom: "16px" }}>
            <label className={styles.label}>ราคาที่ขายได้ (บาท)</label>
            <input required type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={styles.input} placeholder="ราคาหมูกรอบ" />
          </div>

          {saleMsg && (
            <div style={{ fontSize: "13px", color: saleMsg.startsWith("✅") ? "var(--accent-green)" : "#ff6b6b", marginBottom: "12px" }}>{saleMsg}</div>
          )}

          <button type="submit" className={styles.button} disabled={isSubmittingSale} style={{ width: "100%", marginTop: 0 }}>
            {isSubmittingSale ? "กำลังบันทึก..." : "บันทึกการขาย"}
          </button>
        </form>

        <div className="glass-panel" style={{ flex: "1 1 280px", padding: "20px 24px", borderRadius: "16px" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "16px" }}>📦 คลังหมูของฉัน</h2>
          <div style={{ marginBottom: "16px", padding: "14px", background: "rgba(255,255,255,0.05)", borderRadius: "8px", display: "flex", justifyContent: "space-around", textAlign: "center" }}>
            <div>
              <div style={{ fontSize: "24px", fontWeight: "bold", color: "var(--accent-blue)" }}>{pieces.length}</div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>ชิ้นคงเหลือ</div>
            </div>
            <div>
              <div style={{ fontSize: "24px", fontWeight: "bold", color: "var(--accent-green)" }}>
                {pieces.reduce((sum, p) => sum + p.remainingWeight, 0).toFixed(2)}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>กก. คงเหลือ</div>
            </div>
          </div>

          <div style={{ marginBottom: "12px" }}>
            <label className={styles.label} style={{ display: "block", marginBottom: "6px", fontSize: "13px" }}>🔍 หาชิ้นใกล้เคียงน้ำหนัก (กก.)</label>
            <input type="number" step="0.01" min="0" value={weightSearch} onChange={(e) => setWeightSearch(e.target.value)} className={styles.input} placeholder="เช่น 1.5" />
          </div>

          {pieces.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", fontSize: "14px", textAlign: "center", padding: "20px 0" }}>ไม่มีชิ้นหมูในคลัง</div>
          ) : (
            <>
              <h3 style={{ fontSize: "14px", marginBottom: "10px", color: "var(--text-secondary)" }}>
                {isSearching ? `ชิ้นที่ใกล้เคียง ${target} กก. มากที่สุด:` : "กดเพื่อเลือกชิ้นที่ขายไป:"}
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "320px", overflowY: "auto", paddingRight: "4px" }}>
                {displayedPieces.map((p) => {
                  const isClose = p.diff !== null && p.diff <= 0.1;
                  const isAdded = selected.some((s) => s.id === p.id);
                  return (
                    <div
                      key={p.id}
                      onClick={() => togglePiece(p)}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "10px 14px", borderRadius: "8px", flexShrink: 0, cursor: "pointer",
                        background: isAdded ? "rgba(88,166,255,0.16)" : isClose ? "rgba(63,185,80,0.12)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${isAdded ? "var(--accent-blue)" : isClose ? "rgba(63,185,80,0.5)" : "rgba(255,255,255,0.08)"}`,
                      }}
                    >
                      <span style={{ fontSize: "14px", color: "#ddd" }}>
                        🐷 หมู 1 ชิ้น
                        {isAdded && <span style={{ marginLeft: "8px", color: "var(--accent-blue)" }}>✓ เลือกแล้ว</span>}
                        {!isAdded && isClose && <span style={{ marginLeft: "8px", color: "var(--accent-green)" }}>✓ ใกล้เคียงมาก</span>}
                      </span>
                      <span style={{ fontSize: "14px", color: "var(--accent-green)", fontWeight: "bold" }}>{p.remainingWeight} กก.</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===== Order history ===== */}
      <h2 style={{ fontSize: "1.1rem", marginBottom: "16px" }}>📋 ประวัติออเดอร์หน้าร้าน</h2>

      <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'flex-end', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>สถานะ</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ padding: '10px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', fontSize: '14px' }}
          >
            <option value="All" style={{ color: '#000' }}>ทั้งหมด</option>
            <option value="Pending" style={{ color: '#000' }}>รอดำเนินการ</option>
            <option value="Packed" style={{ color: '#000' }}>แพ็คแล้ว</option>
            <option value="Shipped" style={{ color: '#000' }}>จัดส่งแล้ว</option>
            <option value="Completed" style={{ color: '#000' }}>เสร็จสิ้น</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>กำลังโหลด...</div>
      ) : (
        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
            <thead style={{ background: 'rgba(255,255,255,0.05)', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
              <tr>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>ลูกค้า</th>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>รายการสินค้า</th>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>สถานะ</th>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {orders.filter(o => !filterStatus || filterStatus === "All" || o.orderStatus === filterStatus || (!o.orderStatus && filterStatus === "Pending")).map(order => (
                <tr key={order.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '16px', verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 'bold' }}>{order.customerName}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', maxWidth: '250px' }}>{order.customerAddress}</div>
                  </td>
                  <td style={{ padding: '16px', verticalAlign: 'top' }}>
                    <div>{order.crispyPorkPiece ? `${order.crispyPorkPiece} ชิ้น` : '-'} / {order.crispyPorkWeight ? `${order.crispyPorkWeight} กก.` : '-'}</div>
                    <div style={{ fontSize: '12px', marginTop: '6px', color: '#a0a0a0', background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px', display: 'inline-block' }}>
                      หมู: ฿{formatMoney(order.price)} | ส่ง: ฿{formatMoney(order.additionalShippingCost)} | COD: {order.codAmount > 0 ? `฿${formatMoney(order.codAmount)}` : '-'} | <strong style={{ color: 'white' }}>รวม: ฿{
                        (() => {
                          const p = Number(order.price) || 0;
                          const s = Number(order.additionalShippingCost) || 0;
                          const c = Number(order.codAmount) || 0;
                          const calculatedTotal = (p + s) * 1.07 + c;

                          const actual = Number(order.actualReceivedAmount) || 0;
                          if (actual > 0 && actual >= (p + s) * 0.5) {
                            return formatMoney(actual);
                          }
                          return formatMoney(calculatedTotal);
                        })()
                      }</strong>
                    </div>
                    {order.adminNote && <div style={{ fontSize: '12px', color: '#ffac33', marginTop: '4px' }}>หมายเหตุ: {order.adminNote}</div>}
                    {order.sellerName && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>โดย: {order.sellerName}</div>}
                  </td>
                  <td style={{ padding: '16px', verticalAlign: 'top' }}>
                    <select
                      value={order.orderStatus || "Pending"}
                      onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '16px',
                        border: 'none',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        background: order.orderStatus === "Completed" ? "rgba(63,185,80,0.2)" :
                                   (order.orderStatus || "Pending") === "Pending" ? "rgba(255,172,51,0.2)" :
                                   order.orderStatus === "Packed" ? "rgba(79,172,254,0.2)" :
                                   "rgba(0,242,254,0.2)",
                        color: order.orderStatus === "Completed" ? "var(--accent-green)" :
                               (order.orderStatus || "Pending") === "Pending" ? "#ffac33" :
                               order.orderStatus === "Packed" ? "#4facfe" :
                               "var(--accent-green)"
                      }}
                    >
                      <option value="Pending" style={{ color: '#000' }}>รอดำเนินการ</option>
                      <option value="Packed" style={{ color: '#000' }}>แพ็คแล้ว</option>
                      <option value="Shipped" style={{ color: '#000' }}>จัดส่งแล้ว</option>
                      <option value="Completed" style={{ color: '#000' }}>เสร็จสิ้น</option>
                    </select>
                  </td>
                  <td style={{ padding: '16px', verticalAlign: 'top' }}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setViewingRacks(order)}
                        style={{ background: 'rgba(79,172,254,0.2)', color: '#4facfe', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                      >
                        👁️ ดูถาด
                      </button>
                      <button
                        onClick={() => setEditingOrder({ ...order })}
                        style={{ background: 'rgba(255,172,51,0.2)', color: '#ffac33', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                      >
                        ✏️ แก้ไข
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {orders.filter(o => !filterStatus || filterStatus === "All" || o.orderStatus === filterStatus || (!o.orderStatus && filterStatus === "Pending")).length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    ไม่พบออเดอร์
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Order Modal */}
      {editingOrder && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ background: '#1a1a1a', width: '100%', maxWidth: '600px', borderRadius: '8px', display: 'flex', flexDirection: 'column', border: '1px solid #333' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>แก้ไขรายละเอียดออเดอร์</h2>
              <button onClick={() => setEditingOrder(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px' }}>✕</button>
            </div>

            <form onSubmit={handleSaveEdit} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>ชื่อลูกค้า</label>
                <input type="text" value={editingOrder.customerName} onChange={e => setEditingOrder({...editingOrder, customerName: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', background: '#0a0a0a', color: 'white' }} required />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>ที่อยู่ลูกค้า (รวมเบอร์โทรและรหัสไปรษณีย์)</label>
                <textarea value={editingOrder.customerAddress} onChange={e => setEditingOrder({...editingOrder, customerAddress: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', background: '#0a0a0a', color: 'white', minHeight: '80px' }} required />
              </div>

              <div className={styles.mobileStackGrid} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>จำนวนชิ้นหมู</label>
                  <input type="text" value={editingOrder.crispyPorkPiece || ''} onChange={e => setEditingOrder({...editingOrder, crispyPorkPiece: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', background: '#0a0a0a', color: 'white' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>น้ำหนักหมู (กก.)</label>
                  <input type="text" value={editingOrder.crispyPorkWeight || ''} onChange={e => setEditingOrder({...editingOrder, crispyPorkWeight: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', background: '#0a0a0a', color: 'white' }} />
                </div>
              </div>

              <div className={styles.mobileStackGrid} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>ยอดเก็บปลายทาง (฿)</label>
                  <input type="number" value={editingOrder.codAmount || 0} onChange={e => setEditingOrder({...editingOrder, codAmount: Number(e.target.value)})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', background: '#0a0a0a', color: 'white' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>หมายเหตุแอดมิน</label>
                  <input type="text" value={editingOrder.adminNote || ''} onChange={e => setEditingOrder({...editingOrder, adminNote: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', background: '#0a0a0a', color: 'white' }} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                <button type="button" onClick={() => setEditingOrder(null)} style={{ padding: '12px 24px', borderRadius: '8px', border: '1px solid #333', background: 'transparent', color: 'white', cursor: 'pointer' }}>ยกเลิก</button>
                <button type="submit" style={{ padding: '12px 24px', borderRadius: '8px', border: 'none', background: 'var(--accent-green)', color: 'black', fontWeight: 'bold', cursor: 'pointer' }}>บันทึกการเปลี่ยนแปลง</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Racks Modal */}
      {viewingRacks && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ background: '#1a1a1a', width: '100%', maxWidth: '400px', borderRadius: '8px', display: 'flex', flexDirection: 'column', border: '1px solid #333' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>ถาดที่ใช้</h2>
              <button onClick={() => setViewingRacks(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px' }}>✕</button>
            </div>

            <div style={{ padding: '24px' }}>
              {(() => {
                if (!viewingRacks.rackDetails) return <div style={{ color: 'var(--text-secondary)' }}>ไม่พบข้อมูลถาด</div>;
                try {
                  const racks = JSON.parse(viewingRacks.rackDetails);
                  if (!Array.isArray(racks) || racks.length === 0) return <div style={{ color: 'var(--text-secondary)' }}>ไม่พบข้อมูลถาด</div>;

                  const aggregatedRacks = racks.reduce((acc: Record<string, string[]>, curr: any) => {
                    const baseRackNo = (curr.rackNo || 'ไม่ทราบถาด').split('-')[0];
                    if (!acc[baseRackNo]) acc[baseRackNo] = [];
                    acc[baseRackNo].push(`${Number(curr.weight).toFixed(2)} กก.`);
                    return acc;
                  }, {});

                  const finalRacks = Object.entries(aggregatedRacks).map(([rackNo, weights]) => ({
                    rackNo,
                    weight: weights.join(' / ')
                  }));

                  return (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {finalRacks.map((r: any, idx: number) => (
                        <li key={idx} style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 'bold', fontSize: '16px' }}>{r.rackNo}</span>
                          <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>{r.weight}</span>
                        </li>
                      ))}
                    </ul>
                  );
                } catch (e) {
                  return <div style={{ color: 'var(--text-secondary)' }}>{viewingRacks.rackDetails}</div>;
                }
              })()}
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid #333', textAlign: 'right' }}>
              <button onClick={() => setViewingRacks(null)} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.1)', color: 'white', cursor: 'pointer' }}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
