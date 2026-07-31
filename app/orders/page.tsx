"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "../page.module.css";
import { useUser } from "../../components/UserProvider";
import { useSettings, calculateCodAmount, AppSettings } from "../../components/SettingsProvider";
import { isSuperAdminRole } from "../../lib/roles";

interface Order {
  id: string;
  orderNo: number;
  customerName: string;
  platform?: string;
  socialMediaName?: string;
  orderStatus?: string;
  paymentStatus?: string;
  adminNote?: string;
  trackingNumber?: string;
  createdAt: string;
}

interface RackDetail {
  rackNo: string;
  weight: number;
  assignmentId: string;
}

const SHIPPING_RATES_EMS = [
  { w: 2, c: 100 }, { w: 3, c: 110 }, { w: 4, c: 120 }, { w: 5, c: 130 },
  { w: 6, c: 140 }, { w: 7, c: 150 }, { w: 8, c: 160 }, { w: 9, c: 170 },
  { w: 10, c: 180 }, { w: 15, c: 200 }, { w: 20, c: 250 }, { w: 25, c: 300 },
  { w: 30, c: 350 }, { w: 35, c: 400 }, { w: 40, c: 450 }, { w: 45, c: 500 },
  { w: 50, c: 550 }, { w: 75, c: 750 }, { w: 100, c: 1000 }
];

const SHIPPING_RATES_NIM = [
  { w: 2, c: 200 }, { w: 3, c: 220 }, { w: 4, c: 240 }, { w: 5, c: 260 },
  { w: 6, c: 280 }, { w: 7, c: 300 }, { w: 8, c: 320 }, { w: 9, c: 340 },
  { w: 10, c: 360 }, { w: 15, c: 400 }, { w: 20, c: 450 }, { w: 25, c: 500 },
  { w: 30, c: 550 }, { w: 35, c: 600 }, { w: 40, c: 650 }, { w: 45, c: 700 },
  { w: 50, c: 750 }, { w: 75, c: 1000 }, { w: 100, c: 1500 }
];

function calculateShippingCost(method: string, weight: number): number {
  const rates = method === "EMS" ? SHIPPING_RATES_EMS : SHIPPING_RATES_NIM;
  const minCost = rates[0].c;
  const maxCost = rates[rates.length - 1].c;

  if (weight <= 2) return minCost;
  if (weight >= 100) return maxCost;

  for (let i = 0; i < rates.length - 1; i++) {
    if (weight > rates[i].w && weight <= rates[i + 1].w) {
      const w1 = rates[i].w, c1 = rates[i].c;
      const w2 = rates[i + 1].w, c2 = rates[i + 1].c;
      const exactCost = c1 + ((weight - w1) * (c2 - c1) / (w2 - w1));
      return Math.round(exactCost / 10) * 10; // round to nearest 10
    }
  }
  return 0;
}

// Shared by both the weight-input flow and the piece-count flow, so price/COD/
// shipping stay consistent no matter which one drove the allocation.
function computeWeightDerivedFields(
  promotion: string,
  isCod: boolean,
  shippingMethod: string,
  weightStr: string,
  settings: AppSettings
) {
  const updates: { crispyPorkWeight: string; price?: string; codAmount?: string; additionalShippingCost?: string } = {
    crispyPorkWeight: weightStr,
  };
  const parsedWeight = parseFloat(weightStr);
  if (isNaN(parsedWeight) || parsedWeight <= 0) return updates;

  if (promotion === "1 kg 250 บาท") {
    updates.price = (parsedWeight * 250).toFixed(2);
  }
  if (isCod) {
    updates.codAmount = calculateCodAmount(parsedWeight, settings).toFixed(2);
  }
  if (shippingMethod === "EMS" || shippingMethod === "NIM Express") {
    updates.additionalShippingCost = calculateShippingCost(shippingMethod, parsedWeight).toFixed(2);
  }
  return updates;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '10px' }}>{title}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', fontSize: '14px' }}>
      <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: 'right', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

// Simplified inline brand marks for the sales-channel picker — self-contained
// SVGs so there's no dependency on an external icon CDN.
function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path fill="#fff" d="M16.5 12.5h-2.2v7h-3v-7H9.7v-2.6h1.6V8.3c0-1.5.9-2.9 3.2-2.9.9 0 1.6.08 1.8.11v2.3h-1.3c-.7 0-.8.34-.8.83v1.86h2.4l-.1 2.6z" />
    </svg>
  );
}

function LineIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="6" fill="#06C755" />
      <path fill="#fff" d="M19 11.2c0-3.1-3.1-5.7-7-5.7s-7 2.6-7 5.7c0 2.8 2.5 5.1 5.8 5.6.23.05.53.15.6.34.07.17.05.44.02.61l-.1.6c-.03.17-.13.66.58.36s3.8-2.24 5.2-3.83c.95-1.05 1.9-2.1 1.9-3.68z" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="6" fill="#000" />
      <path fill="#fff" d="M15.5 5.5c.4 1.8 1.6 3 3.5 3.2v2.4c-1.2 0-2.3-.4-3.2-1v5.1c0 2.6-2.1 4.8-4.8 4.8-2.6 0-4.8-2.1-4.8-4.8 0-2.6 2.1-4.8 4.8-4.8.3 0 .5 0 .8.07v2.5c-.25-.1-.5-.15-.8-.15-1.3 0-2.3 1-2.3 2.3s1 2.3 2.3 2.3 2.4-1 2.4-2.3V5.5h2.1z" />
    </svg>
  );
}

function ShopeeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="6" fill="#EE4D2D" />
      <path fill="#fff" d="M9.5 9V7.5a2.5 2.5 0 015 0V9h1.5l.8 9.4a1.5 1.5 0 01-1.5 1.6H8.7a1.5 1.5 0 01-1.5-1.6L8 9h1.5zm1.5 0h2V7.5a1 1 0 00-2 0V9z" />
    </svg>
  );
}

function OtherPlatformIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="6" fill="#6b7280" />
      <circle cx="7" cy="12" r="1.5" fill="#fff" />
      <circle cx="12" cy="12" r="1.5" fill="#fff" />
      <circle cx="17" cy="12" r="1.5" fill="#fff" />
    </svg>
  );
}

function formatMoney(value: unknown): string {
  const num = typeof value === "string" ? parseFloat(value) : (value as number);
  if (num === undefined || num === null || isNaN(num)) return "0";
  // ทศนิยมต่ำกว่า .5 ปัดลง, ตั้งแต่ .5 ปัดขึ้น (ปัดเป็นจำนวนเต็ม)
  return Math.round(num).toLocaleString("th-TH");
}

// Renders the Thunder slip-check result — always advisory, never blocks saving.
function SlipVerificationBadge({ result }: { result: any }) {
  if (!result) return null;

  if (!result.success) {
    return (
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#ffac33', background: 'rgba(255,172,51,0.1)', border: '1px solid rgba(255,172,51,0.3)', borderRadius: '6px', padding: '8px 10px' }}>
        ⚠️ เช็คสลิปไม่สำเร็จ: {result.message || "ไม่ทราบสาเหตุ"} (ยังบันทึกออเดอร์ได้ตามปกติ)
      </div>
    );
  }

  if (result.isDuplicate) {
    return (
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#ffac33', background: 'rgba(255,172,51,0.1)', border: '1px solid rgba(255,172,51,0.3)', borderRadius: '6px', padding: '8px 10px' }}>
        ⚠️ สลิปนี้เคยถูกใช้ยืนยันในออเดอร์อื่นมาแล้ว อาจเป็นสลิปซ้ำ กรุณาตรวจสอบ
      </div>
    );
  }

  if (result.amountMatched === false) {
    return (
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#ffac33', background: 'rgba(255,172,51,0.1)', border: '1px solid rgba(255,172,51,0.3)', borderRadius: '6px', padding: '8px 10px' }}>
        ⚠️ ยอดเงินในสลิป (฿{formatMoney(result.slipAmount)}) ไม่ตรงกับยอดที่ต้องได้รับ (฿{formatMoney(result.expectedAmount)}) กรุณาตรวจสอบ
      </div>
    );
  }

  if (result.accountMatched === false) {
    return (
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#ff6b6b', background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)', borderRadius: '6px', padding: '8px 10px' }}>
        ⚠️ ชื่อบัญชีปลายทางไม่ตรง — สลิปนี้โอนไปที่ {result.receiverName || 'บัญชีอื่น'} ({result.receiverBank || 'ไม่ทราบธนาคาร'}) ไม่ใช่บัญชีร้านที่ลงทะเบียนไว้ กรุณาตรวจสอบ
      </div>
    );
  }

  return (
    <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--accent-green)', background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.3)', borderRadius: '6px', padding: '8px 10px' }}>
      ✅ เช็คสลิปผ่าน โอนจาก {result.senderName || 'ไม่ทราบชื่อ'} {result.senderBank ? `(${result.senderBank})` : ''} ยอด ฿{formatMoney(result.slipAmount)}
    </div>
  );
}

// True whenever the Thunder check came back anything other than a clean
// pass — used to force the admin to explain why they're saving anyway.
function hasSlipIssue(result: any): boolean {
  if (!result) return false;
  if (!result.success) return true;
  if (result.isDuplicate) return true;
  if (result.amountMatched === false) return true;
  if (result.accountMatched === false) return true;
  return false;
}

const SLIP_ISSUE_REASONS = [
  "สลิปไม่มี QR โค้ด",
  "รีเฟรชหน้าเว็บซ้ำ ระบบเลยแจ้งว่าสลิปซ้ำ (จริงๆ ไม่ซ้ำ)",
  "ชื่อบัญชีปลายทางไม่ตรง แต่ตรวจสอบแล้วถูกต้อง",
  "ยอดเงินไม่ตรง แต่ตรวจสอบแล้วถูกต้อง",
  "อื่นๆ (ระบุเพิ่มในช่องหมายเหตุ)",
];

function SlipIssueReasonPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginTop: '8px' }}>
      <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: '#ff6b6b', fontWeight: 600 }}>
        ⚠️ สลิปมีปัญหา — เลือกเหตุผลก่อนบันทึกออเดอร์ *
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(255,107,107,0.4)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '13px' }}
      >
        <option value="">-- เลือกเหตุผล --</option>
        {SLIP_ISSUE_REASONS.map((reason) => (
          <option key={reason} value={reason}>{reason}</option>
        ))}
      </select>
    </div>
  );
}

function getOrderStatusInfo(status?: string) {
  switch (status) {
    case "Completed":
      return { label: "เสร็จสิ้น", color: "#3fb950", bg: "rgba(63,185,80,0.15)" };
    case "Shipped":
      return { label: "จัดส่งแล้ว", color: "#58a6ff", bg: "rgba(88,166,255,0.15)" };
    case "Packed":
      return { label: "แพ็คแล้ว", color: "#58a6ff", bg: "rgba(88,166,255,0.15)" };
    case "Pending":
      return { label: "รอดำเนินการ", color: "#ffac33", bg: "rgba(255,172,51,0.15)" };
    default:
      return { label: "รอดำเนินการ", color: "#8b949e", bg: "rgba(139,148,158,0.15)" };
  }
}

