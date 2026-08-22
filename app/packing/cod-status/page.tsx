"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "../../../components/UserProvider";
import { isSuperAdminRole } from "../../../lib/roles";
import { BASE_PATH } from "../../../lib/basePath";
import { formatDateDDMMYY_BE } from "../../../lib/thaiDate";
import { formatMoney } from "../../../components/OrderDetailShared";
import styles from "../../page.module.css";

interface Order {
  id: string;
  orderNo: number;
  customerName: string;
  entryDate: string | null;
  codAmount: number | null;
  codConfirmed: boolean;
  actualReceivedAmount: number | null;
  trackingNumber: string | null;
  sellerName: string | null;
}

function todayBangkokStr(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export default function CodStatusPage() {
  const { currentUser } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (currentUser && !isSuperAdminRole(currentUser.role) && currentUser.role !== "PACKING") {
      router.replace("/orders");
    }
  }, [currentUser, router]);

  const [rangeFrom, setRangeFrom] = useState(() => addDays(todayBangkokStr(), -13));
  const [rangeTo, setRangeTo] = useState(() => todayBangkokStr());
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [nicknameByName, setNicknameByName] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch(`${BASE_PATH}/api/users`)
      .then((res) => res.json())
      .then((data) => {
        const map: Record<string, string> = {};
        (data.users || []).forEach((u: any) => {
          if (u.nickname) map[u.name] = u.nickname;
        });
        setNicknameByName(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    setIsLoading(true);
    fetch(`${BASE_PATH}/api/orders?entryDateFrom=${rangeFrom}&entryDateTo=${rangeTo}`)
      .then((res) => res.json())
      .then((data) => setOrders(data.orders || []))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [rangeFrom, rangeTo, currentUser]);

  // Only real COD orders — codAmount 0/null never went through COD at all,
  // so there's nothing to confirm one way or the other. Grouped by entryDate
  // ("วันที่มา" — the day it was logged, same date every other grouping in
  // this app uses), unconfirmed sorted first within each day since that's
  // the actionable half of the list.
  const groupedByDate = useMemo(() => {
    const codOrders = orders.filter((o) => Number(o.codAmount) > 0);
    const byDate = new Map<string, Order[]>();
    codOrders.forEach((o) => {
      const key = o.entryDate || "ไม่ทราบวันที่";
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(o);
    });
    return Array.from(byDate.entries())
      .map(([date, dateOrders]) => ({
        date,
        orders: [...dateOrders].sort((a, b) => Number(a.codConfirmed) - Number(b.codConfirmed) || a.orderNo - b.orderNo),
        confirmedCount: dateOrders.filter((o) => o.codConfirmed).length,
        unconfirmedCount: dateOrders.filter((o) => !o.codConfirmed).length,
        confirmedAmount: dateOrders.reduce((s, o) => (o.codConfirmed ? s + (Number(o.actualReceivedAmount) || 0) : s), 0),
        unconfirmedAmount: dateOrders.reduce((s, o) => (!o.codConfirmed ? s + (Number(o.actualReceivedAmount) || 0) : s), 0),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [orders]);

  const totalUnconfirmed = groupedByDate.reduce((s, g) => s + g.unconfirmedCount, 0);
  const totalUnconfirmedAmount = groupedByDate.reduce((s, g) => s + g.unconfirmedAmount, 0);

  if (!currentUser) return null;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>สถานะยืนยันรับ COD</h1>
        <p className={styles.subtitle}>ออเดอร์ COD แต่ละวัน — ใครยืนยันรับแล้ว ใครยังไม่ยืนยัน</p>
      </div>

      <div className="glass-panel" style={{ padding: "16px 24px", borderRadius: "16px", marginBottom: "20px", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <label className={styles.label} style={{ margin: 0 }}>จากวันที่</label>
        <input type="date" className={styles.input} style={{ maxWidth: "160px" }} value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
        <label className={styles.label} style={{ margin: 0 }}>ถึงวันที่</label>
        <input type="date" className={styles.input} style={{ maxWidth: "160px" }} value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
        {totalUnconfirmed > 0 && (
          <div style={{ marginLeft: "auto", fontSize: "13px", fontWeight: "bold", color: "#ffac33" }}>
            🔒 ยังไม่ยืนยัน {totalUnconfirmed} ออเดอร์ · ฿{formatMoney(totalUnconfirmedAmount)}
          </div>
        )}
      </div>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "var(--text-secondary)" }}>กำลังโหลด...</div>
      ) : groupedByDate.length === 0 ? (
        <div className={styles.emptyState}>ไม่มีออเดอร์ COD ในช่วงวันที่นี้</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {groupedByDate.map((group) => (
            <div key={group.date} className="glass-panel" style={{ padding: "16px 24px", borderRadius: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
                <h3 style={{ fontSize: "15px", margin: 0 }}>
                  📅 {group.date === "ไม่ทราบวันที่" ? group.date : formatDateDDMMYY_BE(group.date)}
                </h3>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                  <span style={{ color: "var(--accent-green)" }}>✅ ยืนยันแล้ว {group.confirmedCount}</span>
                  {" · "}
                  <span style={{ color: group.unconfirmedCount > 0 ? "#ffac33" : "var(--text-secondary)" }}>🔒 ยังไม่ยืนยัน {group.unconfirmedCount}</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {group.orders.map((o) => (
                  <div
                    key={o.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "8px",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      background: o.codConfirmed ? "rgba(63,185,80,0.06)" : "rgba(255,172,51,0.08)",
                      border: o.codConfirmed ? "1px solid rgba(63,185,80,0.15)" : "1px solid rgba(255,172,51,0.25)",
                    }}
                  >
                    <div style={{ fontSize: "13px" }}>
                      <span style={{ color: "var(--text-secondary)" }}>#{o.orderNo || "?"}</span>{" "}
                      <strong>{o.customerName}</strong>
                      {o.trackingNumber && <span style={{ color: "var(--text-secondary)" }}> · {o.trackingNumber}</span>}
                      {o.sellerName && <span style={{ color: "var(--text-secondary)" }}> · {nicknameByName[o.sellerName] || o.sellerName}</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ fontSize: "13px", fontWeight: "bold" }}>฿{formatMoney(o.actualReceivedAmount)}</span>
                      {o.codConfirmed ? (
                        <span style={{ fontSize: "12px", fontWeight: "bold", color: "var(--accent-green)" }}>✅ ยืนยันแล้ว</span>
                      ) : (
                        <span style={{ fontSize: "12px", fontWeight: "bold", color: "#ffac33" }}>🔒 รอยืนยัน</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
