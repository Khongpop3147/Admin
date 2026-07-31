"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "../../components/UserProvider";
import { useSettings, AppSettings } from "../../components/SettingsProvider";
import { isSuperAdminRole } from "../../lib/roles";
import styles from "../page.module.css";

interface Order {
  id: string;
  price?: number;
  codAmount?: number;
  codConfirmed?: boolean;
  isReturned?: boolean;
  actualReceivedAmount?: number;
  crispyPorkWeight?: string;
  orderStatus?: string;
  sellerName?: string;
  platform?: string;
  customerName?: string;
}

// A shelf placement ("วางขายหน้าร้าน") is just a stock deduction, not a
// recorded sale yet — future POS integration will backfill real figures.
// Keep it out of every money total so revenue numbers aren't inflated by
// stock that hasn't actually sold.
function isShelfSale(o: Order): boolean {
  return o.platform === "Storefront" && o.customerName === "วางขายหน้าร้าน";
}

// With COD the courier collects cash from the customer and remits it back
// later — the shop hasn't actually received anything until that's confirmed
// (via the Packing page's tracking-number reconciliation). Hold the whole
// order's received amount out of revenue totals until then.
function isCodPending(o: Order): boolean {
  return Number(o.codAmount) > 0 && !o.codConfirmed;
}

// A returned ("ตีกลับ") package means the sale never actually happened — the
// pork stock deduction stands, but no revenue or commission should count.
function isExcludedFromRevenue(o: Order): boolean {
  return isShelfSale(o) || o.isReturned === true;
}

// Commission per order: 0 while a shelf placement or a still-pending COD
// (nothing confirmed sold yet), a flat penalty if returned, otherwise
// commissionRate of the product price. Rate/penalty come from Super Admin
// Setting so policy changes don't require a code change.
function commissionForOrder(o: Order, settings: AppSettings): number {
  if (o.isReturned) return -settings.returnPenalty;
  if (isShelfSale(o) || isCodPending(o)) return 0;
  return (Number(o.price) || 0) * settings.commissionRate;
}

interface TrendPoint {
  date: string;
  sales: number;
  orderCount: number;
}

function formatMoney(value: unknown): string {
  const num = typeof value === "string" ? parseFloat(value) : (value as number);
  if (num === undefined || num === null || isNaN(num)) return "0";
  return Math.round(num).toLocaleString("th-TH");
}

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const days = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
  return `${days[date.getUTCDay()]} ${d}/${m}`;
}

// 4px-rounded top corners, square baseline — bar grows up from y+h.
function roundedTopRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, h, w / 2);
  if (radius <= 0) return `M${x},${y + h} L${x},${y} L${x + w},${y} L${x + w},${y + h} Z`;
  return `M${x},${y + h} L${x},${y + radius} Q${x},${y} ${x + radius},${y} L${x + w - radius},${y} Q${x + w},${y} ${x + w},${y + radius} L${x + w},${y + h} Z`;
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="glass-panel" style={{ padding: "20px", borderRadius: "16px" }}>
      <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "8px" }}>{label}</div>
      <div style={{ fontSize: "26px", fontWeight: "bold", color }}>{value}</div>
    </div>
  );
}

function StatusPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />
      <span style={{ fontSize: "14px", color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontSize: "18px", fontWeight: "bold" }}>{count}</span>
    </div>
  );
}