export default function Home() {
  const initialForm = {
    customerName: "",
    platform: "",
    socialMediaName: "",
    crispyPorkPiece: "",
    crispyPorkWeight: "",
    packedPork: "",
    promotion: "1 kg 250 บาท",
    price: "",
    shippingMethod: "",
    additionalShippingCost: "",
    isCod: false,
    codAmount: "",
    vatAmount: "",
    actualReceivedAmount: "",
    transferSlip: "",
    paymentStatus: "",
    customerAddress: "",
    orderStatus: "",
    sellerName: "",
    trackingNumber: "",
    adminNote: "",
  };

  const [formData, setFormData] = useState(initialForm);
  const [rackDetails, setRackDetails] = useState<RackDetail[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [showUnpaidOnly, setShowUnpaidOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isStorefrontMode, setIsStorefrontMode] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [slipVerification, setSlipVerification] = useState<any | null>(null);
  const [slipIssueReason, setSlipIssueReason] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [editOrderData, setEditOrderData] = useState<any | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isEditUploading, setIsEditUploading] = useState(false);
  const [editSlipVerification, setEditSlipVerification] = useState<any | null>(null);
  const [editSlipIssueReason, setEditSlipIssueReason] = useState("");
  const [alertData, setAlertData] = useState({
    show: false,
    message: "",
    customerName: "",
  });

  const [filterAdminName, setFilterAdminName] = useState("");
  const [filterDate, setFilterDate] = useState(() => {
    const today = new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" });
    const d = new Date(today);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [customerSearchInput, setCustomerSearchInput] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showInventory, setShowInventory] = useState(false);
  const [insufficientWeight, setInsufficientWeight] = useState(0);
  const [allocationError, setAllocationError] = useState("");
  const [weightSearch, setWeightSearch] = useState("");
  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const [desiredPieceCount, setDesiredPieceCount] = useState("");
  const [pieceSortOrder, setPieceSortOrder] = useState<'asc' | 'desc'>('desc');
  const [allocationMode, setAllocationMode] = useState<'weight' | 'count' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { currentUser, users, fetchUsers } = useUser();
  const { settings } = useSettings();
  const router = useRouter();
  const hasDefaultedFilterAdmin = useRef(false);

  useEffect(() => {
    if (currentUser?.role === "PACKING") {
      router.replace("/packing");
    } else if (currentUser?.role === "STOREFRONT") {
      router.replace("/storefront");
    }
  }, [currentUser, router]);

  // The storefront role only ever rings up walk-in cash sales — lock them
  // into the simplified storefront-mode form instead of the full order form.
  // Mirrors what the (Super-Admin-only) toggle button itself sets on turn-on,
  // since this role never sees that button to trigger it normally.
  useEffect(() => {
    if (currentUser?.role === "STOREFRONT") {
      setIsStorefrontMode(true);
      setFormData(prev => ({
        ...prev,
        customerName: "ลูกค้าหน้าร้าน",
        platform: "Storefront",
        shippingMethod: "รับหน้าร้าน",
        paymentStatus: "Paid",
      }));
    }
  }, [currentUser]);

  // First time the order list loads for a Super Admin, default the filter to
  // their own name so they see their own orders first — they can still switch
  // to "แอดมินทั้งหมด" or another admin afterward, and that choice sticks.
  useEffect(() => {
    if (currentUser && isSuperAdminRole(currentUser.role) && !hasDefaultedFilterAdmin.current) {
      hasDefaultedFilterAdmin.current = true;
      setFilterAdminName(currentUser.name);
    }
  }, [currentUser]);

  // Debounce the search box so typing a name doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setCustomerSearch(customerSearchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [customerSearchInput]);

  useEffect(() => {
    if (currentUser) {
      // A name search looks across all dates — otherwise it'd miss a
      // customer's older orders just because today's date filter is active.
      const dateForFetch = customerSearch ? undefined : filterDate;
      if (isSuperAdminRole(currentUser.role)) {
        fetchOrders(filterAdminName, dateForFetch, customerSearch);
      } else {
        fetchOrders(currentUser.name, dateForFetch, customerSearch);
      }
    }
  }, [filterAdminName, filterDate, customerSearch, currentUser]);

  useEffect(() => {
    if (currentUser) {
      setFormData(prev => ({ ...prev, sellerName: currentUser.name }));
    }
  }, [currentUser]);

  useEffect(() => {
    const p = parseFloat(formData.price) || 0;
    const s = parseFloat(formData.additionalShippingCost) || 0;
    const c = parseFloat(formData.codAmount) || 0;

    if (formData.price !== "" || formData.additionalShippingCost !== "" || formData.codAmount !== "") {
      const vat = (p + s) * 0.07;
      const total = p + s + vat + c;
      // .50 ขึ้นไปปัดขึ้น ต่ำกว่าปัดลง (Math.round already rounds half-up for positive amounts)
      const roundedTotal = Math.round(total);
      setFormData(prev => ({
        ...prev,
        vatAmount: vat.toFixed(2),
        actualReceivedAmount: roundedTotal.toString()
      }));
    } else if (formData.vatAmount !== "") {
      setFormData(prev => ({ ...prev, vatAmount: "" }));
    }
  }, [formData.price, formData.additionalShippingCost, formData.codAmount]);

  useEffect(() => {
    setFormData(prev => {
      const updates: typeof prev = { ...prev, crispyPorkPiece: rackDetails.length.toString() };
      // In count-mode the weight (and anything derived from it) isn't a typed
      // target — it's whatever the currently-selected pieces add up to. Keep it
      // in sync even if the pieces were tweaked by hand afterward (add/remove).
      if (allocationMode === 'count') {
        const totalWeight = Number(rackDetails.reduce((sum, r) => sum + (r.weight || 0), 0).toFixed(2));
        const weightStr = totalWeight > 0 ? String(totalWeight) : "";
        Object.assign(updates, computeWeightDerivedFields(prev.promotion, prev.isCod, prev.shippingMethod, weightStr, settings));
      }
      return updates;
    });
  }, [rackDetails, allocationMode]);

  const fetchOrders = async (adminName?: string, date?: string, customerNameSearch?: string) => {
    try {
      const params = new URLSearchParams();
      if (adminName) params.set("sellerName", adminName);
      if (date) params.set("date", date);
      if (customerNameSearch) params.set("customerName", customerNameSearch);
      const qs = params.toString();
      const url = qs ? `/api/orders?${qs}` : "/api/orders";
      const res = await fetch(url);
      const data = await res.json();
      if (data.orders) {
        setRecentOrders(data.orders);
      }
    } catch (err) {
      console.error("Failed to fetch orders", err);
    }
  };

  const autoAllocateRacks = (targetWeight: number) => {
    if (!currentUser || !currentUser.racks) return;

    // Filter available pieces and sort by creation (FIFO)
    const availableRacks = currentUser.racks
      .filter((r: any) => !r.isUsedUp && r.remainingWeight > 0)
      .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const targetInt = Math.round(targetWeight * 100);
    const racksWithInt = availableRacks.map((r: any) => ({
      ...r,
      intWeight: Math.round(r.remainingWeight * 100)
    }));

    // Suffix sums: the most weight still reachable from index i onward.
    const suffixSum: number[] = new Array(racksWithInt.length + 1).fill(0);
    for (let i = racksWithInt.length - 1; i >= 0; i--) {
      suffixSum[i] = suffixSum[i + 1] + racksWithInt[i].intWeight;
    }

    let bestSubset: any[] | null = null;
    let closestSubset: any[] = [];
    let minDiff = Infinity;
    let closestSum = 0;
    let callBudget = 200000; // hard cap so a large/unreachable inventory can never hang the tab

    const considerCandidate = (subset: any[], sum: number) => {
      if (sum <= 0) return;
      const diff = Math.abs(sum - targetInt);
      if (diff < minDiff) {
        minDiff = diff;
        closestSum = sum;
        closestSubset = subset;
      }
    };

    const findSubset = (index: number, currentSubset: any[], currentSum: number): boolean => {
      if (callBudget-- <= 0) return false;

      if (currentSum > 0) {
        const diff = Math.abs(currentSum - targetInt);
        if (diff === 0) {
          bestSubset = [...currentSubset];
          return true;
        }
        if (diff < minDiff) {
          minDiff = diff;
          closestSum = currentSum;
          closestSubset = [...currentSubset];
        }
      }

      if (index >= racksWithInt.length || currentSum > targetInt + 200) {
        return false;
      }

      // Even taking every remaining piece can't reach the target: the gap only
      // shrinks as the sum grows, so "take everything left" is provably the
      // closest this branch can get — no need to explore its 2^k sub-combinations.
      if (currentSum + suffixSum[index] < targetInt) {
        considerCandidate([...currentSubset, ...racksWithInt.slice(index)], currentSum + suffixSum[index]);
        return false;
      }

      currentSubset.push(racksWithInt[index]);
      if (findSubset(index + 1, currentSubset, currentSum + racksWithInt[index].intWeight)) {
        return true;
      }
      currentSubset.pop();

      if (findSubset(index + 1, currentSubset, currentSum)) {
        return true;
      }

      return false;
    };

    findSubset(0, [], 0);

    if (bestSubset) {
      const newAllocation: RackDetail[] = (bestSubset as any[]).map((rack: any) => ({
        assignmentId: rack.id,
        rackNo: rack.rackNo,
        weight: rack.remainingWeight
      }));
      setRackDetails(newAllocation);
    } else {
      const newAllocation: RackDetail[] = (closestSubset as any[]).map((rack: any) => ({
        assignmentId: rack.id,
        rackNo: rack.rackNo,
        weight: rack.remainingWeight
      }));
      setRackDetails(newAllocation);
    }
  };

  // Alternative to picking by weight: grab the N lightest or N heaviest
  // available pieces instead, then derive weight/price/COD/shipping from
  // whatever that comes out to.
  const autoAllocateRacksByCount = (count: number, order: 'asc' | 'desc') => {
    if (!currentUser || !currentUser.racks) return;

    const availableRacks = [...currentUser.racks]
      .filter((r: any) => !r.isUsedUp && r.remainingWeight > 0)
      .sort((a: any, b: any) => order === 'asc' ? a.remainingWeight - b.remainingWeight : b.remainingWeight - a.remainingWeight);

    const selected = availableRacks.slice(0, count);
    const newAllocation: RackDetail[] = selected.map((rack: any) => ({
      assignmentId: rack.id,
      rackNo: rack.rackNo,
      weight: rack.remainingWeight
    }));
    // Weight/price/COD/shipping derive from this via the rackDetails-sync effect.
    setRackDetails(newAllocation);
  };

  const handlePieceCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDesiredPieceCount(value);

    const count = parseInt(value, 10);
    if (!isNaN(count) && count > 0) {
      setAllocationMode('count');
      autoAllocateRacksByCount(count, pieceSortOrder);
    } else {
      setAllocationMode(null);
      setRackDetails([]);
      setFormData(prev => ({ ...prev, crispyPorkWeight: "" }));
    }
  };

  const handlePieceSortOrderChange = (order: 'asc' | 'desc') => {
    setPieceSortOrder(order);
    const count = parseInt(desiredPieceCount, 10);
    if (!isNaN(count) && count > 0) {
      autoAllocateRacksByCount(count, order);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const target = e.target as HTMLInputElement;
    const name = target.name;
    const value = target.type === 'checkbox' ? target.checked : target.value;

    setFormData(prev => {
      const newData = { ...prev, [name]: value };

      // Auto-calculate price if promotion is "1 kg 250 บาท"
      if (name === "crispyPorkWeight" || name === "promotion") {
        const promo = name === "promotion" ? value : newData.promotion;
        const weightStr = name === "crispyPorkWeight" ? value : newData.crispyPorkWeight;

        if (promo === "1 kg 250 บาท") {
          const parsedWeight = parseFloat(String(weightStr));
          if (!isNaN(parsedWeight) && parsedWeight > 0) {
            newData.price = (parsedWeight * 250).toFixed(2);
          }
        }
      }

      // Auto-calculate COD based on weight and isCod
      if (name === "crispyPorkWeight" || name === "isCod") {
        const weightStr = name === "crispyPorkWeight" ? value : newData.crispyPorkWeight;
        const parsedWeight = parseFloat(weightStr as string);
        const applyCod = name === "isCod" ? value : newData.isCod;

        if (applyCod && !isNaN(parsedWeight) && parsedWeight > 0) {
          newData.codAmount = calculateCodAmount(parsedWeight, settings).toFixed(2);
        } else if (name === "isCod" && !applyCod) {
          newData.codAmount = "";
        }
      }

      // Ticking "เก็บเงินปลายทาง" reflects straight into payment status too —
      // it's neither unpaid nor paid yet, it's specifically COD.
      if (name === "isCod") {
        if (value) {
          newData.paymentStatus = "COD";
        } else if (newData.paymentStatus === "COD") {
          newData.paymentStatus = "";
        }
      }

      // Auto-calculate Shipping Cost for EMS & NIM Express
      if (name === "crispyPorkWeight" || name === "shippingMethod") {
        const weightStr = name === "crispyPorkWeight" ? value : newData.crispyPorkWeight;
        const method = name === "shippingMethod" ? value : newData.shippingMethod;
        const parsedWeight = parseFloat(weightStr as string);

        if ((method === "EMS" || method === "NIM Express") && !isNaN(parsedWeight) && parsedWeight > 0) {
          newData.additionalShippingCost = calculateShippingCost(method, parsedWeight).toFixed(2);
        } else if (name === "shippingMethod" && method !== "EMS" && method !== "NIM Express") {
          newData.additionalShippingCost = "";
        }
      }

      return newData;
    });

    if (name === "crispyPorkWeight") {
      const trimmed = String(value).trim();
      setAllocationMode(trimmed !== "" ? 'weight' : null);
      if (trimmed === "") {
        setDesiredPieceCount("");
      }

      const parsedWeight = parseFloat(trimmed);
      if (!isNaN(parsedWeight) && parsedWeight > 0) {
        autoAllocateRacks(parsedWeight);
      } else {
        setRackDetails([]);
        setInsufficientWeight(0);
        setAllocationError("");
      }
    }
  };

  // Best-effort check via Thunder Solution — never blocks saving the order,
  // just surfaces a warning if the slip looks off so the admin can double-check.
  // NOTE: requires `url` to be publicly reachable (Thunder fetches it
  // themselves) — won't resolve on localhost without a tunnel like ngrok.
  const verifySlip = async (url: string, matchAmount?: number) => {
    try {
      const res = await fetch("/api/verify-slip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, matchAmount }),
      });
      return await res.json();
    } catch (err) {
      console.error("Slip verification failed", err);
      return { success: false, message: "เช็คสลิปไม่สำเร็จ" };
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setSlipVerification(null);
    setSlipIssueReason("");
    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (data.url) {
        setFormData(prev => ({ ...prev, transferSlip: data.url, paymentStatus: "Paid" }));
        // /api/upload returns a path like "/uploads/xxx.jpg" — Thunder needs a
        // full absolute URL, not a bare path.
        const absoluteSlipUrl = data.url.startsWith("http") ? data.url : `${window.location.origin}${data.url}`;
        const expectedAmount = parseFloat(formData.actualReceivedAmount);
        const result = await verifySlip(absoluteSlipUrl, !isNaN(expectedAmount) && expectedAmount > 0 ? expectedAmount : undefined);
        setSlipVerification(result);
      } else {
        alert("อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะอัปโหลดไฟล์");
    } finally {
      setIsUploading(false);
    }
  };

  const handleStartEditOrder = () => {
    setEditOrderData({ ...selectedOrder });
    setIsEditingOrder(true);
    setEditSlipVerification(null);
    setEditSlipIssueReason("");
  };

  const handleCancelEditOrder = () => {
    setIsEditingOrder(false);
    setEditOrderData(null);
    setEditSlipVerification(null);
    setEditSlipIssueReason("");
  };

  const handleCloseOrderDetail = () => {
    setSelectedOrder(null);
    setIsEditingOrder(false);
    setEditOrderData(null);
    setEditSlipVerification(null);
    setEditSlipIssueReason("");
  };

  // Same "uploading a slip means it's paid" rule as the main new-order form —
  // covers the case where a customer sends the slip after the order was
  // already saved as unpaid.
  const handleEditFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsEditUploading(true);
    setEditSlipVerification(null);
    setEditSlipIssueReason("");
    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (data.url) {
        setEditOrderData((prev: any) => ({ ...prev, transferSlip: data.url, paymentStatus: "Paid" }));
        const absoluteSlipUrl = data.url.startsWith("http") ? data.url : `${window.location.origin}${data.url}`;
        const expectedAmount = parseFloat(editOrderData?.actualReceivedAmount);
        const result = await verifySlip(absoluteSlipUrl, !isNaN(expectedAmount) && expectedAmount > 0 ? expectedAmount : undefined);
        setEditSlipVerification(result);
      } else {
        alert("อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะอัปโหลดไฟล์");
    } finally {
      setIsEditUploading(false);
    }
  };

  const handleSaveOrderEdit = async () => {
    if (!editOrderData) return;
    if (hasSlipIssue(editSlipVerification) && !editSlipIssueReason) {
      alert("สลิปมีปัญหา กรุณาเลือกเหตุผลก่อนบันทึกออเดอร์");
      return;
    }
    const slipIssueNote = hasSlipIssue(editSlipVerification) && editSlipIssueReason ? `[หมายเหตุสลิป: ${editSlipIssueReason}]` : "";
    const combinedAdminNote = [editOrderData.adminNote, slipIssueNote].filter(Boolean).join(" ");
    setIsSavingEdit(true);
    try {
      const res = await fetch(`/api/orders/${editOrderData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: editOrderData.customerName,
          customerAddress: editOrderData.customerAddress,
          price: editOrderData.price,
          crispyPorkWeight: editOrderData.crispyPorkWeight,
          crispyPorkPiece: editOrderData.crispyPorkPiece,
          codAmount: editOrderData.codAmount,
          trackingNumber: editOrderData.trackingNumber,
          adminNote: combinedAdminNote,
          paymentStatus: editOrderData.paymentStatus,
          transferSlip: editOrderData.transferSlip,
          editedBy: currentUser?.name,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSelectedOrder(data.order);
        setIsEditingOrder(false);
        setEditOrderData(null);
        const dateForFetch = customerSearch ? undefined : filterDate;
        if (isSuperAdminRole(currentUser?.role)) {
          fetchOrders(filterAdminName, dateForFetch, customerSearch);
        } else {
          fetchOrders(currentUser?.name, dateForFetch, customerSearch);
        }
      } else {
        alert(data.error || "บันทึกไม่สำเร็จ");
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะบันทึก");
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Manual add/remove/edit of a piece is a discrete click, never mid-keystroke
  // into the weight field, so it's always safe here to re-derive weight/price/
  // COD/shipping from the pieces actually selected — unlike the typing-driven
  // auto-allocate flow in handleChange, which must NOT be touched this way
  // (it would fight the user's typing on every keystroke).
  const syncFormDataToRackTotal = (newRackDetails: RackDetail[]) => {
    const totalWeight = Number(newRackDetails.reduce((sum, r) => sum + (r.weight || 0), 0).toFixed(2));
    const weightStr = totalWeight > 0 ? String(totalWeight) : "";
    setFormData(prev => ({
      ...prev,
      crispyPorkPiece: newRackDetails.length.toString(),
      ...computeWeightDerivedFields(prev.promotion, prev.isCod, prev.shippingMethod, weightStr, settings),
    }));
    // Nothing selected anymore — release the weight/count lock so either
    // method can be picked fresh, instead of staying stuck on whichever mode
    // was used before everything got manually removed.
    if (newRackDetails.length === 0) {
      setAllocationMode(null);
      setDesiredPieceCount("");
    }
  };

  const handleAddManualRack = () => {
    const updated = [...rackDetails, { assignmentId: "", rackNo: "", weight: 0 }];
    setRackDetails(updated);
    syncFormDataToRackTotal(updated);
  };

  const handleManualRackChange = (index: number, field: keyof RackDetail, value: string | number) => {
    const updated = [...rackDetails];
    if (field === "assignmentId") {
      const selected = currentUser?.racks?.find((r: any) => r.id === value) as any;
      if (selected) {
        updated[index].assignmentId = selected.id;
        updated[index].rackNo = selected.rackNo;
        updated[index].weight = selected.remainingWeight;
      } else {
        updated[index].assignmentId = "";
        updated[index].rackNo = "";
        updated[index].weight = 0;
      }
    } else if (field === "weight") {
      updated[index].weight = Number(value);
    }
    setRackDetails(updated);
    syncFormDataToRackTotal(updated);
  };

  const handleRemoveRack = (index: number) => {
    const updated = rackDetails.filter((_, i) => i !== index);
    setRackDetails(updated);
    syncFormDataToRackTotal(updated);
  };

  // Lets a search result row itself act as the "add to order" control — click
  // once to add the piece, click again to take it back out.
  const handleTogglePieceInOrder = (piece: any) => {
    const exists = rackDetails.some(r => r.assignmentId === piece.id);
    const updated = exists
      ? rackDetails.filter(r => r.assignmentId !== piece.id)
      : [...rackDetails, { assignmentId: piece.id, rackNo: piece.rackNo, weight: piece.remainingWeight }];
    setRackDetails(updated);
    syncFormDataToRackTotal(updated);
  };

  const handleSubmit = async (e: React.FormEvent, bypassDuplicateCheck = false) => {
    e.preventDefault();
    if (!formData.customerName.trim()) return;
    if (!isStorefrontMode && !formData.platform) {
      alert("กรุณาเลือกช่องทางการขายก่อนบันทึกออเดอร์");
      return;
    }
    if (hasSlipIssue(slipVerification) && !slipIssueReason) {
      alert("สลิปมีปัญหา กรุณาเลือกเหตุผลก่อนบันทึกออเดอร์");
      return;
    }

    // Validation
    const requestedWeight = parseFloat(formData.crispyPorkWeight);

    const slipIssueNote = hasSlipIssue(slipVerification) && slipIssueReason ? `[หมายเหตุสลิป: ${slipIssueReason}]` : "";
    const combinedAdminNote = [derivedAdminNote, slipIssueNote].filter(Boolean).join(" ");

    setIsLoading(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          orderStatus: isStorefrontMode ? "Completed" : formData.orderStatus,
          adminNote: combinedAdminNote,
          rackDetails: JSON.stringify(rackDetails),
          bypassDuplicateCheck,
        }),
      });

      const data = await res.json();

      if (data.duplicate) {
        setAlertData({
          show: true,
          message: data.message,
          customerName: formData.customerName.trim(),
        });
      } else if (data.success) {
        // Storefront role stays locked into storefront mode across sales —
        // a plain reset to initialForm would wipe platform/shippingMethod/
        // paymentStatus back to empty, breaking the next sale's submission.
        setFormData(
          currentUser?.role === "STOREFRONT"
            ? { ...initialForm, customerName: "ลูกค้าหน้าร้าน", platform: "Storefront", shippingMethod: "รับหน้าร้าน", paymentStatus: "Paid" }
            : initialForm
        );
        setRackDetails([]);
        setDesiredPieceCount("");
        setAllocationMode(null);
        setAlertData({ show: false, message: "", customerName: "" });
        setSlipVerification(null);
        setSlipIssueReason("");
        if (fileInputRef.current) fileInputRef.current.value = "";
        // The order just saved under the logged-in user's own name — make sure the
        // list refresh can actually show it, even if a SUPER_ADMIN had the filter
        // set to browse a different admin's orders.
        if (isSuperAdminRole(currentUser?.role)) {
          setFilterAdminName("");
          fetchOrders("", customerSearch ? undefined : filterDate, customerSearch);
        } else {
          fetchOrders(currentUser?.name, customerSearch ? undefined : filterDate, customerSearch);
        }
        await fetchUsers(); // Refresh inventory
      } else {
        alert(data.error || "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
      }
    } catch (err) {
      console.error(err);
      alert("บันทึกออเดอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmDuplicate = () => {
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
    handleSubmit(fakeEvent, true);
  };

  const totalAllocated = Number(rackDetails.reduce((sum, r) => sum + r.weight, 0).toFixed(2));
  const targetWeight = parseFloat(formData.crispyPorkWeight) || 0;

  let derivedAdminNote = "";
  let derivedWarning = "";
  if (targetWeight > 0 && rackDetails.length > 0 && totalAllocated !== targetWeight) {
    const diff = Number((targetWeight - totalAllocated).toFixed(2));
    if (diff > 0) {
      derivedAdminNote = `หมูในคลังไม่พอดี ขาดอีก ${diff} kg`;
      derivedWarning = `⚠️ ไม่มีชิ้นส่วนหมูที่บวกกันได้พอดีเป๊ะ (ขาดอีก ${diff} kg) - ระบบจะบันทึกเป็น Comment ติดออเดอร์ไว้ให้ครับ`;
    } else {
      derivedAdminNote = `หมูในคลังไม่พอดี เกินมา ${Math.abs(diff)} kg`;
      derivedWarning = `⚠️ ไม่มีชิ้นส่วนหมูที่บวกกันได้พอดีเป๊ะ (เกินมา ${Math.abs(diff)} kg) - ระบบจะบันทึกเป็น Comment ติดออเดอร์ไว้ให้ครับ`;
    }
  } else if (targetWeight > 0 && rackDetails.length === 0) {
    derivedAdminNote = `หมูในคลังไม่มี ขาดอีก ${targetWeight} kg`;
    derivedWarning = `⚠️ หมูในคลังไม่มีเลย (ขาดอีก ${targetWeight} kg) - ระบบจะบันทึกเป็น Comment ติดออเดอร์ไว้ให้ครับ`;
  }

  if (currentUser?.role === "PACKING" || currentUser?.role === "STOREFRONT") return null;

  // Storefront staff pick the physical piece they just sold by weight rather
  // than typing a number and letting auto-allocate guess which piece(s) it
  // was — simpler UI, and matches how the sale actually happens at the till.
  const isStorefrontRole = currentUser?.role === "STOREFRONT";
  // Full storefront mode skips price/slip entirely — unless the admin has
  // named a real customer, in which case those fields come back (e.g. a
  // named walk-in who paid by bank transfer still needs a price + slip).
  // The storefront role always needs the price field (that's the whole
  // point of the role — recording what a piece sold for).
  const showPriceAndSlip = isStorefrontRole || !isStorefrontMode || formData.customerName !== "วางขายหน้าร้าน";
  const displayedOrders = showUnpaidOnly ? recentOrders.filter(o => o.paymentStatus === "Unpaid") : recentOrders;
  // Super Admin/DEV using storefront mode themselves get the same click-a-
  // piece picker as the storefront role, instead of the full weight/piece-
  // count auto-allocate form meant for shipped orders.
  const useSimplifiedPicker = isStorefrontMode && (isStorefrontRole || isSuperAdminRole(currentUser?.role));

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>บันทึกออเดอร์ใหม่</h1>
        <p className={styles.subtitle}>กรอกรายละเอียดออเดอร์ให้ครบ ระบบจะช่วยเช็คชื่อลูกค้าซ้ำให้อัตโนมัติ</p>
      </div>

      <div className={styles.layout}>
        <div className={`${styles.mainContent} glass-panel`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 className={styles.cardTitle} style={{ marginBottom: 0 }}>{isStorefrontMode ? "ขายหน้าร้าน" : "รายละเอียดออเดอร์"}</h2>
            {isSuperAdminRole(currentUser?.role) && (
              <button
                type="button"
                onClick={() => {
                  const turningOn = !isStorefrontMode;
                  setIsStorefrontMode(turningOn);
                  if (turningOn) {
                    setFormData(prev => ({
                      ...prev,
                      platform: "Storefront",
                      shippingMethod: "รับหน้าร้าน",
                      paymentStatus: "Paid"
                    }));
                  } else {
                    // Clear values that only ever come from storefront mode itself —
                    // otherwise they silently stick around (invisible in the normal
                    // dropdowns) and a real order could get miscategorized as a
                    // storefront sale later.
                    setFormData(prev => ({
                      ...prev,
                      platform: prev.platform === "Storefront" ? "" : prev.platform,
                      shippingMethod: (prev.shippingMethod === "รับหน้าร้าน" || prev.shippingMethod === "ส่งเอง") ? "" : prev.shippingMethod,
                      paymentStatus: prev.paymentStatus === "Paid" ? "" : prev.paymentStatus,
                    }));
                  }
                }}
                style={{
                  background: isStorefrontMode ? 'var(--accent-blue)' : 'rgba(255,255,255,0.05)',
                  color: isStorefrontMode ? '#fff' : 'var(--text-secondary)',
                  border: isStorefrontMode ? 'none' : '1px solid var(--border-color)',
                  padding: '6px 12px',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 'bold',
                }}
              >
                {isStorefrontMode ? '✓ โหมดขายหน้าร้าน' : 'โหมดขายหน้าร้าน'}
              </button>
            )}
          </div>
          <form onSubmit={(e) => handleSubmit(e, false)} className={styles.formGrid}>

            {/* Customer Info */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>ข้อมูลลูกค้า</h3>
              <div className={styles.formGroup}>
                <label className={styles.label}>ชื่อลูกค้า <span style={{ color: '#ff6b6b' }}>*</span></label>

                {isStorefrontMode && isStorefrontRole ? (
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', padding: '12px 0' }}>
                    🏪 ลูกค้าหน้าร้าน (walk-in ไม่ต้องระบุชื่อ)
                  </div>
                ) : (
                  <input required type="text" name="customerName" value={formData.customerName} onChange={handleChange} className={styles.input} placeholder="ชื่อลูกค้า" />
                )}
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>ช่องทางการขาย <span style={{ color: '#ff6b6b' }}>*</span></label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {[
                    { value: 'Facebook', label: 'Facebook', icon: <FacebookIcon /> },
                    { value: 'Line', label: 'Line', icon: <LineIcon /> },
                    { value: 'TikTok', label: 'TikTok', icon: <TikTokIcon /> },
                    { value: 'Shopee', label: 'Shopee', icon: <ShopeeIcon /> },
                    { value: 'Other', label: 'อื่นๆ', icon: <OtherPlatformIcon /> },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, platform: opt.value }))}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 16px',
                        borderRadius: '8px',
                        border: formData.platform === opt.value ? '2px solid var(--accent-blue)' : '1px solid var(--border-color)',
                        background: formData.platform === opt.value ? 'var(--accent-blue)' : 'rgba(255,255,255,0.05)',
                        color: formData.platform === opt.value ? '#fff' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: formData.platform === opt.value ? 'bold' : 'normal',
                      }}
                    >
                      {opt.icon}
                      {opt.label}
                    </button>
                  ))}
                </div>
                {!formData.platform && (
                  <div style={{ fontSize: '12px', color: '#ff6b6b', marginTop: '6px' }}>
                    ⚠️ ยังไม่ได้เลือกช่องทางขาย
                  </div>
                )}
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>ชื่อบัญชี / เพจ (ถ้ามี)</label>
                <input type="text" name="socialMediaName" value={formData.socialMediaName || ""} onChange={handleChange} className={styles.input} placeholder="เช่น IG: john_doe" />
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>ที่อยู่จัดส่ง</label>
                <textarea name="customerAddress" value={formData.customerAddress} onChange={handleChange} className={styles.textarea} placeholder="กรอกที่อยู่ลูกค้าสำหรับจัดส่ง"></textarea>
              </div>
            </div>

            {/* Product Details */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>รายละเอียดสินค้า</h3>
              {useSimplifiedPicker ? (
                <div className={styles.formGroup} style={{ gridColumn: '1 / -1', background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '8px' }}>
                  <label className={styles.label}>หมูที่ขาย</label>
                  {rackDetails.length === 0 ? (
                    <p style={{ fontSize: '13px', color: '#ff6b6b', margin: '4px 0 0 0' }}>⚠️ ยังไม่ได้เลือกชิ้นที่ขาย — เลือกจากรายการ "คลังหมูของฉัน" ด้านขวา</p>
                  ) : (
                    <>
                      <p style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--accent-green)', margin: '4px 0 0 0' }}>
                        {totalAllocated} กก. ({rackDetails.length} ชิ้น)
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                        {rackDetails.map((rack, index) => (
                          <span key={index} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(88,166,255,0.15)', border: '1px solid var(--accent-blue)', borderRadius: '999px', padding: '6px 10px', fontSize: '13px' }}>
                            {rack.weight} กก.
                            <button type="button" onClick={() => handleRemoveRack(index)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
              <div className={styles.formGroup}>
                <label className={styles.label}>น้ำหนักหมูกรอบ (กก.) <span style={{ color: '#ff6b6b' }}>*</span></label>
                <input
                  required
                  type="number"
                  step="0.01"
                  name="crispyPorkWeight"
                  value={formData.crispyPorkWeight}
                  onChange={handleChange}
                  className={styles.input}
                  placeholder="เช่น 1.5"
                  disabled={allocationMode === 'count'}
                  style={{ opacity: allocationMode === 'count' ? 0.5 : 1 }}
                />
                {derivedWarning && (
                  <div style={{ color: '#ffac33', fontSize: '12px', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '14px' }}>⚠️</span> {derivedWarning}
                  </div>
                )}
              </div>

              <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
                <label className={styles.label}>หรือเลือกจากจำนวนชิ้น (แทนการกรอกน้ำหนัก)</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <input
                    type="number"
                    min="0"
                    value={desiredPieceCount}
                    onChange={handlePieceCountChange}
                    className={styles.input}
                    placeholder="จำนวนชิ้น"
                    disabled={allocationMode === 'weight'}
                    style={{ maxWidth: '160px', opacity: allocationMode === 'weight' ? 0.5 : 1 }}
                  />
                  <select
                    value={pieceSortOrder}
                    onChange={(e) => handlePieceSortOrderChange(e.target.value as 'asc' | 'desc')}
                    className={styles.input}
                    disabled={allocationMode === 'weight'}
                    style={{ maxWidth: '220px', opacity: allocationMode === 'weight' ? 0.5 : 1 }}
                  >
                    <option value="desc">เอาน้ำหนักมากไปน้อย</option>
                    <option value="asc">เอาน้ำหนักน้อยไปมาก</option>
                  </select>
                </div>
                {allocationMode === 'count' && (
                  <div style={{ fontSize: '12px', marginTop: '8px' }}>
                    {rackDetails.length > 0 ? (
                      <span style={{ color: 'var(--accent-green)' }}>
                        น้ำหนักรวม {formData.crispyPorkWeight || 0} กก. ({rackDetails.length} ชิ้น)
                      </span>
                    ) : (
                      <span style={{ color: '#ff6b6b' }}>⚠️ ไม่มีชิ้นหมูในคลังให้เลือก</span>
                    )}
                    {Number(desiredPieceCount) > rackDetails.length && rackDetails.length > 0 && (
                      <span style={{ color: '#ffac33', marginLeft: '8px' }}>
                        (ขอ {desiredPieceCount} ชิ้น แต่ในคลังมีให้แค่ {rackDetails.length} ชิ้น)
                      </span>
                    )}
                  </div>
                )}
                {allocationMode === 'weight' && (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                    ลบน้ำหนักด้านบนออกก่อน ถ้าจะเลือกตามจำนวนชิ้นแทน
                  </div>
                )}
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>จำนวนชิ้นหมูกรอบ</label>
                <input
                  type="number"
                  name="crispyPorkPiece"
                  value={formData.crispyPorkPiece}
                  className={styles.input}
                  placeholder="จำนวนชิ้น"
                  min="0"
                  readOnly
                  style={{ opacity: 0.7 }}
                />
              </div>

              {/* Rack Allocation UI */}
              <div className={styles.formGroup} style={{ gridColumn: '1 / -1', background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label className={styles.label} style={{ marginBottom: 0 }}>ชิ้นหมูที่ใช้ในออเดอร์นี้</label>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: totalAllocated < targetWeight ? '#ff6b6b' : 'var(--accent-green)' }}>
                      จัดแล้ว {totalAllocated} / {targetWeight} กก.
                    </span>
                  </div>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>
                  ระบบเลือกชิ้นหมูจากคลังให้อัตโนมัติตามน้ำหนักที่กรอกด้านบน ถ้าต้องการแก้ไขเอง กด "เลือกชิ้นหมู" เพื่อเปลี่ยน หรือลบ/เพิ่มรายการได้
                </p>

                <>
                  {rackDetails.map((rack, index) => (
                    <div key={index} className={styles.mobileStackGrid} style={{ display: 'grid', gridTemplateColumns: '1fr 100px auto', gap: '8px', marginBottom: '8px' }}>
                      <select
                        className={styles.input}
                        value={rack.assignmentId}
                        onChange={(e) => handleManualRackChange(index, "assignmentId", e.target.value)}
                      >
                        <option value="">-- เลือกชิ้นหมู --</option>
                        {[...(currentUser?.racks || [])]
                          .filter((r: any) => !r.isUsedUp || r.id === rack.assignmentId)
                          .sort((a: any, b: any) => {
                            const matchA = a.rackNo.match(/([A-Z]+)(\d+)-(\d+)/);
                            const matchB = b.rackNo.match(/([A-Z]+)(\d+)-(\d+)/);
                            if (matchA && matchB) {
                              if (matchA[1] !== matchB[1]) return matchA[1].localeCompare(matchB[1]);
                              if (parseInt(matchA[2]) !== parseInt(matchB[2])) return parseInt(matchA[2]) - parseInt(matchB[2]);
                              return parseInt(matchA[3]) - parseInt(matchB[3]);
                            }
                            return a.rackNo.localeCompare(b.rackNo, undefined, { numeric: true });
                          })
                          .map((r: any) => (
                          <option key={r.id} value={r.id}>
                            {r.rackNo} (avail: {parseFloat(Number(r.remainingWeight).toFixed(2))}kg)
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        className={styles.input}
                        value={rack.weight || ""}
                        readOnly
                        style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}
                        placeholder="kg"
                        title="ห้ามย่อยขาย (Force whole piece)"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveRack(index)}
                        title="ลบชิ้นนี้ออกจากออเดอร์"
                        style={{
                          background: 'rgba(255,107,107,0.15)',
                          border: '1px solid rgba(255,107,107,0.4)',
                          color: '#ff6b6b',
                          cursor: 'pointer',
                          borderRadius: '8px',
                          width: '44px',
                          fontSize: '20px',
                          fontWeight: 'bold',
                        }}
                      >✕</button>
                    </div>
                  ))}
                  <button type="button" onClick={handleAddManualRack} className={styles.button} style={{ width: '100%', marginTop: '10px', padding: '14px 20px', fontSize: '16px', fontWeight: 'bold', background: 'rgba(255,255,255,0.1)' }}>
                    + เพิ่มชิ้นหมูเอง
                  </button>
                </>
              </div>
                </>
              )}


              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>โปรโมชั่น</label>
                <select name="promotion" value={formData.promotion} onChange={handleChange} className={styles.input}>
                  <option value="">ไม่มีโปรโมชั่น</option>
                  <option value="1 kg 250 บาท">1 กก. 250 บาท</option>
                </select>
              </div>
            </div>

            {/* Financials */}
            <div className={styles.formSection} style={{ display: showPriceAndSlip ? 'grid' : 'none', gridTemplateColumns: '1fr', gap: '20px' }}>
              <h3 className={styles.sectionTitle} style={{ marginBottom: 0 }}>ยอดเงินและค่าส่ง</h3>

              {/* Primary, required inputs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>ราคาสินค้า (บาท) <span style={{ color: '#ff6b6b' }}>*</span></label>
                  <input required={showPriceAndSlip} type="number" step="0.01" name="price" value={formData.price} onChange={handleChange} className={styles.input} placeholder="ราคาหมูกรอบ" />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label}>วิธีจัดส่ง <span style={{ color: '#ff6b6b' }}>*</span></label>
                  <select required={showPriceAndSlip} name="shippingMethod" value={formData.shippingMethod} onChange={handleChange} className={styles.input}>
                    <option value="">-- เลือกวิธีจัดส่ง --</option>
                    {!isStorefrontMode && (
                      <>
                        <option value="EMS">EMS</option>
                        <option value="NIM Express">NIM Express</option>
                      </>
                    )}
                    {isStorefrontMode && (
                      <>
                        <option value="รับหน้าร้าน">รับหน้าร้าน</option>
                        <option value="ส่งเอง">ส่งเอง</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {/* Optional extras */}
              <div style={{ display: isStorefrontMode ? 'none' : 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>ค่าส่งเพิ่มเติม (บาท)</label>
                  <input type="number" step="0.01" name="additionalShippingCost" value={formData.additionalShippingCost} onChange={handleChange} className={styles.input} placeholder="ระบบคำนวณให้อัตโนมัติเมื่อเลือกวิธีจัดส่ง" />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="checkbox" name="isCod" checked={formData.isCod} onChange={handleChange} style={{ width: '16px', height: '16px' }} />
                    เก็บเงินปลายทาง (COD)
                  </label>
                  <input type="number" step="0.01" name="codAmount" value={formData.codAmount} readOnly className={styles.input} placeholder="ยอดเก็บปลายทาง" style={{ opacity: formData.isCod ? 1 : 0.5, background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }} />
                </div>
              </div>

              {/* Auto-calculated summary — visually separated so it reads as
                  "the system worked this out", not more fields to fill in. */}
              <div style={{ display: isStorefrontMode ? 'none' : 'flex', gap: '12px', flexWrap: 'wrap', borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: '16px' }}>
                <div style={{ flex: '1 1 200px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '14px 16px' }}>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>🧮 ภาษีมูลค่าเพิ่ม (VAT 7%)</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{formData.vatAmount ? `฿${formData.vatAmount}` : '-'}</div>
                </div>
                <div style={{ flex: '1 1 200px', background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.25)', borderRadius: '10px', padding: '14px 16px' }}>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>🧮 ยอดรับจริงทั้งหมด</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--accent-green)' }}>{formData.actualReceivedAmount ? `฿${formData.actualReceivedAmount}` : '-'}</div>
                </div>
              </div>
            </div>

            {/* Status & Meta */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>สถานะและข้อมูลอื่นๆ</h3>

              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>สถานะการชำระเงิน <span style={{ color: '#ff6b6b' }}>*</span></label>
                <select required={!isStorefrontMode} name="paymentStatus" value={formData.paymentStatus} onChange={handleChange} className={styles.input}>
                  <option value="">-- เลือกสถานะ --</option>
                  <option value="Unpaid">ยังไม่จ่ายเงิน</option>
                  <option value="Paid">จ่ายเงินแล้ว</option>
                  <option value="COD">เก็บปลายทาง</option>
                </select>
              </div>
              <div className={styles.formGroup} style={{ display: showPriceAndSlip ? 'block' : 'none' }}>
                <label className={styles.label}>สลิปโอนเงิน</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input type="file" accept="image/*" onChange={handleFileUpload} ref={fileInputRef} className={styles.input} style={{ padding: '8px', opacity: (formData.paymentStatus === "Unpaid" || formData.paymentStatus === "COD") ? 0.5 : 1 }} disabled={isUploading || formData.paymentStatus === "Unpaid" || formData.paymentStatus === "COD"} />
                  {isUploading && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>กำลังอัปโหลด...</span>}
                </div>
                {formData.paymentStatus === "Unpaid" && (
                  <div style={{ fontSize: '12px', color: '#ffac33', marginTop: '6px' }}>
                    เลือก "ยังไม่จ่ายเงิน" อยู่ ไม่สามารถแนบสลิปได้ — ถ้าลูกค้าโอนแล้วให้เปลี่ยนสถานะเป็น "จ่ายเงินแล้ว" ก่อน
                  </div>
                )}
                {formData.paymentStatus === "COD" && (
                  <div style={{ fontSize: '12px', color: '#ffac33', marginTop: '6px' }}>
                    เป็นออเดอร์เก็บปลายทาง ไม่ต้องแนบสลิป — ระบบจะยืนยันยอดผ่านการเช็คเลขพัสดุที่หน้าแพ็คของแทน
                  </div>
                )}
                {formData.transferSlip && (
                  <div style={{ marginTop: '8px', fontSize: '12px' }}>
                    <a href={formData.transferSlip} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>ดูสลิปที่อัปโหลด</a>
                    <button type="button" onClick={() => { setFormData(prev => ({ ...prev, transferSlip: "" })); setSlipVerification(null); setSlipIssueReason(""); if (fileInputRef.current) fileInputRef.current.value = ""; }} style={{ marginLeft: '12px', background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}>ลบสลิป</button>
                  </div>
                )}
                <SlipVerificationBadge result={slipVerification} />
                {hasSlipIssue(slipVerification) && (
                  <SlipIssueReasonPicker value={slipIssueReason} onChange={setSlipIssueReason} />
                )}
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>ชื่อผู้ขาย (แอดมิน)</label>
                <input type="text" name="sellerName" value={formData.sellerName} className={styles.input} placeholder="ชื่อผู้ขาย" readOnly={true} style={{ opacity: 0.7, cursor: 'not-allowed', backgroundColor: 'rgba(255,255,255,0.05)' }} />
              </div>
            </div>

            <div className={styles.submitRow}>
              <button type="submit" className={styles.button} disabled={isLoading}>
                {isLoading ? "กำลังบันทึก..." : "บันทึกออเดอร์"}
              </button>
            </div>
          </form>
        </div>

        <div className={styles.sideContent}>
          {currentUser && (
            <div className={`${styles.card} glass-panel`} style={{ marginBottom: '24px' }}>
              <h2 className={styles.cardTitle} style={{ marginBottom: '16px', fontSize: '1.2rem' }}>📦 คลังหมูของฉัน</h2>

              <div style={{ marginBottom: '20px', padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--accent-blue)' }}>
                    {currentUser.racks?.filter(r => !r.isUsedUp).length || 0}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>ชิ้นคงเหลือ</div>
                </div>
                <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)' }}></div>
                <div>
                  <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--accent-green)' }}>
                    {currentUser.racks?.reduce((sum, r) => sum + (!r.isUsedUp ? (r.remainingWeight || 0) : 0), 0).toFixed(2)}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>กก. คงเหลือ</div>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label className={styles.label} style={{ display: 'block', marginBottom: '6px', fontSize: '13px' }}>🔍 หาชิ้นหมูใกล้เคียงน้ำหนัก (กก.)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={weightSearch}
                  onChange={(e) => setWeightSearch(e.target.value)}
                  className={styles.input}
                  placeholder="เช่น 1.5"
                />
              </div>

              {(!currentUser.racks || currentUser.racks.filter(r => !r.isUsedUp).length === 0) ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>ไม่มีชิ้นหมูในคลัง</div>
              ) : (() => {
                const availableRacks = currentUser.racks.filter(r => !r.isUsedUp);
                const target = parseFloat(weightSearch);
                const isSearching = weightSearch !== "" && !isNaN(target) && target > 0;
                // Storefront role always gets the flat pick-by-weight list —
                // there's no auto-allocate form for them to fall back on, so
                // this list IS how they mark a piece as sold.
                const showFlatList = isSearching || useSimplifiedPicker;

                if (showFlatList) {
                  const matches = isSearching
                    ? [...availableRacks]
                        .map((p: any) => ({ ...p, diff: Math.abs(p.remainingWeight - target) }))
                        .sort((a: any, b: any) => a.diff - b.diff)
                    : [...availableRacks]
                        .sort((a: any, b: any) => b.remainingWeight - a.remainingWeight)
                        .map((p: any) => ({ ...p, diff: null }));

                  return (
                    <>
                      <h3 style={{ fontSize: '15px', marginBottom: '12px', color: 'var(--text-secondary)' }}>
                        {isSearching ? `ชิ้นที่ใกล้เคียง ${target} กก. มากที่สุด:` : (useSimplifiedPicker ? 'กดเพื่อเลือกชิ้นที่ขายไป:' : 'รายการชิ้นหมูที่เหลือ:')}
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '350px', overflowY: 'auto', paddingRight: '4px' }}>
                        {matches.map((p: any, idx: number) => {
                          const isClose = p.diff !== null && p.diff <= 0.1;
                          const isAdded = rackDetails.some(r => r.assignmentId === p.id);
                          return (
                            <div
                              key={p.id || idx}
                              onClick={() => handleTogglePieceInOrder(p)}
                              style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '10px 14px', borderRadius: '8px', flexShrink: 0, cursor: 'pointer',
                                background: isAdded ? 'rgba(88,166,255,0.16)' : (isClose ? 'rgba(63,185,80,0.12)' : 'rgba(255,255,255,0.03)'),
                                border: `1px solid ${isAdded ? 'var(--accent-blue)' : (isClose ? 'rgba(63,185,80,0.5)' : 'rgba(255,255,255,0.08)')}`,
                              }}
                              title={isAdded ? "กดอีกครั้งเพื่อเอาออกจากออเดอร์" : "กดเพื่อเพิ่มชิ้นนี้เข้าออเดอร์"}
                            >
                              <span style={{ fontSize: '14px', color: '#ddd' }}>
                                {useSimplifiedPicker ? '🐷 หมู 1 ชิ้น' : `ถาด ${p.rackNo?.split('-')[0] || '-'}${p.rackNo?.includes('-') ? ` • ชิ้นที่ ${p.rackNo.split('-')[1]}` : ''}`}
                                {isAdded && <span style={{ marginLeft: '8px', color: 'var(--accent-blue)' }}>✓ เลือกแล้ว</span>}
                                {!isAdded && isClose && <span style={{ marginLeft: '8px', color: 'var(--accent-green)' }}>✓ ใกล้เคียงมาก</span>}
                              </span>
                              <span style={{ fontSize: '14px', color: 'var(--accent-green)', fontWeight: 'bold' }}>{p.remainingWeight} กก.</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                }

                const groupedRacks = availableRacks.reduce((acc: any, curr: any) => {
                  const baseRack = curr.rackNo.split('-')[0];
                  if (!acc[baseRack]) acc[baseRack] = [];
                  acc[baseRack].push(curr);
                  return acc;
                }, {});

                const sortedBaseRacks = Object.keys(groupedRacks).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

                return (
                  <>
                    <h3 style={{ fontSize: '15px', marginBottom: '12px', color: 'var(--text-secondary)' }}>รายการชิ้นหมูที่เหลือ:</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '350px', overflowY: 'auto', paddingRight: '4px' }}>
                      {sortedBaseRacks.map(baseRack => {
                        const pieces = groupedRacks[baseRack];
                        const totalWeight = pieces.reduce((sum: number, p: any) => sum + p.remainingWeight, 0);
                        const sortedPieces = [...pieces].sort((a: any, b: any) => (a.rackNo || '').localeCompare((b.rackNo || ''), undefined, { numeric: true }));
                        return (
                          <div key={baseRack} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
                            <div style={{ background: 'rgba(255,255,255,0.06)', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 'bold', color: 'var(--accent-blue)', fontSize: '16px' }}>ถาด {baseRack}</span>
                              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{pieces.length} ชิ้น รวม {totalWeight.toFixed(2)} กก.</span>
                            </div>
                            <div>
                              {sortedPieces.map((p: any, idx: number) => (
                                <div key={p.rackNo || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)' }}>
                                  <span style={{ fontSize: '14px', color: '#ddd' }}>{p.rackNo?.includes('-') ? `ชิ้นที่ ${p.rackNo.split('-')[1]}` : (p.rackNo || 'ไม่ทราบ')}</span>
                                  <span style={{ fontSize: '14px', color: 'var(--accent-green)', fontWeight: 'bold' }}>{p.remainingWeight} กก.</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowOrdersModal(true)}
            className={`glass-panel ${styles.ordersButton}`}
          >
            <div className={styles.ordersIcon}>📋</div>
            <div className={styles.ordersInfo}>
              <div className={styles.ordersTitle}>ออเดอร์ของฉัน</div>
              <div className={styles.ordersSubtitle}>{recentOrders.length} รายการ • ดูทั้งหมด</div>
            </div>
            <span className={styles.ordersChevron}>›</span>
          </button>
        </div>
      </div>

      {showOrdersModal && (
        <div className={styles.modalOverlay} onClick={() => setShowOrdersModal(false)}>
          <div
            className={styles.alertBox}
            style={{ maxWidth: '600px', width: '92%', maxHeight: '85vh', textAlign: 'left', padding: '24px', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.3rem', marginBottom: 0 }}>ออเดอร์ทั้งหมด</h3>
              <button type="button" onClick={() => setShowOrdersModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>

            <input
              type="text"
              placeholder="🔍 ค้นหาชื่อลูกค้า..."
              className={styles.input}
              style={{ fontSize: '13px', marginBottom: '8px' }}
              value={customerSearchInput}
              onChange={(e) => setCustomerSearchInput(e.target.value)}
            />
            {customerSearch && (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                กำลังค้นหาทุกวันที่ (ไม่จำกัดตามวันที่เลือกไว้)
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              {currentUser && isSuperAdminRole(currentUser.role) && (
                <select
                  className={styles.input}
                  style={{ fontSize: '13px', flex: '1 1 200px' }}
                  value={filterAdminName}
                  onChange={(e) => setFilterAdminName(e.target.value)}
                >
                  <option value="">แอดมินทั้งหมด</option>
                  <option value={currentUser.name}>👤 ตัวเอง ({currentUser.name})</option>
                  {users.filter(u => !isSuperAdminRole(u.role) && u.role !== "CENTRAL_INVENTORY" && u.role !== "PACKING" && u.id !== currentUser.id).map(u => (
                    <option key={u.id} value={u.name}>
                      {u.name} (เหลือ {u.racks?.reduce((sum, r) => sum + (!r.isUsedUp ? (r.remainingWeight || 0) : 0), 0).toFixed(2) || '0.00'} กก.)
                    </option>
                  ))}
                </select>
              )}
              <input
                type="date"
                className={styles.input}
                style={{ fontSize: '13px', flex: '1 1 160px', opacity: customerSearch ? 0.5 : 1 }}
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                disabled={!!customerSearch}
              />
              {filterDate && (
                <button
                  type="button"
                  onClick={() => setFilterDate("")}
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', borderRadius: '8px', padding: '0 14px', cursor: 'pointer', fontSize: '13px' }}
                >
                  ล้างวันที่
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowUnpaidOnly(v => !v)}
                style={{
                  background: showUnpaidOnly ? 'rgba(255,107,107,0.2)' : 'rgba(255,255,255,0.08)',
                  border: showUnpaidOnly ? '1px solid #ff6b6b' : '1px solid var(--border-color)',
                  color: showUnpaidOnly ? '#ff6b6b' : 'var(--text-secondary)',
                  borderRadius: '8px',
                  padding: '0 14px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: showUnpaidOnly ? 'bold' : 'normal',
                }}
              >
                💸 {showUnpaidOnly ? '✓ ' : ''}ยังไม่จ่ายเงิน
              </button>
            </div>

            {displayedOrders.length === 0 ? (
              <div className={styles.emptyState}>{showUnpaidOnly ? "ไม่มีออเดอร์ที่ยังไม่จ่ายเงิน" : "ยังไม่มีออเดอร์"}</div>
            ) : (
              <ul className={styles.list} style={{ overflowY: 'auto', paddingRight: '4px' }}>
                {displayedOrders.map((order) => (
                  <li key={order.id} className={styles.listItem} onClick={() => { setSelectedOrder(order); setIsEditingOrder(false); setEditOrderData(null); }} style={{ cursor: 'pointer' }}>
                    <div className={styles.itemInfo}>
                      <span className={styles.itemName}>
                        {order.orderNo || "?"} - {order.customerName}
                        {order.paymentStatus === "Unpaid" && (
                          <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 'bold', color: '#ff6b6b', background: 'rgba(255,107,107,0.15)', padding: '2px 8px', borderRadius: '999px' }}>
                            ยังไม่จ่าย
                          </span>
                        )}
                      </span>
                      <span className={styles.itemProduct}>
                        {order.platform || "ไม่ระบุช่องทาง"}
                        {order.adminNote && <span style={{ color: '#ffac33', marginLeft: '8px' }} title={order.adminNote}>⚠️ มีหมายเหตุ</span>}
                        {order.trackingNumber && <span style={{ color: 'var(--accent-green)', marginLeft: '8px' }} title={`เลขพัสดุ: ${order.trackingNumber}`}>🚚 ได้เลขพัสดุแล้ว</span>}
                      </span>
                    </div>
                    <span className={styles.itemTime}>
                      {new Date(order.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}


      {alertData.show && (
        <div className={styles.modalOverlay}>
          <div className={styles.alertBox}>
            <div className={styles.alertIcon}>!</div>
            <h3 className={styles.alertTitle}>Order นี้มีความเสี่ยงจัดส่งซ้ำ</h3>
            <p className={styles.alertText}>{alertData.message}</p>
            <div className={styles.alertActions}>
              <button
                className={styles.btnCancel}
                onClick={() => setAlertData({ show: false, message: "", customerName: "" })}
              >
                ยกเลิก
              </button>
              <button
                className={styles.btnConfirm}
                onClick={handleConfirmDuplicate}
                disabled={isLoading}
              >
                บันทึกต่อไป
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedOrder && (() => {
        const statusInfo = getOrderStatusInfo(selectedOrder.orderStatus);
        const rackPieces: { rackNo: string; weight: number }[] = (() => {
          if (!selectedOrder.rackDetails) return [];
          try {
            const parsed = JSON.parse(selectedOrder.rackDetails);
            return Array.isArray(parsed) ? parsed : [];
          } catch (e) {
            return [];
          }
        })();
        // A shelf placement has no real sale yet — it's just a stock deduction
        // until a future POS integration backfills the actual sales figures.
        const isShelfSale = selectedOrder.platform === "Storefront" && selectedOrder.customerName === "วางขายหน้าร้าน";

        return (
          <div className={styles.modalOverlay} onClick={handleCloseOrderDetail}>
            <div className={styles.alertBox} style={{ maxWidth: '520px', width: '92%', maxHeight: '85vh', textAlign: 'left', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>ออเดอร์ {selectedOrder.orderNo || '-'}</div>
                  <h3 style={{ fontSize: '1.3rem', marginBottom: '10px' }}>{selectedOrder.customerName}</h3>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-block', fontSize: '12px', fontWeight: 'bold', color: statusInfo.color, background: statusInfo.bg, padding: '4px 12px', borderRadius: '999px' }}>
                      {statusInfo.label}
                    </span>
                    {selectedOrder.paymentStatus === "Unpaid" && (
                      <span style={{ display: 'inline-block', fontSize: '12px', fontWeight: 'bold', color: '#ff6b6b', background: 'rgba(255,107,107,0.15)', padding: '4px 12px', borderRadius: '999px' }}>
                        ยังไม่จ่าย
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  {!isEditingOrder && (
                    <button
                      type="button"
                      onClick={handleStartEditOrder}
                      style={{ background: 'rgba(255,172,51,0.15)', border: 'none', color: '#ffac33', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', padding: '6px 14px', borderRadius: '8px' }}
                    >
                      ✏️ แก้ไข
                    </button>
                  )}
                  <button type="button" onClick={handleCloseOrderDetail} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>✕</button>
                </div>
              </div>

              {isEditingOrder && editOrderData ? (
                <>
                  {/* Edit form */}
                  <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>ชื่อลูกค้า</label>
                      <input type="text" className={styles.input} value={editOrderData.customerName || ''} onChange={e => setEditOrderData({ ...editOrderData, customerName: e.target.value })} />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>ที่อยู่</label>
                      <textarea className={styles.textarea} value={editOrderData.customerAddress || ''} onChange={e => setEditOrderData({ ...editOrderData, customerAddress: e.target.value })}></textarea>
                    </div>
                    <div className={styles.mobileStackGrid} style={{ display: editOrderData.platform === "Storefront" && editOrderData.customerName === "วางขายหน้าร้าน" ? 'none' : 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                        <label className={styles.label}>ราคาสินค้า (บาท)</label>
                        <input type="number" step="0.01" className={styles.input} value={editOrderData.price ?? ''} onChange={e => setEditOrderData({ ...editOrderData, price: e.target.value })} />
                      </div>
                      <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                        <label className={styles.label}>เก็บปลายทาง (บาท)</label>
                        <input type="number" step="0.01" className={styles.input} value={editOrderData.codAmount ?? ''} onChange={e => setEditOrderData({ ...editOrderData, codAmount: e.target.value })} />
                      </div>
                    </div>
                    <div className={styles.mobileStackGrid} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                        <label className={styles.label}>น้ำหนัก (กก.)</label>
                        <input type="text" className={styles.input} value={editOrderData.crispyPorkWeight || ''} onChange={e => setEditOrderData({ ...editOrderData, crispyPorkWeight: e.target.value })} />
                      </div>
                      <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                        <label className={styles.label}>จำนวนชิ้น</label>
                        <input type="text" className={styles.input} value={editOrderData.crispyPorkPiece || ''} onChange={e => setEditOrderData({ ...editOrderData, crispyPorkPiece: e.target.value })} />
                      </div>
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>เลขพัสดุ</label>
                      <input type="text" className={styles.input} value={editOrderData.trackingNumber || ''} onChange={e => setEditOrderData({ ...editOrderData, trackingNumber: e.target.value })} />
                    </div>

                    <div className={styles.formGroup}>
                      <label className={styles.label}>สถานะการชำระเงิน</label>
                      <select className={styles.input} value={editOrderData.paymentStatus || ''} onChange={e => setEditOrderData({ ...editOrderData, paymentStatus: e.target.value })}>
                        <option value="">-- เลือกสถานะ --</option>
                        <option value="Unpaid">ยังไม่จ่ายเงิน</option>
                        <option value="Paid">จ่ายเงินแล้ว</option>
                        <option value="COD">เก็บปลายทาง</option>
                      </select>
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>สลิปโอนเงิน</label>
                      <input type="file" accept="image/*" onChange={handleEditFileUpload} className={styles.input} style={{ padding: '8px', opacity: (editOrderData.paymentStatus === "Unpaid" || editOrderData.paymentStatus === "COD") ? 0.5 : 1 }} disabled={isEditUploading || editOrderData.paymentStatus === "Unpaid" || editOrderData.paymentStatus === "COD"} />
                      {isEditUploading && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>กำลังอัปโหลด...</span>}
                      {editOrderData.paymentStatus === "Unpaid" && (
                        <div style={{ fontSize: '12px', color: '#ffac33', marginTop: '6px' }}>
                          เลือก "ยังไม่จ่ายเงิน" อยู่ ไม่สามารถแนบสลิปได้ — ถ้าลูกค้าโอนแล้วให้เปลี่ยนสถานะเป็น "จ่ายเงินแล้ว" ก่อน
                        </div>
                      )}
                      {editOrderData.paymentStatus === "COD" && (
                        <div style={{ fontSize: '12px', color: '#ffac33', marginTop: '6px' }}>
                          เป็นออเดอร์เก็บปลายทาง ไม่ต้องแนบสลิป — ระบบจะยืนยันยอดผ่านการเช็คเลขพัสดุที่หน้าแพ็คของแทน
                        </div>
                      )}
                      {editOrderData.transferSlip && (
                        <div style={{ marginTop: '8px', fontSize: '12px' }}>
                          <a href={editOrderData.transferSlip} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>ดูสลิปที่อัปโหลด</a>
                        </div>
                      )}
                      <SlipVerificationBadge result={editSlipVerification} />
                      {hasSlipIssue(editSlipVerification) && (
                        <SlipIssueReasonPicker value={editSlipIssueReason} onChange={setEditSlipIssueReason} />
                      )}
                    </div>

                    <div className={styles.formGroup}>
                      <label className={styles.label}>หมายเหตุแอดมิน</label>
                      <input type="text" className={styles.input} value={editOrderData.adminNote || ''} onChange={e => setEditOrderData({ ...editOrderData, adminNote: e.target.value })} />
                    </div>
                  </div>

                  <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'flex-end', gap: '12px', flexShrink: 0 }}>
                    <button type="button" onClick={handleCancelEditOrder} className={styles.button} style={{ background: 'rgba(255,255,255,0.08)' }}>ยกเลิก</button>
                    <button type="button" onClick={handleSaveOrderEdit} disabled={isSavingEdit} className={styles.button}>
                      {isSavingEdit ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Body */}
                  <div style={{ padding: '20px 24px', overflowY: 'auto' }}>

                    {/* Money summary — a shelf placement has no sale to show yet */}
                    {isShelfSale ? (
                      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: '10px', padding: '14px 16px', marginBottom: '24px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        📦 นี่คือการวางขายหน้าร้าน (ตัดสต๊อคหมูเฉยๆ ยังไม่มียอดขาย) — ยอดขายจริงจะดึงมาจากระบบ POS ในอนาคต
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
                        <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '12px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: '19px', fontWeight: 'bold', color: '#fff' }}>฿{formatMoney(selectedOrder.price)}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>ราคาสินค้า</div>
                        </div>
                        <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '12px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: '19px', fontWeight: 'bold', color: '#fff' }}>฿{formatMoney(selectedOrder.codAmount)}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>เก็บปลายทาง</div>
                        </div>
                        <div style={{ flex: 1, background: 'rgba(63,185,80,0.12)', border: '1px solid rgba(63,185,80,0.35)', borderRadius: '10px', padding: '12px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: '19px', fontWeight: 'bold', color: 'var(--accent-green)' }}>฿{formatMoney(selectedOrder.actualReceivedAmount)}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>ยอดรับจริง</div>
                        </div>
                      </div>
                    )}

                    {Number(selectedOrder.codAmount) > 0 && (
                      <div style={{ marginBottom: '24px', marginTop: '-12px', fontSize: '13px' }}>
                        {selectedOrder.codConfirmed ? (
                          <span style={{ color: 'var(--accent-green)' }}>✅ ยืนยันรับ COD แล้ว — นับเข้ายอดขายแล้ว</span>
                        ) : (
                          <span style={{ color: '#ffac33' }}>🔒 รอยืนยันรับ COD — ยังไม่นับเข้ายอดขาย (Hold ไว้)</span>
                        )}
                      </div>
                    )}

                    <DetailSection title="ข้อมูลลูกค้า">
                      <DetailRow label="ช่องทาง" value={selectedOrder.platform || '-'} />
                      <DetailRow label="ชื่อบัญชี" value={selectedOrder.socialMediaName || '-'} />
                      <DetailRow label="ที่อยู่" value={selectedOrder.customerAddress || '-'} />
                    </DetailSection>

                    <DetailSection title="สินค้า">
                      <DetailRow label="น้ำหนัก" value={`${selectedOrder.crispyPorkWeight || '-'} กก.`} />
                      <DetailRow label="จำนวนชิ้น" value={selectedOrder.crispyPorkPiece || '-'} />
                      <DetailRow
                        label="ชิ้นหมูที่ใช้"
                        value={rackPieces.length > 0 ? rackPieces.map(r => `${r.rackNo} (${r.weight}กก.)`).join(', ') : '-'}
                      />
                    </DetailSection>

                    <DetailSection title="การจัดส่ง">
                      <DetailRow
                        label="เลขพัสดุ"
                        value={selectedOrder.trackingNumber ? <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>{selectedOrder.trackingNumber}</span> : '-'}
                      />
                      <DetailRow
                        label="สลิปโอนเงิน"
                        value={selectedOrder.transferSlip ? <a href={selectedOrder.transferSlip} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>ดูสลิป</a> : '-'}
                      />
                    </DetailSection>

                    {selectedOrder.adminNote && (
                      <div style={{ background: 'rgba(255,172,51,0.1)', border: '1px solid #ffac33', padding: '10px 12px', borderRadius: '8px', color: '#ffac33', fontSize: '14px' }}>
                        <span style={{ fontWeight: 'bold' }}>⚠️ หมายเหตุแอดมิน:</span> {selectedOrder.adminNote}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
