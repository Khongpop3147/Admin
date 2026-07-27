"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "../page.module.css";
import { useUser } from "../../components/UserProvider";

interface Order {
  id: string;
  orderNo: number;
  customerName: string;
  platform?: string;
  socialMediaName?: string;
  orderStatus?: string;
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

function calculateCodAmount(weight: number): number {
  if (weight <= 2) return 50;
  return (weight / 1.5) * 20;
}

// Shared by both the weight-input flow and the piece-count flow, so price/COD/
// shipping stay consistent no matter which one drove the allocation.
function computeWeightDerivedFields(
  promotion: string,
  isCod: boolean,
  shippingMethod: string,
  weightStr: string
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
    updates.codAmount = calculateCodAmount(parsedWeight).toFixed(2);
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

function formatMoney(value: unknown): string {
  const num = typeof value === "string" ? parseFloat(value) : (value as number);
  if (num === undefined || num === null || isNaN(num)) return "0";
  // ทศนิยมต่ำกว่า .5 ปัดลง, ตั้งแต่ .5 ปัดขึ้น (ปัดเป็นจำนวนเต็ม)
  return Math.round(num).toLocaleString("th-TH");
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
  const [isLoading, setIsLoading] = useState(false);
  const [isStorefrontMode, setIsStorefrontMode] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [alertData, setAlertData] = useState({
    show: false,
    message: "",
    customerName: "",
  });

  const [filterAdminName, setFilterAdminName] = useState("");
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
  const router = useRouter();

  useEffect(() => {
    if (currentUser?.role === "PACKING") {
      router.replace("/packing");
    }
  }, [currentUser, router]);

  useEffect(() => {
    if (currentUser) {
      if (currentUser.role === "SUPER_ADMIN") {
        fetchOrders(filterAdminName);
      } else {
        fetchOrders(currentUser.name);
      }
    }
  }, [filterAdminName, currentUser]);

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
      setFormData(prev => ({
        ...prev,
        vatAmount: vat.toFixed(2),
        actualReceivedAmount: total.toFixed(2)
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
        Object.assign(updates, computeWeightDerivedFields(prev.promotion, prev.isCod, prev.shippingMethod, weightStr));
      }
      return updates;
    });
  }, [rackDetails, allocationMode]);