// Single-series bar chart — no legend needed (title names the one series).
function TrendBarChart({
  data,
  color,
  formatValue,
}: {
  data: TrendPoint[];
  color: string;
  formatValue: (n: number) => string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 640;
  const height = 200;
  const paddingTop = 30;
  const paddingBottom = 26;
  const chartH = height - paddingTop - paddingBottom;
  const values = data.map((d) => (d as any).__value as number);
  const max = Math.max(1, ...values);
  const n = data.length || 1;
  const bandW = width / n;
  const barW = Math.min(28, bandW * 0.5);

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
        <line x1={0} y1={height - paddingBottom} x2={width} y2={height - paddingBottom} stroke="var(--border-color)" strokeWidth={1} />
        {data.map((d, i) => {
          const value = (d as any).__value as number;
          const x = i * bandW + (bandW - barW) / 2;
          const barH = max > 0 ? (value / max) * chartH : 0;
          const y = height - paddingBottom - barH;
          const isHover = hoverIdx === i;
          return (
            <g
              key={d.date}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              onFocus={() => setHoverIdx(i)}
              onBlur={() => setHoverIdx(null)}
              tabIndex={0}
              style={{ cursor: "pointer", outline: "none" }}
            >
              {/* hit target, bigger than the bar itself */}
              <rect x={i * bandW} y={paddingTop} width={bandW} height={chartH} fill="transparent" />
              <path d={roundedTopRectPath(x, y, barW, Math.max(barH, 2), 4)} fill={color} opacity={isHover ? 1 : 0.82} />
              <text x={x + barW / 2} y={y - 8} textAnchor="middle" fontSize="11" fill="var(--text-secondary)">
                {barH > 2 ? formatValue(value) : ""}
              </text>
              <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--text-secondary)">
                {dayLabel(d.date)}
              </text>
            </g>
          );
        })}
      </svg>
      {hoverIdx !== null && (
        <div
          style={{
            position: "absolute",
            left: `${((hoverIdx + 0.5) / n) * 100}%`,
            top: 0,
            transform: "translate(-50%, -100%)",
            background: "#1a1a1a",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "8px 12px",
            fontSize: "12px",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            zIndex: 10,
          }}
        >
          <div style={{ color: "#fff", fontWeight: "bold" }}>{formatValue((data[hoverIdx] as any).__value)}</div>
          <div style={{ color: "var(--text-secondary)" }}>{dayLabel(data[hoverIdx].date)}</div>
        </div>
      )}
    </div>
  );
}

