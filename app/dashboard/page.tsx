"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "../../components/UserProvider";
import { useSettings } from "../../components/SettingsProvider";
import { isSuperAdminRole } from "../../lib/roles";
import { BASE_PATH } from "../../lib/basePath";
import { isShelfSale, isCodPending, isExcludedFromRevenue, commissionForOrder } from "../../lib/money";
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

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

function todayStr(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentMonthStr(): string {
  return todayStr().slice(0, 7);
}

// "YYYY-MM" + a delta in months, wrapping the year as needed.
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + delta;
  const newY = Math.floor(total / 12);
  const newM = (total % 12) + 1;
  return `${newY}-${String(newM).padStart(2, "0")}`;
}

function lastDayOfMonthStr(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(lastDay).padStart(2, "0")}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${THAI_MONTHS[m - 1]} ${y}`;
}

const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

// Accepts a "YYYY-MM" trend-point key (used only in yearly/monthly-bar mode).
function monthShortLabel(ym: string): string {
  const [, m] = ym.split("-").map(Number);
  return THAI_MONTHS_SHORT[m - 1];
}

function currentYear(): number {
  return Number(todayStr().slice(0, 4));
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
  labelFn = dayLabel,
}: {
  data: TrendPoint[];
  color: string;
  formatValue: (n: number) => string;
  labelFn?: (key: string) => string;
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
  // With ~30 daily bars the x-axis labels overlap into unreadable mush —
  // thin them out to roughly 8 evenly-spaced labels regardless of period.
  const labelEvery = Math.max(1, Math.ceil(n / 8));

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
                {barH > 2 && i % labelEvery === 0 ? formatValue(value) : ""}
              </text>
              <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--text-secondary)">
                {i % labelEvery === 0 ? labelFn(d.date) : ""}
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
          <div style={{ color: "var(--text-secondary)" }}>{labelFn(data[hoverIdx].date)}</div>
        </div>
      )}
    </div>
  );
}

// Mobile alternative to TrendBarChart — thin vertical bars packed side by
// side get unreadable on a narrow phone (tiny labels, tiny bars). Stacking
// one full-width horizontal row per period instead keeps the label and
// value legible regardless of how many periods there are.
function TrendListChart({
  data,
  color,
  formatValue,
  labelFn = dayLabel,
}: {
  data: TrendPoint[];
  color: string;
  formatValue: (n: number) => string;
  labelFn?: (key: string) => string;
}) {
  const values = data.map((d) => (d as any).__value as number);
  const max = Math.max(1, ...values);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "360px", overflowY: "auto", paddingRight: "4px" }}>
      {data.map((d) => {
        const value = (d as any).__value as number;
        return (
          <div key={d.date} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "52px", fontSize: "12px", color: "var(--text-secondary)", flexShrink: 0 }}>{labelFn(d.date)}</div>
            <div style={{ flex: 1, background: "rgba(255,255,255,0.05)", borderRadius: "6px", height: "18px" }}>
              <div
                style={{
                  width: `${(value / max) * 100}%`,
                  minWidth: value > 0 ? "4px" : 0,
                  background: color,
                  height: "100%",
                  borderRadius: "6px",
                }}
              />
            </div>
            <div style={{ width: "76px", textAlign: "right", fontSize: "13px", fontWeight: "bold", flexShrink: 0 }}>{formatValue(value)}</div>
          </div>
        );
      })}
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
  // panels — "day" is exactly selectedDate, "7d" trails backward from it,
  // "1m" is a real calendar month (independent of selectedDate) picked via
  // selectedMonth below, and "year" is a real calendar year picked via
  // selectedYear — all reset to a fresh 0 at their boundary instead of
  // rolling.
  const [statsPeriod, setStatsPeriod] = useState<"day" | "7d" | "1m" | "year">("day");
  const [selectedMonth, setSelectedMonth] = useState(() => currentMonthStr());
  const [selectedYear, setSelectedYear] = useState(() => currentYear());
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const [trendMetric, setTrendMetric] = useState<"sales" | "orders">("sales");
  const [isTrendLoading, setIsTrendLoading] = useState(false);

  const isSuperAdmin = isSuperAdminRole(currentUser?.role);

  // The current month is capped at today (no point showing empty future
  // days); any other month — past or, in theory, future — shows in full.
  const monthRange = useMemo(() => {
    const lastDay = lastDayOfMonthStr(selectedMonth);
    const to = selectedMonth === currentMonthStr() && todayStr() < lastDay ? todayStr() : lastDay;
    return { from: `${selectedMonth}-01`, to };
  }, [selectedMonth]);

  // Same idea, one level up: the current year is capped at today.
  const yearRange = useMemo(() => {
    const lastDay = `${selectedYear}-12-31`;
    const to = selectedYear === currentYear() && todayStr() < lastDay ? todayStr() : lastDay;
    return { from: `${selectedYear}-01-01`, to };
  }, [selectedYear]);

  useEffect(() => {
    if (!currentUser) return;

    const fetchOrders = async () => {
      setIsLoading(true);
      try {
        const sellerName = isSuperAdmin ? viewTarget : currentUser.name;
        const range =
          statsPeriod === "day"
            ? `date=${selectedDate}`
            : statsPeriod === "7d"
              ? `dateFrom=${addDays(selectedDate, -6)}&dateTo=${selectedDate}`
              : statsPeriod === "1m"
                ? `dateFrom=${monthRange.from}&dateTo=${monthRange.to}`
                : `dateFrom=${yearRange.from}&dateTo=${yearRange.to}`;
        const url = sellerName
          ? `${BASE_PATH}/api/orders?${range}&sellerName=${encodeURIComponent(sellerName)}`
          : `${BASE_PATH}/api/orders?${range}`;
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
  }, [selectedDate, viewTarget, statsPeriod, currentUser, isSuperAdmin, monthRange, yearRange]);

  useEffect(() => {
    if (!currentUser) return;

    const fetchTrend = async () => {
      setIsTrendLoading(true);
      try {
        const sellerName = isSuperAdmin ? viewTarget : currentUser.name;

        if (statsPeriod === "year") {
          // One bucket per calendar month instead of per day — a full year
          // of daily bars would be unreadable and means 365 separate fetches.
          const months: string[] = [];
          for (let m = `${selectedYear}-01`; m <= yearRange.to.slice(0, 7); m = shiftMonth(m, 1)) months.push(m);
          const results = await Promise.all(
            months.map(async (ym) => {
              const from = `${ym}-01`;
              const to = ym === yearRange.to.slice(0, 7) ? yearRange.to : lastDayOfMonthStr(ym);
              const dateParams = `dateFrom=${from}&dateTo=${to}`;
              const url = sellerName
                ? `${BASE_PATH}/api/orders?${dateParams}&sellerName=${encodeURIComponent(sellerName)}`
                : `${BASE_PATH}/api/orders?${dateParams}`;
              const res = await fetch(url);
              const data = await res.json();
              const monthOrders: Order[] = data.orders || [];
              const sales = monthOrders.reduce((sum, o) => sum + (isShelfSale(o) ? 0 : Number(o.price) || 0), 0);
              return { date: ym, sales, orderCount: monthOrders.length };
            })
          );
          setTrendData(results);
          return;
        }

        let dates: string[];
        if (statsPeriod === "1m") {
          dates = [];
          for (let d = monthRange.from; d <= monthRange.to; d = addDays(d, 1)) dates.push(d);
        } else {
          const trendDays = 7;
          dates = Array.from({ length: trendDays }, (_, i) => addDays(selectedDate, i - (trendDays - 1)));
        }
        const results = await Promise.all(
          dates.map(async (d) => {
            const url = sellerName
              ? `${BASE_PATH}/api/orders?date=${d}&sellerName=${encodeURIComponent(sellerName)}`
              : `${BASE_PATH}/api/orders?date=${d}`;
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
  }, [selectedDate, viewTarget, currentUser, isSuperAdmin, statsPeriod, monthRange, yearRange, selectedYear]);

  const stats = useMemo(() => {
    const orderCount = orders.length;
    const totalWeight = orders.reduce((sum, o) => sum + (parseFloat(o.crispyPorkWeight || "0") || 0), 0);
    const totalSales = orders.reduce((sum, o) => sum + (isExcludedFromRevenue(o) ? 0 : Number(o.price) || 0), 0);
    const totalReceived = orders.reduce((sum, o) => {
      if (isExcludedFromRevenue(o) || isCodPending(o)) return sum;
      return sum + (Number(o.actualReceivedAmount) || 0);
    }, 0);
    // A returned COD order will never get codConfirmed (delivery never
    // completed, so the courier's "collected" report never mentions it) —
    // without the isExcludedFromRevenue check it would sit in "COD held"
    // forever even though that money is never coming in and totalReceived
    // has already (correctly) written it off.
    const isCodHeld = (o: Order) => isCodPending(o) && !isExcludedFromRevenue(o);
    const totalCodHeld = orders.reduce((sum, o) => sum + (isCodHeld(o) ? Number(o.actualReceivedAmount) || 0 : 0), 0);
    const codHeldCount = orders.filter(isCodHeld).length;

    const statusCounts: Record<string, number> = { Pending: 0, Packed: 0, Shipped: 0, Completed: 0 };
    orders.forEach((o) => {
      const key = o.orderStatus && statusCounts[o.orderStatus] !== undefined ? o.orderStatus : "Pending";
      statusCounts[key]++;
    });

    return { orderCount, totalWeight, totalSales, totalReceived, totalCodHeld, codHeldCount, statusCounts };
  }, [orders]);

  const perAdminBreakdown = useMemo(() => {
    if (!isSuperAdmin || viewTarget !== "") return [];
    // Keyed by the real sellerName (what orders actually store), but the
    // `name` field itself is the nickname-if-set display value — nothing
    // downstream of this breakdown looks the key back up by name.
    const map = new Map<string, { name: string; orderCount: number; weight: number; sales: number; commission: number; returnedCount: number }>();
    orders.forEach((o) => {
      const sellerName = o.sellerName || "ไม่ระบุ";
      const displayName = users.find((u) => u.name === sellerName)?.nickname || sellerName;
      if (!map.has(sellerName)) map.set(sellerName, { name: displayName, orderCount: 0, weight: 0, sales: 0, commission: 0, returnedCount: 0 });
      const entry = map.get(sellerName)!;
      entry.orderCount++;
      entry.weight += parseFloat(o.crispyPorkWeight || "0") || 0;
      entry.sales += isExcludedFromRevenue(o) ? 0 : Number(o.price) || 0;
      entry.commission += commissionForOrder(o, settings);
      if (o.isReturned) entry.returnedCount++;
    });
    return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
  }, [orders, isSuperAdmin, viewTarget, settings, users]);

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
        {statsPeriod === "1m" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>เดือน</label>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))}
                aria-label="เดือนก่อนหน้า"
                style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)", border: "none", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", cursor: "pointer" }}
              >
                ◀
              </button>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => e.target.value && setSelectedMonth(e.target.value)}
                className={styles.input}
                style={{ padding: "10px 16px" }}
              />
              <button
                type="button"
                onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))}
                aria-label="เดือนถัดไป"
                style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)", border: "none", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", cursor: "pointer" }}
              >
                ▶
              </button>
            </div>
          </div>
        ) : statsPeriod === "year" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>ปี</label>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => setSelectedYear(selectedYear - 1)}
                aria-label="ปีก่อนหน้า"
                style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)", border: "none", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", cursor: "pointer" }}
              >
                ◀
              </button>
              <input
                type="number"
                value={selectedYear}
                onChange={(e) => e.target.value && setSelectedYear(Number(e.target.value))}
                className={styles.input}
                style={{ padding: "10px 16px", width: "100px", textAlign: "center" }}
              />
              <button
                type="button"
                onClick={() => setSelectedYear(selectedYear + 1)}
                aria-label="ปีถัดไป"
                style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)", border: "none", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", cursor: "pointer" }}
              >
                ▶
              </button>
            </div>
          </div>
        ) : (
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
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>ช่วงเวลา</label>
          <div style={{ display: "flex", gap: "6px" }}>
            {([
              { key: "day", label: "ต่อวัน" },
              { key: "7d", label: "7 วัน" },
              { key: "1m", label: "1 เดือน" },
              { key: "year", label: "รายปี" },
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
              <option value={currentUser.name}>👤 ตัวเอง ({currentUser.nickname || currentUser.name})</option>
              {adminOptions.map((u) => (
                <option key={u.id} value={u.name}>👤 {u.nickname || u.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "var(--text-secondary)" }}>กำลังโหลด...</div>
      ) : (
        <>
          {statsPeriod === "7d" && (
            <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px" }}>
              📅 แสดงข้อมูล {addDays(selectedDate, -6)} ถึง {selectedDate}
            </div>
          )}
          {statsPeriod === "1m" && (
            <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px" }}>
              📅 แสดงข้อมูลเดือน {monthLabel(selectedMonth)} ({monthRange.from} ถึง {monthRange.to})
            </div>
          )}
          {statsPeriod === "year" && (
            <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px" }}>
              📅 แสดงข้อมูลปี {selectedYear} ({yearRange.from} ถึง {yearRange.to})
            </div>
          )}
          <div className={styles.statGrid} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", marginBottom: "24px" }}>
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
              <h3 style={{ fontSize: "15px", color: "var(--text-secondary)", margin: 0 }}>
                แนวโน้ม {statsPeriod === "1m" ? monthLabel(selectedMonth) : statsPeriod === "year" ? `ปี ${selectedYear}` : "7 วันล่าสุด"}
              </h3>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
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
            </div>
            {isTrendLoading && trendData.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>กำลังโหลดกราฟ...</div>
            ) : (
              <div style={{ opacity: isTrendLoading ? 0.5 : 1, transition: "opacity 0.2s ease" }}>
                <div className={styles.desktopOnly}>
                  <TrendBarChart data={trendChartData} color="var(--accent-blue)" formatValue={trendFormatter} labelFn={statsPeriod === "year" ? monthShortLabel : dayLabel} />
                </div>
                <div className={styles.mobileOnly}>
                  <TrendListChart data={trendChartData} color="var(--accent-blue)" formatValue={trendFormatter} labelFn={statsPeriod === "year" ? monthShortLabel : dayLabel} />
                </div>
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
                  {/* Desktop: dense table */}
                  <div className={styles.desktopOnly} style={{ overflowX: "auto" }}>
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

                  {/* Mobile: stacked cards — a 6-column table has no room to
                      breathe on a phone; each admin gets its own card instead. */}
                  <div className={styles.mobileCardList}>
                    {perAdminBreakdown.map((a) => (
                      <div key={a.name} className={styles.mobileCard}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontWeight: "bold" }}>{a.name}</div>
                          <div style={{ color: "var(--accent-green)", fontWeight: "bold", fontSize: "16px" }}>฿{formatMoney(a.sales)}</div>
                        </div>
                        <div style={{ display: "flex", gap: "16px", fontSize: "13px", color: "var(--text-secondary)" }}>
                          <div>{a.orderCount} ออเดอร์</div>
                          <div>{a.weight.toFixed(2)} กก.</div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "8px" }}>
                          <div style={{ color: a.returnedCount > 0 ? "#ff6b6b" : "var(--text-secondary)" }}>
                            ตีกลับ: {a.returnedCount > 0 ? `${a.returnedCount} ออเดอร์` : "-"}
                          </div>
                          <div style={{ color: a.commission < 0 ? "#ff6b6b" : "#ffac33", fontWeight: "bold" }}>
                            ค่าคอม: ฿{formatMoney(a.commission)}
                          </div>
                        </div>
                      </div>
                    ))}
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
              <h3 style={{ fontSize: "15px", marginBottom: "16px", color: "var(--text-secondary)" }}>📦 คลังหมูคงเหลือของ {inventoryTargetUser.nickname || inventoryTargetUser.name}</h3>
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