  const fetchOrders = async (adminName?: string) => {
    try {
      const url = adminName ? `/api/orders?sellerName=${encodeURIComponent(adminName)}` : "/api/orders";
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
          newData.codAmount = calculateCodAmount(parsedWeight).toFixed(2);
        } else if (name === "isCod" && !applyCod) {
          newData.codAmount = "";
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (data.url) {
        setFormData(prev => ({ ...prev, transferSlip: data.url }));
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

  const handleAddManualRack = () => {
    setRackDetails(prev => [...prev, { assignmentId: "", rackNo: "", weight: 0 }]);
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
  };

  const handleRemoveRack = (index: number) => {
    setRackDetails(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent, bypassDuplicateCheck = false) => {
    e.preventDefault();
    if (!formData.customerName.trim()) return;

    // Validation
    const requestedWeight = parseFloat(formData.crispyPorkWeight);

    setIsLoading(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          orderStatus: isStorefrontMode ? "Completed" : formData.orderStatus,
          adminNote: derivedAdminNote,
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
        setFormData(initialForm);
        setRackDetails([]);
        setDesiredPieceCount("");
        setAllocationMode(null);
        setAlertData({ show: false, message: "", customerName: "" });
        if (fileInputRef.current) fileInputRef.current.value = "";
        // The order just saved under the logged-in user's own name — make sure the
        // list refresh can actually show it, even if a SUPER_ADMIN had the filter
        // set to browse a different admin's orders.
        if (currentUser?.role === "SUPER_ADMIN") {
          setFilterAdminName("");
          fetchOrders("");
        } else {
          fetchOrders(currentUser?.name);
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

  if (currentUser?.role === "PACKING") return null;

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
            {currentUser?.role === "SUPER_ADMIN" && (
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

                {isStorefrontMode && (
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        checked={formData.customerName !== "วางขายหน้าร้าน"}
                        onChange={() => setFormData({ ...formData, customerName: "" })}
                      />
                      ระบุชื่อลูกค้า
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        checked={formData.customerName === "วางขายหน้าร้าน"}
                        onChange={() => setFormData({ ...formData, customerName: "วางขายหน้าร้าน" })}
                      />
                      วางขายหน้าร้าน
                    </label>
                  </div>
                )}

                {(!isStorefrontMode || formData.customerName !== "วางขายหน้าร้าน") && (
                  <input required type="text" name="customerName" value={formData.customerName} onChange={handleChange} className={styles.input} placeholder="ชื่อลูกค้า" />
                )}
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>ช่องทางการขาย <span style={{ color: '#ff6b6b' }}>*</span></label>
                <select required={!isStorefrontMode} name="platform" value={formData.platform} onChange={handleChange} className={styles.input}>
                  <option value="">-- เลือกช่องทางขาย --</option>
                  <option value="Facebook">Facebook</option>
                  <option value="Line">Line</option>
                  <option value="Instagram">Instagram</option>
                  <option value="TikTok">TikTok</option>
                  <option value="Shopee">Shopee</option>
                  <option value="Lazada">Lazada</option>
                  <option value="Other">อื่นๆ</option>
                </select>
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
                    <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 100px auto', gap: '8px', marginBottom: '8px' }}>
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
                      <button type="button" onClick={() => handleRemoveRack(index)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}>✕</button>
                    </div>
                  ))}
                  <button type="button" onClick={handleAddManualRack} className={styles.button} style={{ marginTop: '8px', padding: '6px 12px', fontSize: '12px', background: 'rgba(255,255,255,0.1)' }}>
                    + เพิ่มชิ้นหมูเอง
                  </button>
                </>
              </div>


              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>โปรโมชั่น</label>
                <select name="promotion" value={formData.promotion} onChange={handleChange} className={styles.input}>
                  <option value="">ไม่มีโปรโมชั่น</option>
                  <option value="1 kg 250 บาท">1 กก. 250 บาท</option>
                </select>
              </div>
            </div>

            {/* Financials */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>ยอดเงินและค่าส่ง</h3>
              <div className={styles.formGroup}>
                <label className={styles.label}>ราคาสินค้า (บาท) <span style={{ color: '#ff6b6b' }}>*</span></label>
                <input required type="number" step="0.01" name="price" value={formData.price} onChange={handleChange} className={styles.input} placeholder="ราคาหมูกรอบ" />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>วิธีจัดส่ง <span style={{ color: '#ff6b6b' }}>*</span></label>
                <select required name="shippingMethod" value={formData.shippingMethod} onChange={handleChange} className={styles.input}>
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
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>ค่าส่งเพิ่มเติม (บาท)</label>
                <input type="number" step="0.01" name="additionalShippingCost" value={formData.additionalShippingCost} onChange={handleChange} className={styles.input} placeholder="ระบบคำนวณให้อัตโนมัติเมื่อเลือกวิธีจัดส่ง" />
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" name="isCod" checked={formData.isCod} onChange={handleChange} style={{ width: '16px', height: '16px' }} />
                  เก็บเงินปลายทาง (COD)
                </label>
                <input type="number" step="0.01" name="codAmount" value={formData.codAmount} readOnly className={styles.input} placeholder="ยอดเก็บปลายทาง" style={{ opacity: formData.isCod ? 1 : 0.5, background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }} />
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>ภาษีมูลค่าเพิ่ม (VAT 7%)</label>
                <input type="number" step="0.01" name="vatAmount" value={formData.vatAmount} readOnly className={styles.input} placeholder="ระบบคำนวณให้อัตโนมัติ" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }} />
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>ยอดรับจริงทั้งหมด</label>
                <input type="number" step="0.01" name="actualReceivedAmount" value={formData.actualReceivedAmount} readOnly className={styles.input} placeholder="ระบบคำนวณให้อัตโนมัติ" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }} />
              </div>
            </div>

            {/* Status & Meta */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>สถานะและข้อมูลอื่นๆ</h3>

              <div className={styles.formGroup}>
                <label className={styles.label}>สถานะการชำระเงิน <span style={{ color: '#ff6b6b' }}>*</span></label>
                <select required name="paymentStatus" value={formData.paymentStatus} onChange={handleChange} className={styles.input}>
                  <option value="">-- เลือกสถานะ --</option>
                  <option value="Unpaid">ยังไม่จ่ายเงิน</option>
                  <option value="Paid">จ่ายเงินแล้ว</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>สลิปโอนเงิน</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input type="file" accept="image/*" onChange={handleFileUpload} ref={fileInputRef} className={styles.input} style={{ padding: '8px' }} disabled={isUploading} />
                  {isUploading && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>กำลังอัปโหลด...</span>}
                </div>
                {formData.transferSlip && (
                  <div style={{ marginTop: '8px', fontSize: '12px' }}>
                    <a href={formData.transferSlip} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>ดูสลิปที่อัปโหลด</a>
                    <button type="button" onClick={() => { setFormData(prev => ({ ...prev, transferSlip: "" })); if (fileInputRef.current) fileInputRef.current.value = ""; }} style={{ marginLeft: '12px', background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}>ลบสลิป</button>
                  </div>
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

                if (isSearching) {
                  const matches = [...availableRacks]
                    .map((p: any) => ({ ...p, diff: Math.abs(p.remainingWeight - target) }))
                    .sort((a: any, b: any) => a.diff - b.diff);

                  return (
                    <>
                      <h3 style={{ fontSize: '15px', marginBottom: '12px', color: 'var(--text-secondary)' }}>ชิ้นที่ใกล้เคียง {target} กก. มากที่สุด:</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '350px', overflowY: 'auto', paddingRight: '4px' }}>
                        {matches.map((p: any, idx: number) => {
                          const isClose = p.diff <= 0.1;
                          return (
                            <div key={p.id || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: isClose ? 'rgba(63,185,80,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${isClose ? 'rgba(63,185,80,0.5)' : 'rgba(255,255,255,0.08)'}`, borderRadius: '8px', flexShrink: 0 }}>
                              <span style={{ fontSize: '14px', color: '#ddd' }}>
                                ถาด {p.rackNo?.split('-')[0] || '-'}{p.rackNo?.includes('-') ? ` • ชิ้นที่ ${p.rackNo.split('-')[1]}` : ''}
                                {isClose && <span style={{ marginLeft: '8px', color: 'var(--accent-green)' }}>✓ ใกล้เคียงมาก</span>}
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

            {currentUser?.role === "SUPER_ADMIN" && (
              <select
                className={styles.input}
                style={{ marginBottom: '16px', fontSize: '13px' }}
                value={filterAdminName}
                onChange={(e) => setFilterAdminName(e.target.value)}
              >
                <option value="">แอดมินทั้งหมด</option>
                {users.filter(u => u.role !== "SUPER_ADMIN").map(u => (
                  <option key={u.id} value={u.name}>
                    {u.name} (เหลือ {u.racks?.reduce((sum, r) => sum + (!r.isUsedUp ? (r.remainingWeight || 0) : 0), 0).toFixed(2) || '0.00'} กก.)
                  </option>
                ))}
              </select>
            )}

            {recentOrders.length === 0 ? (
              <div className={styles.emptyState}>ยังไม่มีออเดอร์</div>
            ) : (
              <ul className={styles.list} style={{ overflowY: 'auto', paddingRight: '4px' }}>
                {recentOrders.map((order) => (
                  <li key={order.id} className={styles.listItem} onClick={() => setSelectedOrder(order)} style={{ cursor: 'pointer' }}>
                    <div className={styles.itemInfo}>
                      <span className={styles.itemName}>#{order.orderNo || "?"} - {order.customerName}</span>
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
            <h3 className={styles.alertTitle}>พบชื่อลูกค้าซ้ำ</h3>
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

        return (
          <div className={styles.modalOverlay} onClick={() => setSelectedOrder(null)}>
            <div className={styles.alertBox} style={{ maxWidth: '520px', width: '92%', maxHeight: '85vh', textAlign: 'left', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>ออเดอร์ #{selectedOrder.orderNo || '-'}</div>
                  <h3 style={{ fontSize: '1.3rem', marginBottom: '10px' }}>{selectedOrder.customerName}</h3>
                  <span style={{ display: 'inline-block', fontSize: '12px', fontWeight: 'bold', color: statusInfo.color, background: statusInfo.bg, padding: '4px 12px', borderRadius: '999px' }}>
                    {statusInfo.label}
                  </span>
                </div>
                <button type="button" onClick={() => setSelectedOrder(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '20px', cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>✕</button>
              </div>

              {/* Body */}
              <div style={{ padding: '20px 24px', overflowY: 'auto' }}>

                {/* Money summary */}
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
            </div>
          </div>
        );
      })()}
    </div>
  );
}