// Horizontal ranked bars — magnitude across admins, one hue, direct labels.
function AdminBarChart({ data, color }: { data: { name: string; sales: number }[]; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.sales));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {data.map((d) => (
        <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "120px",
              fontSize: "13px",
              color: "var(--text-secondary)",
              flexShrink: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={d.name}
          >
            {d.name}
          </div>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.05)", borderRadius: "6px", height: "18px" }}>
            <div
              style={{
                width: `${(d.sales / max) * 100}%`,
                minWidth: d.sales > 0 ? "4px" : 0,
                background: color,
                height: "100%",
                borderRadius: "6px",
              }}
            />
          </div>
          <div style={{ width: "90px", textAlign: "right", fontSize: "13px", fontWeight: "bold", flexShrink: 0 }}>
            ฿{formatMoney(d.sales)}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { currentUser, users } = useUser();
  const { settings } = useSettings();
  const router = useRouter();

  useEffect(() => {
    if (currentUser?.role === "PACKING") {
      router.replace("/packing");
    } else if (currentUser?.role === "STOREFRONT") {
      router.replace("/storefront");
    }
  }, [currentUser, router]);

  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" });
    const d = new Date(today);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  // "" = company-wide (super admin only). Otherwise a seller name.
  const [viewTarget, setViewTarget] = useState("");
  // How wide a window of orders feeds the stat cards / status / per-admin
  // panels — "day" is exactly selectedDate, the other two trail backward
  // from it so picking one date still gives a meaningful range.
  const [statsPeriod, setStatsPeriod] = useState<"day" | "7d" | "1m">("day");
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const [trendMetric, setTrendMetric] = useState<"sales" | "orders">("sales");
  const [isTrendLoading, setIsTrendLoading] = useState(false);

  const isSuperAdmin = isSuperAdminRole(currentUser?.role);

  useEffect(() => {
    if (!currentUser) return;

    const fetchOrders = async () => {
      setIsLoading(true);
      try {
        const sellerName = isSuperAdmin ? viewTarget : currentUser.name;
        const dateParams =
          statsPeriod === "day"
            ? `date=${selectedDate}`
            : `dateFrom=${addDays(selectedDate, statsPeriod === "7d" ? -6 : -29)}&dateTo=${selectedDate}`;
        const url = sellerName
          ? `/api/orders?${dateParams}&sellerName=${encodeURIComponent(sellerName)}`
          : `/api/orders?${dateParams}`;
        const res = await fetch(url);
        const data = await res.json();
        setOrders(data.orders || []);
      } catch (e) {
        console.error("Failed to fetch dashboard orders", e);
      } finally {
        setIsLoading(false);
      }
    };

    fetchOrders();
  }, [selectedDate, viewTarget, statsPeriod, currentUser, isSuperAdmin]);

  useEffect(() => {
    if (!currentUser) return;

    const fetchTrend = async () => {
      setIsTrendLoading(true);
      try {
        const sellerName = isSuperAdmin ? viewTarget : currentUser.name;
        const dates = Array.from({ length: 7 }, (_, i) => addDays(selectedDate, i - 6));
        const results = await Promise.all(
          dates.map(async (d) => {
            const url = sellerName
              ? `/api/orders?date=${d}&sellerName=${encodeURIComponent(sellerName)}`
              : `/api/orders?date=${d}`;
            const res = await fetch(url);
            const data = await res.json();
            const dayOrders: Order[] = data.orders || [];
            const sales = dayOrders.reduce((sum, o) => sum + (isShelfSale(o) ? 0 : Number(o.price) || 0), 0);
            return { date: d, sales, orderCount: dayOrders.length };
          })
        );
        setTrendData(results);
      } catch (e) {
        console.error("Failed to fetch trend data", e);
      } finally {
        setIsTrendLoading(false);
      }
    };

    fetchTrend();
  }, [selectedDate, viewTarget, currentUser, isSuperAdmin]);

  const stats = useMemo(() => {
    const orderCount = orders.length;
    const totalWeight = orders.reduce((sum, o) => sum + (parseFloat(o.crispyPorkWeight || "0") || 0), 0);
    const totalSales = orders.reduce((sum, o) => sum + (isExcludedFromRevenue(o) ? 0 : Number(o.price) || 0), 0);
    const totalReceived = orders.reduce((sum, o) => {
      if (isExcludedFromRevenue(o) || isCodPending(o)) return sum;
      return sum + (Number(o.actualReceivedAmount) || 0);
    }, 0);
    const totalCodHeld = orders.reduce((sum, o) => sum + (isCodPending(o) ? Number(o.actualReceivedAmount) || 0 : 0), 0);
    const codHeldCount = orders.filter(isCodPending).length;

    const statusCounts: Record<string, number> = { Pending: 0, Packed: 0, Shipped: 0, Completed: 0 };
    orders.forEach((o) => {
      const key = o.orderStatus && statusCounts[o.orderStatus] !== undefined ? o.orderStatus : "Pending";
      statusCounts[key]++;
    });

    return { orderCount, totalWeight, totalSales, totalReceived, totalCodHeld, codHeldCount, statusCounts };
  }, [orders]);

  const perAdminBreakdown = useMemo(() => {
    if (!isSuperAdmin || viewTarget !== "") return [];
    const map = new Map<string, { name: string; orderCount: number; weight: number; sales: number; commission: number; returnedCount: number }>();
    orders.forEach((o) => {
      const name = o.sellerName || "ไม่ระบุ";
      if (!map.has(name)) map.set(name, { name, orderCount: 0, weight: 0, sales: 0, commission: 0, returnedCount: 0 });
      const entry = map.get(name)!;
      entry.orderCount++;
      entry.weight += parseFloat(o.crispyPorkWeight || "0") || 0;
      entry.sales += isExcludedFromRevenue(o) ? 0 : Number(o.price) || 0;
      entry.commission += commissionForOrder(o, settings);
      if (o.isReturned) entry.returnedCount++;
    });
    return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
  }, [orders, isSuperAdmin, viewTarget, settings]);

  const inventoryTargetUser = useMemo(() => {
    if (!isSuperAdmin) return currentUser;
    if (viewTarget === "") return null;
    return users.find((u) => u.name === viewTarget) || null;
  }, [isSuperAdmin, viewTarget, users, currentUser]);

  const companyInventoryTotals = useMemo(() => {
    if (!isSuperAdmin || viewTarget !== "") return null;
    let adminPieces = 0;
    let adminWeight = 0;
    users.forEach((u) => {
      if (u.role === "CENTRAL_INVENTORY") return;
      (u.racks || []).forEach((r) => {
        if (!r.isUsedUp) {
          adminPieces++;
          adminWeight += r.remainingWeight || 0;
        }
      });
    });

    let centralPieces = 0;
    let centralWeight = 0;
    const centralUser = users.find((u) => u.role === "CENTRAL_INVENTORY");
    (centralUser?.racks || []).forEach((r) => {
      if (!r.isUsedUp) {
        centralPieces++;
        centralWeight += r.remainingWeight || 0;
      }
    });

    return {
      adminPieces,
      adminWeight,
      centralPieces,
      centralWeight,
      totalPieces: adminPieces + centralPieces,
      totalWeight: adminWeight + centralWeight,
    };
  }, [isSuperAdmin, viewTarget, users]);

  if (!currentUser || currentUser.role === "PACKING" || currentUser.role === "STOREFRONT") return null;

  const adminOptions = users.filter((u) => u.role !== "CENTRAL_INVENTORY" && u.role !== "PACKING" && u.id !== currentUser.id);

  const trendChartData = trendData.map((t) => ({ ...t, __value: trendMetric === "sales" ? t.sales : t.orderCount }));
  const trendFormatter = trendMetric === "sales" ? (n: number) => `฿${formatMoney(n)}` : (n: number) => `${n}`;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>แดชบอร์ด</h1>
        <p className={styles.subtitle}>ภาพรวมยอดขายและออเดอร์ประจำวัน</p>
      </div>

      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "28px", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{statsPeriod === "day" ? "วันที่" : "ถึงวันที่"}</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className={styles.input}
            style={{ padding: "10px 16px" }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>ช่วงเวลา</label>
          <div style={{ display: "flex", gap: "6px" }}>
            {([
              { key: "day", label: "ต่อวัน" },
              { key: "7d", label: "7 วัน" },
              { key: "1m", label: "1 เดือน" },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setStatsPeriod(opt.key)}
                style={{
                  background: statsPeriod === opt.key ? "var(--accent-blue)" : "rgba(255,255,255,0.08)",
                  color: statsPeriod === opt.key ? "#fff" : "var(--text-secondary)",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 16px",
                  fontSize: "13px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {isSuperAdmin && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>ดูข้อมูลของ</label>
            <select
              value={viewTarget}
              onChange={(e) => setViewTarget(e.target.value)}
              className={styles.input}
              style={{ padding: "10px 16px", minWidth: "220px" }}
            >
              <option value="">🏢 ทั้งบริษัท</option>
              <option value={currentUser.name}>👤 ตัวเอง ({currentUser.name})</option>
              {adminOptions.map((u) => (
                <option key={u.id} value={u.name}>👤 {u.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "var(--text-secondary)" }}>กำลังโหลด...</div>
      ) : (
        <>
          {statsPeriod !== "day" && (
            <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px" }}>
              📅 แสดงข้อมูล {addDays(selectedDate, statsPeriod === "7d" ? -6 : -29)} ถึง {selectedDate}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", marginBottom: "24px" }}>
            <StatCard label="จำนวนออเดอร์" value={stats.orderCount.toLocaleString("th-TH")} color="#58a6ff" />
            <StatCard label="น้ำหนักหมูที่ขาย" value={`${stats.totalWeight.toFixed(2)} กก.`} color="#3fb950" />
            <StatCard label="ยอดขายสินค้า" value={`฿${formatMoney(stats.totalSales)}`} color="#ffac33" />
            <StatCard label="ยอดรับจริงรวม" value={`฿${formatMoney(stats.totalReceived)}`} color="#3fb950" />
          </div>

          {stats.codHeldCount > 0 && (
            <div className="glass-panel" style={{ padding: "16px 24px", borderRadius: "16px", marginBottom: "24px", border: "1px dashed rgba(255,172,51,0.4)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
                🔒 <strong style={{ color: "#ffac33" }}>ยอด COD ที่ยัง Hold ไว้</strong> — รอยืนยันว่าลูกค้ารับของและจ่ายเงินแล้ว ({stats.codHeldCount} ออเดอร์) ยังไม่นับรวมในยอดรับจริงด้านบน
              </div>
              <div style={{ fontSize: "20px", fontWeight: "bold", color: "#ffac33" }}>฿{formatMoney(stats.totalCodHeld)}</div>
            </div>
          )}

          <div className="glass-panel" style={{ padding: "20px 24px", borderRadius: "16px", marginBottom: "24px" }}>
            <h3 style={{ fontSize: "15px", marginBottom: "16px", color: "var(--text-secondary)" }}>สถานะออเดอร์</h3>
            <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
              <StatusPill label="รอดำเนินการ" count={stats.statusCounts.Pending} color="#ffac33" />
              <StatusPill label="แพ็คแล้ว" count={stats.statusCounts.Packed} color="#4facfe" />
              <StatusPill label="จัดส่งแล้ว" count={stats.statusCounts.Shipped} color="#58a6ff" />
              <StatusPill label="เสร็จสิ้น" count={stats.statusCounts.Completed} color="#3fb950" />
            </div>
          </div>

          <div className="glass-panel" style={{ padding: "20px 24px", borderRadius: "16px", marginBottom: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "15px", color: "var(--text-secondary)", margin: 0 }}>แนวโน้ม 7 วันล่าสุด</h3>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => setTrendMetric("sales")}
                  style={{
                    background: trendMetric === "sales" ? "var(--accent-blue)" : "rgba(255,255,255,0.08)",
                    color: trendMetric === "sales" ? "#fff" : "var(--text-secondary)",
                    border: "none",
                    borderRadius: "999px",
                    padding: "6px 14px",
                    fontSize: "12px",
                    fontWeight: "bold",
                    cursor: "pointer",
                  }}
                >
                  ยอดขาย
                </button>
                <button
                  type="button"
                  onClick={() => setTrendMetric("orders")}
                  style={{
                    background: trendMetric === "orders" ? "var(--accent-blue)" : "rgba(255,255,255,0.08)",
                    color: trendMetric === "orders" ? "#fff" : "var(--text-secondary)",
                    border: "none",
                    borderRadius: "999px",
                    padding: "6px 14px",
                    fontSize: "12px",
                    fontWeight: "bold",
                    cursor: "pointer",
                  }}
                >
                  จำนวนออเดอร์
                </button>
              </div>
            </div>
            {isTrendLoading && trendData.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>กำลังโหลดกราฟ...</div>
            ) : (
              <div style={{ opacity: isTrendLoading ? 0.5 : 1, transition: "opacity 0.2s ease" }}>
                <TrendBarChart data={trendChartData} color="var(--accent-blue)" formatValue={trendFormatter} />
              </div>
            )}
          </div>

          {isSuperAdmin && viewTarget === "" && (
            <div className="glass-panel" style={{ padding: "20px 24px", borderRadius: "16px", marginBottom: "24px" }}>
              <h3 style={{ fontSize: "15px", marginBottom: "16px", color: "var(--text-secondary)" }}>แยกตามแอดมิน</h3>
              {perAdminBreakdown.length === 0 ? (
                <div style={{ color: "var(--text-secondary)", textAlign: "center", padding: "20px 0" }}>ยังไม่มีออเดอร์ในช่วงที่เลือก</div>
              ) : (
                <>
                  <div style={{ marginBottom: "20px" }}>
                    <AdminBarChart data={perAdminBreakdown} color="var(--accent-blue)" />
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                      <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border-color)" }}>
                          <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: "normal" }}>แอดมิน</th>
                          <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: "normal" }}>ออเดอร์</th>
                          <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: "normal" }}>น้ำหนัก (กก.)</th>
                          <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: "normal" }}>ยอดขาย (฿)</th>
                          <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: "normal" }}>ตีกลับ</th>
                          <th style={{ padding: "10px 12px", color: "var(--text-secondary)", fontWeight: "normal" }}>ค่าคอม (฿)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {perAdminBreakdown.map((a) => (
                          <tr key={a.name} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                            <td style={{ padding: "10px 12px", fontWeight: "bold" }}>{a.name}</td>
                            <td style={{ padding: "10px 12px" }}>{a.orderCount}</td>
                            <td style={{ padding: "10px 12px" }}>{a.weight.toFixed(2)}</td>
                            <td style={{ padding: "10px 12px", color: "var(--accent-green)", fontWeight: "bold" }}>฿{formatMoney(a.sales)}</td>
                            <td style={{ padding: "10px 12px", color: a.returnedCount > 0 ? "#ff6b6b" : "var(--text-secondary)" }}>{a.returnedCount > 0 ? `${a.returnedCount} ออเดอร์` : "-"}</td>
                            <td style={{ padding: "10px 12px", color: a.commission < 0 ? "#ff6b6b" : "#ffac33", fontWeight: "bold" }}>฿{formatMoney(a.commission)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {companyInventoryTotals && (
            <div className="glass-panel" style={{ padding: "20px 24px", borderRadius: "16px" }}>
              <h3 style={{ fontSize: "15px", marginBottom: "16px", color: "var(--text-secondary)" }}>📦 คลังหมูคงเหลือรวมทั้งบริษัท (รวมคลังกลาง)</h3>
              <div style={{ display: "flex", gap: "16px", justifyContent: "space-around", textAlign: "center", marginBottom: "20px" }}>
                <div>
                  <div style={{ fontSize: "28px", fontWeight: "bold", color: "var(--accent-blue)" }}>{companyInventoryTotals.totalPieces}</div>
                  <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>ชิ้นคงเหลือ</div>
                </div>
                <div>
                  <div style={{ fontSize: "28px", fontWeight: "bold", color: "var(--accent-green)" }}>{companyInventoryTotals.totalWeight.toFixed(2)}</div>
                  <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>กก. คงเหลือ</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", borderTop: "1px solid var(--border-color)", paddingTop: "16px" }}>
                <div style={{ flex: "1 1 160px", background: "rgba(255,255,255,0.04)", borderRadius: "10px", padding: "12px 16px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>👤 ในมือแอดมิน</div>
                  <div style={{ fontSize: "16px", fontWeight: "bold" }}>{companyInventoryTotals.adminPieces} ชิ้น · {companyInventoryTotals.adminWeight.toFixed(2)} กก.</div>
                </div>
                <div style={{ flex: "1 1 160px", background: "rgba(255,255,255,0.04)", borderRadius: "10px", padding: "12px 16px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>🏭 คลังกลาง</div>
                  <div style={{ fontSize: "16px", fontWeight: "bold" }}>{companyInventoryTotals.centralPieces} ชิ้น · {companyInventoryTotals.centralWeight.toFixed(2)} กก.</div>
                </div>
              </div>
            </div>
          )}

          {inventoryTargetUser && (
            <div className="glass-panel" style={{ padding: "20px 24px", borderRadius: "16px" }}>
              <h3 style={{ fontSize: "15px", marginBottom: "16px", color: "var(--text-secondary)" }}>📦 คลังหมูคงเหลือของ {inventoryTargetUser.name}</h3>
              <div style={{ display: "flex", gap: "16px", justifyContent: "space-around", textAlign: "center" }}>
                <div>
                  <div style={{ fontSize: "28px", fontWeight: "bold", color: "var(--accent-blue)" }}>
                    {inventoryTargetUser.racks?.filter((r) => !r.isUsedUp).length || 0}
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>ชิ้นคงเหลือ</div>
                </div>
                <div>
                  <div style={{ fontSize: "28px", fontWeight: "bold", color: "var(--accent-green)" }}>
                    {(inventoryTargetUser.racks?.reduce((sum, r) => sum + (!r.isUsedUp ? r.remainingWeight || 0 : 0), 0) || 0).toFixed(2)}
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>กก. คงเหลือ</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
