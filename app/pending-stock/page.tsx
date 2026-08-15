"use client";

import { useState, useEffect, useRef } from "react";
import { useUser } from "../../components/UserProvider";
import { useSettings } from "../../components/SettingsProvider";
import { isSuperAdminRole } from "../../lib/roles";
import { BASE_PATH } from "../../lib/basePath";
import { PRODUCT_TYPES, DEFAULT_PRODUCT_TYPE, getBaseRackKeyAuto } from "../../lib/rackCode";
import { computeRackAllocation, MAX_OVER_DEVIATION_KG, MIN_UNDER_DEVIATION_KG, MAX_UNDER_DEVIATION_KG } from "../../lib/rackAllocate";
import { isValidPhone, isValidZip, cleanPhoneInput, cleanZipInput } from "../../lib/addressParse";
import { getPricePerKg, computeVatAmount, computeActualReceivedAmount, calculateCodAmount } from "../../lib/money";
import { calculateShippingCost } from "../../lib/shipping";
import { sumUsableSlipAmounts, hasAnySlipIssue, isTotalAmountMatched, buildSlipIssueNote, isSlipIssueReasonComplete, SLIP_ISSUE_OTHER } from "../../lib/slipVerification";
import { PLATFORM_OPTIONS } from "../../components/PlatformIcons";
import { SlipVerificationBadge, CombinedSlipSummary, SlipIssueReasonPicker } from "../../components/SlipVerification";
import { formatMoney, getOrderStatusInfo, DetailSection, DetailRow } from "../../components/OrderDetailShared";
import styles from "../page.module.css";

interface RackPiece {
  assignmentId: string;
  rackNo: string;
  weight: number;
}

interface PendingItem {
  productType: string;
  weightKg: number;
  pricePerKg: number;
  price: number;
  // Real rack pieces an admin has assigned to cover this line, once they
  // actually have pork on hand — see app/api/pending-stock/[id]/assign-stock.
  // Empty/absent until then.
  rackDetails?: RackPiece[];
}

interface PendingEntry {
  id: string;
  customerName: string;
  platform: string | null;
  socialMediaName: string | null;
  customerAddress: string | null;
  customerPhone: string | null;
  customerZip: string | null;
  needsTaxInvoice: boolean;
  items: PendingItem[];
  shippingMethod: string | null;
  additionalShippingCost: number | null;
  codAmount: number | null;
  actualReceivedAmount: number | null;
  transferSlip: string | null;
  expectedShipDate: string | null;
  note: string | null;
  createdBy: string | null;
  fulfilledAt: string | null;
  orderId: string | null;
  createdAt: string;
}

interface ItemDraft {
  productType: string;
  weightKgStr: string;
}

const EMPTY_CUSTOMER = {
  customerName: "",
  platform: "",
  socialMediaName: "",
  customerAddress: "",
  customerPhone: "",
  customerZip: "",
  needsTaxInvoice: false,
  expectedShipDate: "",
  note: "",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// Bangkok-local "YYYY-MM-DD" for an entry's createdAt — comparable against
// a plain <input type="date"> value, unlike formatDateOnly's Thai-locale
// display string above.
function bangkokDateKey(iso: string): string {
  const d = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// expectedShipDate is a plain "YYYY-MM-DD" with no time component — format
// directly from the string parts (Buddhist year, DD/MM/YY) rather than
// going through Date/toLocaleDateString, which would risk an off-by-one
// from timezone conversion for a date-only value.
function formatShipDateOnly(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${String((y + 543) % 100).padStart(2, "0")}`;
}

function itemsTotal(items: PendingItem[]): number {
  return items.reduce((sum, it) => sum + (Number(it.price) || 0), 0);
}

function hasAnyStockAssigned(items: PendingItem[]): boolean {
  return items.some((it) => (it.rackDetails?.length ?? 0) > 0);
}

// "ส่งไป packing" converts the WHOLE entry into one order, so it's only
// allowed once every line has stock assigned — not just some.
function hasAllStockAssigned(items: PendingItem[]): boolean {
  return items.length > 0 && items.every((it) => (it.rackDetails?.length ?? 0) > 0);
}

// Urgency border for a still-waiting entry with no pork assigned yet — once
// any stock's been assigned the "we don't have pork" problem is resolved,
// so the clock stops regardless of how long it then sits waiting on the
// separate "ส่งไป packing" click.
function urgencyBorderColor(entry: PendingEntry): string | undefined {
  if (hasAnyStockAssigned(entry.items)) return undefined;
  const daysWaiting = (Date.now() - new Date(entry.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysWaiting >= 7) return "#ff6b6b";
  if (daysWaiting >= 4) return "#ff9f43";
  if (daysWaiting >= 3) return "#ffd23f";
  return undefined;
}

interface RackOption {
  id: string;
  rackNo: string;
  remainingWeight?: number;
  isUsedUp?: boolean;
  productType?: string;
}

// Same over/under-tolerance messaging Order Entry shows after its own
// auto-allocation (see OrderEntryForm.tsx's itemNotes) — kept in that exact
// wording/threshold so an admin sees the identical warning regardless of
// which page assigned the stock.
function shortageWarning(productLabel: string, targetWeight: number, selected: RackPiece[]): string | null {
  if (targetWeight <= 0) return null;
  const allocated = Number(selected.reduce((sum, r) => sum + r.weight, 0).toFixed(2));
  if (selected.length > 0 && allocated !== targetWeight) {
    const diff = Number((targetWeight - allocated).toFixed(2));
    if (diff > 0) return `⚠️ ${productLabel}ในคลังไม่พอดี ขาดอีก ${diff} กก.`;
    return `⚠️ ${productLabel}ในคลังไม่พอดี เกินมา ${Math.abs(diff)} กก.`;
  }
  if (selected.length === 0) {
    return `⚠️ ไม่มีชิ้น${productLabel}ในคลังที่น้ำหนักใกล้เคียงกับที่ต้องการมากพอ (ต้องเกินไม่เกิน ${MAX_OVER_DEVIATION_KG} กก. หรือขาดอยู่ในช่วง ${MIN_UNDER_DEVIATION_KG}-${MAX_UNDER_DEVIATION_KG} กก.) — กรุณาเลือกชิ้นหมูเองด้านล่าง`;
  }
  return null;
}

// One product line's real-stock picker — a simplified version of Order
// Entry's own "คลังหมูของฉัน" flat list (same click-to-toggle pattern), just
// without the nearest-weight search box, since matching a specific target
// isn't the point here the way it is at order-allocation time. Selections
// start auto-allocated (see openAssignPanel's use of computeRackAllocation,
// the same nearest-weight-match algorithm Order Entry itself uses) so an
// admin usually just confirms rather than hand-picking from scratch.
function AssignItemPicker({
  item,
  racks,
  selected,
  onToggle,
  onSave,
  isBusy,
}: {
  item: PendingItem;
  racks: RackOption[];
  selected: RackPiece[];
  onToggle: (piece: RackPiece) => void;
  onSave: () => void;
  isBusy: boolean;
}) {
  const productLabel = PRODUCT_TYPES[item.productType]?.label || item.productType;
  const selectedIds = new Set(selected.map((p) => p.assignmentId));
  const available = racks
    .filter((r) => (r.productType || DEFAULT_PRODUCT_TYPE) === item.productType && (!r.isUsedUp || selectedIds.has(r.id)))
    .sort((a, b) => (b.remainingWeight || 0) - (a.remainingWeight || 0));
  const selectedWeight = selected.reduce((sum, p) => sum + p.weight, 0);
  const warning = shortageWarning(productLabel, item.weightKg, selected);

  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ fontSize: "13px", fontWeight: "bold", marginBottom: "8px" }}>
        {productLabel} — ต้องการ {item.weightKg} กก. (เลือกแล้ว {selectedWeight.toFixed(2)} กก.)
      </div>
      {warning && (
        <div style={{ fontSize: "12px", color: "#ff9f43", marginBottom: "8px" }}>{warning}</div>
      )}
      {available.length === 0 ? (
        <div style={{ color: "var(--text-secondary)", fontSize: "13px", padding: "10px 0" }}>ไม่มีชิ้น{productLabel}ในคลังของคุณ</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "220px", overflowY: "auto", marginBottom: "8px" }}>
          {available.map((r) => {
            const isSelected = selectedIds.has(r.id);
            return (
              <div
                key={r.id}
                onClick={() => onToggle({ assignmentId: r.id, rackNo: r.rackNo, weight: r.remainingWeight || 0 })}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  background: isSelected ? "rgba(88,166,255,0.16)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isSelected ? "var(--accent-blue)" : "rgba(255,255,255,0.08)"}`,
                  fontSize: "13px",
                }}
              >
                <span>
                  ถาด {getBaseRackKeyAuto(r.rackNo || "")}{r.rackNo?.includes("-") ? ` • ${r.rackNo}` : ""}
                  {isSelected && <span style={{ marginLeft: "8px", color: "var(--accent-blue)" }}>✓ เลือกแล้ว</span>}
                </span>
                <span style={{ color: "var(--accent-green)", fontWeight: "bold" }}>{r.remainingWeight} กก.</span>
              </div>
            );
          })}
        </div>
      )}
      <button
        type="button"
        disabled={isBusy}
        onClick={onSave}
        style={{ padding: "7px 14px", borderRadius: "8px", background: "var(--accent-blue)", border: "none", color: "#fff", cursor: isBusy ? "wait" : "pointer", fontSize: "12px", fontWeight: "bold" }}
      >
        บันทึกหมูที่ใส่ ({productLabel})
      </button>
    </div>
  );
}

export default function PendingStockPage() {
  const { currentUser, users } = useUser();
  const { settings } = useSettings();
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Each admin only ever sees their own waiting-list — this page's whole
  // point is "customers I logged, that I owe pork to" — except a Super
  // Admin, who can see everyone at once (viewTarget === "") or switch to
  // one admin's list at a time, same pattern Dashboard's own "ดูข้อมูลของ"
  // switch uses.
  const isSuperAdmin = isSuperAdminRole(currentUser?.role);
  const [viewTarget, setViewTarget] = useState("");
  // Filters the "รอส่งของ" list to entries logged on one specific day —
  // "" means no filter (show every still-waiting entry, regardless of
  // date). Client-side only since the already-fetched entries list is
  // scoped per-admin and never huge.
  const [filterDate, setFilterDate] = useState("");
  const adminOptions = users.filter((u) => u.role !== "CENTRAL_INVENTORY" && u.role !== "PACKING" && u.role !== "HR" && u.id !== currentUser?.id);

  // Non-null while the top form is editing an existing still-waiting entry
  // instead of creating a new one — the form itself is fully reused (same
  // state, same JSX) for both, just swapping what submit does and its
  // label. Only ever set for a pending (unfulfilled) entry; a fulfilled
  // one's data is history now, not editable (see PATCH /api/pending-stock/[id]).
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  const [customer, setCustomer] = useState(EMPTY_CUSTOMER);
  const [items, setItems] = useState<ItemDraft[]>([{ productType: DEFAULT_PRODUCT_TYPE, weightKgStr: "" }]);
  const [shippingMethod, setShippingMethod] = useState("");
  const [additionalShippingCostStr, setAdditionalShippingCostStr] = useState("");
  const [isCod, setIsCod] = useState(false);
  const [codAmountStr, setCodAmountStr] = useState("");
  const [transferSlip, setTransferSlip] = useState("");
  const [slipVerification, setSlipVerification] = useState<any | null>(null);
  const [slipIssueReason, setSlipIssueReason] = useState("");
  const [slipIssueOtherText, setSlipIssueOtherText] = useState("");
  const [formError, setFormError] = useState("");
  // Same duplicate-risk confirmation popup as Order Entry — set when the
  // server flags this customer name + total weight as matching a
  // "ลูกค้ารอหมู" entry logged within the last 7 days.
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  // Non-null while the "จัดส่งวันนี้ หรือพรุ่งนี้" popup is open for one
  // entry, right before actually calling sendToPacking.
  const [sendToPackingChoiceId, setSendToPackingChoiceId] = useState<string | null>(null);
  // Same brief center-screen confirmation OrderEntryForm shows after saving
  // — covers both create and edit, since they share one submit handler.
  const [showSaveToast, setShowSaveToast] = useState(false);
  const saveToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashSaveToast = () => {
    if (saveToastTimer.current) clearTimeout(saveToastTimer.current);
    setShowSaveToast(true);
    saveToastTimer.current = setTimeout(() => setShowSaveToast(false), 1200);
  };
  useEffect(() => {
    return () => {
      if (saveToastTimer.current) clearTimeout(saveToastTimer.current);
    };
  }, []);

  // The real Order behind a fulfilled entry's orderId — fetched on demand
  // (not pre-loaded with the entries list) since most entries never get
  // viewed. Read-only: any actual editing still happens on Order Details.
  const [viewingOrder, setViewingOrder] = useState<any | null>(null);
  const [isLoadingOrder, setIsLoadingOrder] = useState(false);

  // "ใส่หมู" panel — open for at most one entry at a time. Selections start
  // seeded from whatever's already assigned on that entry so re-opening it
  // shows (and lets you edit) the current picks, not a blank slate.
  const [assignEntryId, setAssignEntryId] = useState<string | null>(null);
  const [assignSelections, setAssignSelections] = useState<Record<number, RackPiece[]>>({});
  const [isAssigning, setIsAssigning] = useState(false);

  const fetchEntries = async () => {
    try {
      const qs = isSuperAdmin && viewTarget ? `?admin=${encodeURIComponent(viewTarget)}` : "";
      const res = await fetch(`${BASE_PATH}/api/pending-stock${qs}`);
      const data = await res.json();
      if (res.ok) setEntries(data.entries);
    } catch (e) {
      console.error("Failed to fetch pending stock entries", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser) fetchEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, viewTarget]);

  // Same "fill in the admin's own default sales channel, but never
  // overwrite one already picked" pattern as OrderEntryForm's own effect —
  // re-fires on every currentUser refresh, which is also what makes the
  // default reapply once the form resets back to an empty platform after
  // each save.
  useEffect(() => {
    if (currentUser?.defaultPlatform) {
      setCustomer((prev) => (prev.platform ? prev : { ...prev, platform: currentUser.defaultPlatform! }));
    }
  }, [currentUser]);

  // Mirrors OrderEntryForm's own shipping-cost effect: re-derives the
  // shipping cost from method + total weight whenever either changes.
  // Still a plain editable field afterward (an admin can override it by
  // hand), same tradeoff Order Entry accepts — the next weight/method
  // change overwrites it again.
  useEffect(() => {
    if (!shippingMethod) return;
    const totalWeight = items.reduce((sum, it) => sum + (parseFloat(it.weightKgStr) || 0), 0);
    const cost = shippingMethod === "ส่งในพื้นที่" ? calculateShippingCost(shippingMethod, 0) : calculateShippingCost(shippingMethod, totalWeight);
    setAdditionalShippingCostStr(totalWeight > 0 || shippingMethod === "ส่งในพื้นที่" ? cost.toFixed(2) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shippingMethod, items]);

  // Same as Order Entry's own COD effect — courier collects cash by total
  // kg regardless of product mix, so this derives from combined weight
  // rather than any one line. Only re-derives while COD is checked; leaves
  // whatever's there alone once unchecked (handleIsCodChange below clears it).
  useEffect(() => {
    if (!isCod) return;
    const totalWeight = items.reduce((sum, it) => sum + (parseFloat(it.weightKgStr) || 0), 0);
    if (totalWeight > 0) setCodAmountStr(calculateCodAmount(totalWeight, settings).toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCod, items, settings]);

  if (!currentUser) return null;

  const resolvedItems: PendingItem[] = items.map((it) => {
    const weight = parseFloat(it.weightKgStr) || 0;
    const pricePerKg = getPricePerKg(it.productType, settings);
    return { productType: it.productType, weightKg: weight, pricePerKg, price: weight * pricePerKg };
  });
  const totalPrice = itemsTotal(resolvedItems);
  const shippingCost = parseFloat(additionalShippingCostStr) || 0;
  const codAmount = isCod ? parseFloat(codAmountStr) || 0 : 0;
  const vatAmount = computeVatAmount(totalPrice, shippingCost);
  const expectedTotal = computeActualReceivedAmount(totalPrice, shippingCost, codAmount);

  // Same shape as OrderEntryForm's own combinedHasSlipIssue — skipped
  // entirely for a COD entry, since there's no slip to have an issue with
  // yet (see the disabled slip section below).
  const slipAmountMismatch = !isCod && !!transferSlip && expectedTotal > 0 && !isTotalAmountMatched(sumUsableSlipAmounts([slipVerification]), expectedTotal);
  const combinedHasSlipIssue = !isCod && (hasAnySlipIssue([slipVerification]) || slipAmountMismatch);

  const addItemLine = () => setItems((prev) => [...prev, { productType: DEFAULT_PRODUCT_TYPE, weightKgStr: "" }]);
  const removeItemLine = (index: number) => setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  const updateItemLine = (index: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));

  // Same on/off pattern as Order Entry's handleIsCodChange — checking COD
  // clears whatever's in codAmountStr so the effect above derives a fresh
  // value from weight; unchecking blanks it back out since it no longer
  // applies.
  const handleIsCodChange = (checked: boolean) => {
    setIsCod(checked);
    if (!checked) setCodAmountStr("");
  };

  const verifySlip = async (url: string) => {
    try {
      const res = await fetch(`${BASE_PATH}/api/verify-slip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      return await res.json();
    } catch (err) {
      console.error("Slip verification failed", err);
      return { success: false, message: "เช็คสลิปไม่สำเร็จ" };
    }
  };

  const uploadSlipFile = async (file: File) => {
    setIsUploading(true);
    setSlipVerification(null);
    setSlipIssueReason("");
    setSlipIssueOtherText("");
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${BASE_PATH}/api/upload`, { method: "POST", body: form });
      const data = await res.json();
      if (data.url) {
        setTransferSlip(data.url);
        const absoluteSlipUrl = data.url.startsWith("http") ? data.url : `${window.location.origin}${data.url}`;
        const result = await verifySlip(absoluteSlipUrl);
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadSlipFile(file);
  };

  const handleSlipPaste = (e: React.ClipboardEvent) => {
    if (isUploading) return;
    const clipboardItems = e.clipboardData?.items;
    if (!clipboardItems) return;
    for (let i = 0; i < clipboardItems.length; i++) {
      if (clipboardItems[i].type.startsWith("image/")) {
        const file = clipboardItems[i].getAsFile();
        if (file) {
          e.preventDefault();
          uploadSlipFile(file);
        }
        return;
      }
    }
  };

  const resetForm = () => {
    // Re-fills the admin's own default sales channel immediately (rather
    // than waiting on the currentUser-refresh effect above to refire),
    // since nothing here otherwise refetches currentUser after a save.
    setCustomer({ ...EMPTY_CUSTOMER, platform: currentUser?.defaultPlatform || "" });
    setItems([{ productType: DEFAULT_PRODUCT_TYPE, weightKgStr: "" }]);
    setShippingMethod("");
    setAdditionalShippingCostStr("");
    setIsCod(false);
    setCodAmountStr("");
    setTransferSlip("");
    setSlipVerification(null);
    setSlipIssueReason("");
    setSlipIssueOtherText("");
    setEditingEntryId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Loads an existing still-waiting entry into the top form for editing —
  // slipVerification stays null (an already-saved slip isn't re-verified on
  // load, same as OrderEntryForm's own edit flow) but transferSlip itself
  // carries over so the "already uploaded" link still shows.
  const startEditEntry = (entry: PendingEntry) => {
    setCustomer({
      customerName: entry.customerName,
      platform: entry.platform || "",
      socialMediaName: entry.socialMediaName || "",
      customerAddress: entry.customerAddress || "",
      customerPhone: entry.customerPhone || "",
      customerZip: entry.customerZip || "",
      needsTaxInvoice: entry.needsTaxInvoice,
      expectedShipDate: entry.expectedShipDate || "",
      note: entry.note || "",
    });
    setItems(entry.items.map((it) => ({ productType: it.productType, weightKgStr: it.weightKg > 0 ? String(it.weightKg) : "" })));
    setShippingMethod(entry.shippingMethod || "");
    setAdditionalShippingCostStr(entry.additionalShippingCost != null ? String(entry.additionalShippingCost) : "");
    const cod = Number(entry.codAmount) || 0;
    setIsCod(cod > 0);
    setCodAmountStr(cod > 0 ? String(cod) : "");
    setTransferSlip(entry.transferSlip || "");
    setSlipVerification(null);
    setSlipIssueReason("");
    setSlipIssueOtherText("");
    setFormError("");
    setEditingEntryId(entry.id);
    if (fileInputRef.current) fileInputRef.current.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleAdd = async (e: React.FormEvent, bypassDuplicateCheck = false) => {
    e.preventDefault();
    setFormError("");
    if (!customer.customerName.trim()) {
      setFormError("กรุณากรอกชื่อลูกค้า");
      return;
    }
    if (!customer.platform) {
      setFormError("กรุณาเลือกช่องทางการขาย");
      return;
    }
    const phoneInvalid = !isValidPhone(customer.customerPhone);
    const zipInvalid = !isValidZip(customer.customerZip);
    if (phoneInvalid || zipInvalid) {
      const problems = [];
      if (phoneInvalid) problems.push("เบอร์โทร (ต้องมี 10 หลัก)");
      if (zipInvalid) problems.push("รหัสไปรษณีย์ (ต้องมี 5 หลัก)");
      setFormError(`กรุณากรอก ${problems.join(" และ ")} ให้ครบ`);
      return;
    }
    if (resolvedItems.every((it) => it.weightKg <= 0)) {
      setFormError("กรุณากรอกน้ำหนักสินค้าอย่างน้อย 1 รายการ");
      return;
    }
    if (combinedHasSlipIssue && !isSlipIssueReasonComplete(slipIssueReason, slipIssueOtherText)) {
      setFormError(
        slipIssueReason === SLIP_ISSUE_OTHER ? "กรุณาระบุว่าสลิปมีปัญหาอะไรก่อนบันทึก" : "สลิปมีปัญหา กรุณาเลือกเหตุผลก่อนบันทึก"
      );
      return;
    }
    const slipIssueNote = combinedHasSlipIssue ? buildSlipIssueNote(slipIssueReason, slipIssueOtherText) : "";
    const combinedNote = [customer.note, slipIssueNote].filter(Boolean).join(" ");
    const isEditing = !!editingEntryId;
    setIsBusy(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/pending-stock${isEditing ? `/${editingEntryId}` : ""}`, {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...customer,
          note: combinedNote,
          items: resolvedItems,
          shippingMethod: shippingMethod || null,
          additionalShippingCost: shippingCost,
          codAmount: isCod ? codAmount : null,
          actualReceivedAmount: expectedTotal,
          transferSlip: isCod ? "" : transferSlip,
          ...(isEditing ? {} : { bypassDuplicateCheck }),
        }),
      });
      const data = await res.json();
      if (data.duplicate) {
        setAlertMessage(data.message);
        return;
      }
      if (!res.ok) {
        setFormError(data.error || "บันทึกไม่สำเร็จ");
        return;
      }
      resetForm();
      flashSaveToast();
      await fetchEntries();
    } catch (e) {
      setFormError("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsBusy(false);
    }
  };

  // "บันทึกต่อไป" on the duplicate-risk popup — same fakeEvent pattern
  // Order Entry's own handleConfirmDuplicate uses, since handleAdd is bound
  // to a form's onSubmit and expects a real FormEvent to preventDefault on.
  const handleConfirmDuplicate = () => {
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
    setAlertMessage(null);
    handleAdd(fakeEvent, true);
  };

  // Every item line needs real stock assigned first (via "ใส่หมู" below) —
  // the server enforces this and this alert just surfaces its error, same
  // pattern as the rack-conflict error on real Order Entry.
  //
  // shipToday picks which day it shows up in Packing — default (false)
  // matches the app-wide "logged today, packed tomorrow" convention every
  // other order follows; true is the deliberate same-day-dispatch escape
  // hatch, asked for via sendToPackingChoiceId's popup below rather than
  // assumed, since a still-waiting entry could be sitting on stock that
  // just arrived (wants today) or stock assigned days ago (tomorrow's fine).
  const sendToPacking = async (id: string, shipToday: boolean) => {
    setIsBusy(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/pending-stock/${id}/send-to-packing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipToday }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "ส่งไป packing ไม่สำเร็จ");
        return;
      }
      await fetchEntries();
    } catch (e) {
      alert("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsBusy(false);
    }
  };

  const openOrderView = async (orderId: string) => {
    setIsLoadingOrder(true);
    setViewingOrder(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/orders?id=${orderId}`);
      const data = await res.json();
      const order = (data.orders || [])[0];
      if (!order) {
        alert("ไม่พบ order นี้ อาจถูกลบไปแล้ว");
        return;
      }
      setViewingOrder(order);
    } catch (e) {
      alert("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsLoadingOrder(false);
    }
  };

  const deleteEntry = async (id: string) => {
    if (!confirm("ลบรายการนี้?")) return;
    setIsBusy(true);
    try {
      await fetch(`${BASE_PATH}/api/pending-stock/${id}`, { method: "DELETE" });
      await fetchEntries();
    } catch (e) {
      alert("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsBusy(false);
    }
  };

  // For a line with nothing assigned yet, seed its selection from the same
  // nearest-weight auto-allocation Order Entry itself uses (see
  // autoAllocateRacksForItem in components/OrderEntryForm.tsx) instead of a
  // blank list — an admin usually just confirms the suggestion rather than
  // hand-picking every piece. A line that already has an assignment (being
  // re-opened for edits) keeps its current picks untouched instead.
  const openAssignPanel = (entry: PendingEntry) => {
    if (assignEntryId === entry.id) {
      setAssignEntryId(null);
      return;
    }
    const seeded: Record<number, RackPiece[]> = {};
    entry.items.forEach((it, i) => {
      if (it.rackDetails && it.rackDetails.length > 0) {
        seeded[i] = it.rackDetails;
        return;
      }
      const productRacks = (currentUser?.racks || []).filter((r: any) => (r.productType || DEFAULT_PRODUCT_TYPE) === it.productType);
      seeded[i] = computeRackAllocation(productRacks as any, it.weightKg);
    });
    setAssignSelections(seeded);
    setAssignEntryId(entry.id);
  };

  const toggleAssignPiece = (itemIndex: number, piece: RackPiece) => {
    setAssignSelections((prev) => {
      const current = prev[itemIndex] ?? [];
      const exists = current.some((p) => p.assignmentId === piece.assignmentId);
      return { ...prev, [itemIndex]: exists ? current.filter((p) => p.assignmentId !== piece.assignmentId) : [...current, piece] };
    });
  };

  const saveAssignItem = async (entryId: string, itemIndex: number) => {
    setIsAssigning(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/pending-stock/${entryId}/assign-stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIndex, rackDetails: assignSelections[itemIndex] ?? [] }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "ใส่หมูไม่สำเร็จ");
        return;
      }
      await fetchEntries();
    } catch (e) {
      alert("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsAssigning(false);
    }
  };

  const pending = entries.filter((e) => !e.fulfilledAt && (!filterDate || bangkokDateKey(e.createdAt) === filterDate));
  const fulfilled = entries.filter((e) => e.fulfilledAt);
  const slipCount = slipVerification ? 1 : 0;
  const totalVerifiedSlipAmount = sumUsableSlipAmounts([slipVerification]);

  return (
    <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto", color: "#fff" }}>
      <div className={styles.header} style={{ textAlign: "left", marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 className={styles.title} style={{ fontSize: "2rem" }}>ลูกค้ารอหมู</h1>
          <p className={styles.subtitle}>ลูกค้าที่จ่ายเงินแล้วแต่ยังไม่มีของให้ — บันทึกไว้กันลืม ใส่หมูแล้วส่งไป packing เมื่อสต็อกมา</p>
        </div>
        {isSuperAdmin && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>ดูรายการของ</label>
            <select
              value={viewTarget}
              onChange={(e) => setViewTarget(e.target.value)}
              className={styles.input}
              style={{ padding: "10px 16px", minWidth: "220px" }}
            >
              <option value="">🏢 ทุกคน</option>
              <option value={currentUser!.name}>👤 ตัวเอง ({currentUser!.nickname || currentUser!.name})</option>
              {adminOptions.map((u) => (
                <option key={u.id} value={u.name}>👤 {u.nickname || u.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <form onSubmit={handleAdd} className={`${styles.card} glass-panel`} style={{ marginBottom: "24px" }}>
        {editingEntryId && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(88,166,255,0.1)", border: "1px solid var(--accent-blue)", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px" }}>
            <span style={{ fontSize: "13px", color: "var(--accent-blue)", fontWeight: "bold" }}>✏️ กำลังแก้ไขรายการของ {customer.customerName || "ลูกค้า"}</span>
            <button type="button" onClick={resetForm} style={{ background: "none", border: "none", color: "var(--accent-blue)", cursor: "pointer", fontSize: "13px", textDecoration: "underline" }}>
              ยกเลิกแก้ไข
            </button>
          </div>
        )}
        <h3 className={styles.sectionTitle}>ข้อมูลลูกค้า</h3>
        <div className={styles.formGroup}>
          <label className={styles.label}>ชื่อลูกค้า <span style={{ color: "#ff6b6b" }}>*</span></label>
          <input type="text" value={customer.customerName} onChange={(e) => setCustomer((p) => ({ ...p, customerName: e.target.value }))} className={styles.input} placeholder="ชื่อลูกค้า" />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>วันที่คาดว่าจะส่ง (ถ้ามี)</label>
          <input
            type="date"
            value={customer.expectedShipDate}
            onChange={(e) => setCustomer((p) => ({ ...p, expectedShipDate: e.target.value }))}
            className={styles.input}
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>ช่องทางการขาย <span style={{ color: "#ff6b6b" }}>*</span></label>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {PLATFORM_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setCustomer((p) => ({ ...p, platform: opt.value }))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: customer.platform === opt.value ? "2px solid var(--accent-blue)" : "1px solid var(--border-color)",
                  background: customer.platform === opt.value ? "var(--accent-blue)" : "rgba(255,255,255,0.05)",
                  color: customer.platform === opt.value ? "#fff" : "var(--text-secondary)",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: customer.platform === opt.value ? "bold" : "normal",
                }}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
          {!customer.platform && (
            <div style={{ fontSize: "12px", color: "#ff6b6b", marginTop: "6px" }}>⚠️ ยังไม่ได้เลือกช่องทางขาย</div>
          )}
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>ชื่อบัญชี / เพจ (ถ้ามี)</label>
          <input type="text" value={customer.socialMediaName} onChange={(e) => setCustomer((p) => ({ ...p, socialMediaName: e.target.value }))} className={styles.input} placeholder="เช่น IG: john_doe" />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>ที่อยู่จัดส่ง</label>
          <textarea value={customer.customerAddress} onChange={(e) => setCustomer((p) => ({ ...p, customerAddress: e.target.value }))} className={styles.textarea} placeholder="กรอกที่อยู่ลูกค้าสำหรับจัดส่ง (ไม่ต้องใส่เบอร์โทร/รหัสไปรษณีย์ มีช่องแยกด้านล่าง)"></textarea>
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>เบอร์โทร</label>
          <input type="text" value={customer.customerPhone} onChange={(e) => setCustomer((p) => ({ ...p, customerPhone: cleanPhoneInput(e.target.value) }))} className={styles.input} placeholder="เช่น 0812345678" />
          {!isValidPhone(customer.customerPhone) && customer.customerPhone && (
            <div style={{ color: "#ff6b6b", fontSize: "12px", marginTop: "4px" }}>⚠️ เบอร์โทรต้องมี 10 หลัก</div>
          )}
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>รหัสไปรษณีย์</label>
          <input type="text" value={customer.customerZip} onChange={(e) => setCustomer((p) => ({ ...p, customerZip: cleanZipInput(e.target.value) }))} className={styles.input} placeholder="เช่น 10110" />
          {!isValidZip(customer.customerZip) && customer.customerZip && (
            <div style={{ color: "#ff6b6b", fontSize: "12px", marginTop: "4px" }}>⚠️ รหัสไปรษณีย์ต้องมี 5 หลัก</div>
          )}
        </div>
        <div className={styles.formGroup}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <input type="checkbox" checked={customer.needsTaxInvoice} onChange={(e) => setCustomer((p) => ({ ...p, needsTaxInvoice: e.target.checked }))} />
            <span className={styles.label} style={{ margin: 0 }}>🧾 ต้องการใบกำกับภาษี</span>
          </label>
        </div>

        <h3 className={styles.sectionTitle} style={{ marginTop: "20px" }}>สินค้าที่รอ</h3>
        {items.map((item, index) => {
          const resolved = resolvedItems[index];
          return (
            <div key={index} style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "10px" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label className={styles.label}>สินค้า</label>
                <select value={item.productType} onChange={(e) => updateItemLine(index, { productType: e.target.value })} className={styles.input}>
                  {Object.values(PRODUCT_TYPES).map((p) => (
                    <option key={p.code} value={p.code} style={{ color: "black" }}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: "0 1 140px" }}>
                <label className={styles.label}>น้ำหนัก (กก.)</label>
                <input type="number" step="0.01" min="0" value={item.weightKgStr} onChange={(e) => updateItemLine(index, { weightKgStr: e.target.value })} className={styles.input} placeholder="เช่น 1.5" />
              </div>
              <div style={{ flex: "0 1 140px" }}>
                <label className={styles.label}>ราคา</label>
                <div style={{ padding: "10px 12px", fontSize: "14px", fontWeight: "bold" }}>฿{formatMoney(resolved.price)}</div>
              </div>
              {items.length > 1 && (
                <button type="button" onClick={() => removeItemLine(index)} style={{ padding: "9px 12px", borderRadius: "8px", background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff6b6b", cursor: "pointer", fontSize: "13px" }}>
                  ✕ ลบ
                </button>
              )}
            </div>
          );
        })}
        <button type="button" onClick={addItemLine} style={{ marginBottom: "16px", background: "rgba(88,166,255,0.1)", border: "1px solid rgba(88,166,255,0.3)", color: "var(--accent-blue)", borderRadius: "6px", padding: "8px 14px", cursor: "pointer", fontSize: "13px" }}>
          + เพิ่มสินค้าอีกชนิด
        </button>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
          <div className={styles.formGroup}>
            <label className={styles.label}>วิธีจัดส่ง</label>
            <select value={shippingMethod} onChange={(e) => setShippingMethod(e.target.value)} className={styles.input}>
              <option value="">-- เลือกวิธีจัดส่ง --</option>
              <option value="EMS">EMS</option>
              <option value="NIM Express">NIM Express</option>
              <option value="ส่งในพื้นที่">ส่งในพื้นที่</option>
            </select>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label}>ค่าส่งเพิ่มเติม (บาท)</label>
            <input type="number" step="0.01" value={additionalShippingCostStr} onChange={(e) => setAdditionalShippingCostStr(e.target.value)} className={styles.input} placeholder="ระบบคำนวณให้อัตโนมัติเมื่อเลือกวิธีจัดส่ง" />
          </div>
        </div>

        <div className={styles.formGroup} style={{ marginTop: "12px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <input type="checkbox" checked={isCod} onChange={(e) => handleIsCodChange(e.target.checked)} />
            <span className={styles.label} style={{ margin: 0 }}>เก็บเงินปลายทาง (COD)</span>
          </label>
          <input type="number" step="0.01" value={codAmountStr} readOnly className={styles.input} placeholder="ยอดเก็บปลายทาง" style={{ marginTop: "6px", opacity: isCod ? 1 : 0.5, background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }} />
        </div>

        <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "12px", marginBottom: "4px" }}>
          ราคาสินค้ารวม: ฿{formatMoney(totalPrice)} · ค่าส่ง: ฿{formatMoney(shippingCost)} · VAT 7%: ฿{formatMoney(vatAmount)}
          {isCod && ` · เก็บปลายทาง: ฿${formatMoney(codAmount)}`}
        </div>
        <div style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "16px" }}>
          ยอดรวมที่ต้องได้รับ: ฿{formatMoney(expectedTotal)}
        </div>

        <h3 className={styles.sectionTitle} style={{ opacity: isCod ? 0.5 : 1 }}>สลิปโอนเงิน{isCod && " (ไม่ต้องใช้ — เก็บเงินปลายทาง)"}</h3>
        <div
          tabIndex={0}
          onPaste={isCod ? undefined : handleSlipPaste}
          style={{ border: "2px dashed rgba(88,166,255,0.4)", borderRadius: "8px", padding: "14px", background: "rgba(88,166,255,0.05)", opacity: isCod ? 0.5 : 1 }}
        >
          <div style={{ fontSize: "13px", color: "var(--accent-blue)", marginBottom: "10px", fontWeight: "bold" }}>
            📋 คลิกตรงนี้แล้วกด Ctrl+V เพื่อวางรูปสลิป หรือเลือกไฟล์ด้านล่าง
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <input type="file" accept="image/*" onChange={handleFileUpload} ref={fileInputRef} className={styles.input} style={{ padding: "8px" }} disabled={isUploading || isCod} />
            {isUploading && <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>กำลังอัปโหลด...</span>}
          </div>
        </div>
        {transferSlip && !isCod && (
          <div style={{ marginTop: "8px", fontSize: "12px" }}>
            <a href={transferSlip} target="_blank" rel="noreferrer" style={{ color: "var(--accent-blue)", textDecoration: "underline" }}>ดูสลิปที่อัปโหลด</a>
            <button type="button" onClick={() => { setTransferSlip(""); setSlipVerification(null); setSlipIssueReason(""); setSlipIssueOtherText(""); if (fileInputRef.current) fileInputRef.current.value = ""; }} style={{ marginLeft: "12px", background: "none", border: "none", color: "#ff6b6b", cursor: "pointer" }}>ลบสลิป</button>
          </div>
        )}
        {!isCod && <SlipVerificationBadge result={slipVerification} />}
        {!isCod && <CombinedSlipSummary totalVerified={totalVerifiedSlipAmount} expectedTotal={expectedTotal} slipCount={slipCount} />}
        {combinedHasSlipIssue && (
          <SlipIssueReasonPicker reason={slipIssueReason} onReasonChange={setSlipIssueReason} otherText={slipIssueOtherText} onOtherTextChange={setSlipIssueOtherText} />
        )}

        <div className={styles.formGroup} style={{ marginTop: "20px" }}>
          <label className={styles.label}>หมายเหตุ (ถ้ามี)</label>
          <input type="text" value={customer.note} onChange={(e) => setCustomer((p) => ({ ...p, note: e.target.value }))} className={styles.input} placeholder="เช่น นัดรับ, เงื่อนไขพิเศษ" />
        </div>

        <div style={{ marginTop: "8px" }}>
          <button
            type="submit"
            disabled={isBusy}
            style={{ padding: "9px 20px", borderRadius: "8px", background: "var(--accent-blue)", border: "none", color: "#fff", cursor: isBusy ? "wait" : "pointer", fontSize: "13px", fontWeight: "bold" }}
          >
            {editingEntryId ? "บันทึกการแก้ไข" : "+ บันทึก"}
          </button>
        </div>
        {formError && <div style={{ color: "#ff6b6b", fontSize: "13px", marginTop: "10px" }}>{formError}</div>}
      </form>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "var(--text-secondary)" }}>กำลังโหลด...</div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "12px" }}>
            <h2 style={{ fontSize: "16px", margin: 0 }}>รอส่งของ ({pending.length})</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <label style={{ fontSize: "12px", color: "var(--text-secondary)" }}>วันที่ลง order</label>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className={styles.input}
                style={{ padding: "6px 10px", fontSize: "13px" }}
              />
              {filterDate && (
                <button type="button" onClick={() => setFilterDate("")} style={{ background: "none", border: "none", color: "var(--accent-blue)", cursor: "pointer", fontSize: "12px", textDecoration: "underline" }}>
                  ล้าง
                </button>
              )}
            </div>
          </div>
          {pending.length === 0 ? (
            <div className="glass-panel" style={{ padding: "20px", borderRadius: "12px", marginBottom: "32px", color: "var(--text-secondary)", fontSize: "13px" }}>
              {filterDate ? "ไม่มีลูกค้ารอของในวันที่เลือก" : "ไม่มีลูกค้ารอของอยู่"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "32px" }}>
              {pending.map((entry) => {
                const borderColor = urgencyBorderColor(entry);
                const isOpen = assignEntryId === entry.id;
                return (
                  <div key={entry.id} className="glass-panel" style={{ borderRadius: "12px", overflow: "hidden", ...(borderColor ? { border: `2px solid ${borderColor}` } : {}) }}>
                    <div style={{ padding: "14px 18px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 320px" }}>
                        <div style={{ fontWeight: "bold", fontSize: "15px" }}>
                          {entry.customerName}
                          {entry.needsTaxInvoice && <span style={{ marginLeft: "8px", fontSize: "12px", color: "#cc9900" }}>🧾 ใบกำกับภาษี</span>}
                          {(entry.codAmount ?? 0) > 0 && <span style={{ marginLeft: "8px", fontSize: "12px", color: "#ffac33" }}>🔒 COD ฿{formatMoney(entry.codAmount)}</span>}
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--accent-blue)", fontWeight: "bold", marginTop: "2px" }}>
                          📅 วันที่ลง order: {formatDateOnly(entry.createdAt)}
                          {entry.expectedShipDate && ` · คาดว่าจะส่ง: ${formatShipDateOnly(entry.expectedShipDate)}`}
                        </div>
                        <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "6px" }}>
                          {entry.items.map((it, i) => (
                            <span key={i}>
                              {i > 0 && " · "}
                              {PRODUCT_TYPES[it.productType]?.label || it.productType} {it.weightKg} กก. (฿{formatMoney(it.price)})
                              {(it.rackDetails?.length ?? 0) > 0 && <span style={{ color: "var(--accent-green)" }}> ✓ใส่แล้ว {it.rackDetails!.length} ชิ้น</span>}
                            </span>
                          ))}
                          {entry.shippingMethod && ` · ${entry.shippingMethod} ฿${formatMoney(entry.additionalShippingCost || 0)}`}
                          {" · "}ยอดรวม ฿{formatMoney(entry.actualReceivedAmount ?? itemsTotal(entry.items))}
                          {entry.note && ` · ${entry.note}`}
                        </div>
                        {(entry.customerPhone || entry.customerAddress) && (
                          <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                            {entry.customerPhone && `☎ ${entry.customerPhone}`}
                            {entry.customerZip && ` (${entry.customerZip})`}
                            {entry.customerAddress && ` · ${entry.customerAddress}`}
                          </div>
                        )}
                        <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                          {entry.platform && `${entry.platform} · `}
                          {formatDateTime(entry.createdAt)}{entry.createdBy ? ` · ${entry.createdBy}` : ""}
                          {entry.transferSlip && (
                            <>
                              {" · "}
                              <a href={entry.transferSlip} target="_blank" rel="noreferrer" style={{ color: "var(--accent-blue)", textDecoration: "underline" }}>ดูสลิป</a>
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          type="button"
                          onClick={() => startEditEntry(entry)}
                          title="แก้ไขข้อมูลรายการนี้"
                          style={{ padding: "8px 16px", borderRadius: "8px", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "13px", fontWeight: "bold" }}
                        >
                          ✏️ แก้ไข
                        </button>
                        <button
                          type="button"
                          onClick={() => openAssignPanel(entry)}
                          style={{ padding: "8px 16px", borderRadius: "8px", background: "rgba(88,166,255,0.1)", border: "1px solid var(--accent-blue)", color: "var(--accent-blue)", cursor: "pointer", fontSize: "13px", fontWeight: "bold" }}
                        >
                          🐷 {isOpen ? "ปิด" : hasAnyStockAssigned(entry.items) ? "แก้ไขหมูที่ใส่" : "ใส่หมู"}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy || !hasAllStockAssigned(entry.items)}
                          title={hasAllStockAssigned(entry.items) ? undefined : "ต้องใส่หมูให้ครบทุกสินค้าก่อนถึงจะส่งไป packing ได้"}
                          onClick={() => setSendToPackingChoiceId(entry.id)}
                          style={{
                            padding: "8px 16px",
                            borderRadius: "8px",
                            background: hasAllStockAssigned(entry.items) ? "rgba(46,204,113,0.15)" : "rgba(255,255,255,0.04)",
                            border: `1px solid ${hasAllStockAssigned(entry.items) ? "var(--accent-green)" : "var(--border-color)"}`,
                            color: hasAllStockAssigned(entry.items) ? "var(--accent-green)" : "var(--text-secondary)",
                            cursor: isBusy ? "wait" : hasAllStockAssigned(entry.items) ? "pointer" : "not-allowed",
                            fontSize: "13px",
                            fontWeight: "bold",
                          }}
                        >
                          📦 ส่งไป packing
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => deleteEntry(entry.id)}
                          title="ลบรายการ"
                          style={{ padding: "8px 10px", borderRadius: "8px", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)", color: "var(--text-secondary)", cursor: isBusy ? "wait" : "pointer", fontSize: "13px" }}
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "14px 18px", borderTop: "1px solid var(--border-color)", background: "rgba(0,0,0,0.15)" }}>
                        {entry.items.map((item, itemIndex) => (
                          <AssignItemPicker
                            key={itemIndex}
                            item={item}
                            racks={currentUser?.racks || []}
                            selected={assignSelections[itemIndex] ?? []}
                            onToggle={(piece) => toggleAssignPiece(itemIndex, piece)}
                            onSave={() => saveAssignItem(entry.id, itemIndex)}
                            isBusy={isAssigning}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {fulfilled.length > 0 && (
            <>
              <h2 style={{ fontSize: "16px", marginBottom: "12px", color: "var(--text-secondary)" }}>ส่งไป packing แล้ว ({fulfilled.length})</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {fulfilled.map((entry) => (
                  <div key={entry.id} className="glass-panel" style={{ padding: "12px 18px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", opacity: 0.6 }}>
                    <div>
                      <div style={{ fontWeight: "bold", fontSize: "14px", textDecoration: "line-through" }}>{entry.customerName}</div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                        {entry.items.map((it, i) => (
                          <span key={i}>
                            {i > 0 && " · "}
                            {PRODUCT_TYPES[it.productType]?.label || it.productType} {it.weightKg} กก.
                          </span>
                        ))}
                        {" · "}ยอดรวม ฿{formatMoney(entry.actualReceivedAmount ?? itemsTotal(entry.items))}
                        {entry.note && ` · ${entry.note}`}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                        วันที่ลง order: {formatDateOnly(entry.createdAt)} · ส่งไป packing เมื่อ {formatDateTime(entry.fulfilledAt!)}
                        {entry.orderId && <span style={{ color: "var(--accent-green)" }}> · กลายเป็น order แล้ว</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      {entry.orderId && (
                        <button
                          type="button"
                          disabled={isLoadingOrder}
                          onClick={() => openOrderView(entry.orderId!)}
                          title="ดูข้อมูล order ที่สร้างจากรายการนี้"
                          style={{ padding: "6px 10px", borderRadius: "8px", background: "rgba(88,166,255,0.1)", border: "1px solid var(--accent-blue)", color: "var(--accent-blue)", cursor: isLoadingOrder ? "wait" : "pointer", fontSize: "12px", fontWeight: "bold" }}
                        >
                          📄 ดูข้อมูล order
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => deleteEntry(entry.id)}
                        title="ลบรายการ (ไม่กระทบ order จริงที่สร้างไปแล้ว)"
                        style={{ padding: "6px 8px", borderRadius: "8px", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)", color: "var(--text-secondary)", cursor: isBusy ? "wait" : "pointer", fontSize: "12px" }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {alertMessage && (
        <div className={styles.modalOverlay}>
          <div className={styles.alertBox}>
            <div className={styles.alertIcon}>!</div>
            <h3 className={styles.alertTitle}>รายการนี้มีความเสี่ยงบันทึกซ้ำ</h3>
            <p className={styles.alertText}>{alertMessage}</p>
            <div className={styles.alertActions}>
              <button className={styles.btnCancel} onClick={() => setAlertMessage(null)}>
                ยกเลิก
              </button>
              <button className={styles.btnConfirm} onClick={handleConfirmDuplicate} disabled={isBusy}>
                บันทึกต่อไป
              </button>
            </div>
          </div>
        </div>
      )}

      {sendToPackingChoiceId && (() => {
        const targetEntry = entries.find((e) => e.id === sendToPackingChoiceId);
        const confirmChoice = (shipToday: boolean) => {
          setSendToPackingChoiceId(null);
          sendToPacking(sendToPackingChoiceId, shipToday);
        };
        return (
          <div className={styles.modalOverlay}>
            <div className={styles.alertBox}>
              <div className={styles.alertIcon}>📦</div>
              <h3 className={styles.alertTitle}>ส่งไป packing วันไหน?</h3>
              <p className={styles.alertText}>
                {targetEntry?.customerName || "รายการนี้"} — เลือกว่าจะให้ไปโผล่ในหน้า Packing วันนี้เลย (ส่งด่วน) หรือพรุ่งนี้ (ตามปกติ)
              </p>
              <div className={styles.alertActions}>
                <button className={styles.btnCancel} onClick={() => setSendToPackingChoiceId(null)} disabled={isBusy}>
                  ยกเลิก
                </button>
                <button
                  onClick={() => confirmChoice(true)}
                  disabled={isBusy}
                  style={{ padding: "10px 18px", borderRadius: "8px", background: "rgba(255,159,67,0.15)", border: "1px solid #ff9f43", color: "#ff9f43", cursor: isBusy ? "wait" : "pointer", fontSize: "13px", fontWeight: "bold" }}
                >
                  ⚡ วันนี้ (ด่วน)
                </button>
                <button className={styles.btnConfirm} onClick={() => confirmChoice(false)} disabled={isBusy}>
                  พรุ่งนี้ (ปกติ)
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {viewingOrder && (() => {
        const statusInfo = getOrderStatusInfo(viewingOrder.orderStatus || undefined);
        return (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.85)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }} onClick={() => setViewingOrder(null)}>
            <div style={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: "12px", maxWidth: "760px", width: "92%", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "4px" }}>ออเดอร์ {viewingOrder.orderNo || "-"}</div>
                  <h3 style={{ fontSize: "1.3rem", marginBottom: "10px" }}>{viewingOrder.customerName}</h3>
                  <span style={{ display: "inline-block", fontSize: "12px", fontWeight: "bold", color: statusInfo.color, background: statusInfo.bg, padding: "4px 12px", borderRadius: "999px" }}>
                    {statusInfo.label}
                  </span>
                </div>
                <button onClick={() => setViewingOrder(null)} style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: "20px", cursor: "pointer", lineHeight: 1 }}>✕</button>
              </div>
              <div style={{ padding: "20px 24px", overflowY: "auto" }}>
                <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
                  <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: "10px", padding: "12px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: "19px", fontWeight: "bold", color: "#fff" }}>฿{formatMoney(viewingOrder.price)}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px" }}>ราคาสินค้า</div>
                  </div>
                  <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: "10px", padding: "12px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: "19px", fontWeight: "bold", color: "#fff" }}>฿{formatMoney(viewingOrder.codAmount)}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px" }}>เก็บปลายทาง</div>
                  </div>
                  <div style={{ flex: 1, background: "rgba(63,185,80,0.12)", border: "1px solid rgba(63,185,80,0.35)", borderRadius: "10px", padding: "12px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: "19px", fontWeight: "bold", color: "var(--accent-green)" }}>฿{formatMoney(viewingOrder.actualReceivedAmount)}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px" }}>ยอดรับจริง</div>
                  </div>
                </div>

                {Number(viewingOrder.codAmount) > 0 && (
                  <div style={{ marginBottom: "24px", marginTop: "-12px", fontSize: "13px" }}>
                    {viewingOrder.codConfirmed ? (
                      <span style={{ color: "var(--accent-green)" }}>✅ ยืนยันรับ COD แล้ว — นับเข้ายอดขายแล้ว</span>
                    ) : (
                      <span style={{ color: "#ffac33" }}>🔒 รอยืนยันรับ COD — ยังไม่นับเข้ายอดขาย (Hold ไว้)</span>
                    )}
                  </div>
                )}

                <DetailSection title="ข้อมูลลูกค้า">
                  <DetailRow label="ช่องทาง" value={viewingOrder.platform || "-"} />
                  <DetailRow label="ชื่อบัญชี" value={viewingOrder.socialMediaName || "-"} />
                  <DetailRow label="ที่อยู่" value={viewingOrder.customerAddress || "-"} />
                  <DetailRow label="ใบกำกับภาษี" value={viewingOrder.needsTaxInvoice ? <span style={{ color: "#ffac33", fontWeight: "bold" }}>🧾 ต้องการ</span> : "ไม่ต้องการ"} />
                </DetailSection>

                <DetailSection title="สินค้า">
                  <DetailRow label="น้ำหนัก" value={`${viewingOrder.crispyPorkWeight || "-"} กก.`} />
                  <DetailRow label="จำนวนชิ้น" value={viewingOrder.crispyPorkPiece || "-"} />
                </DetailSection>

                <DetailSection title="การจัดส่ง">
                  <DetailRow label="วิธีจัดส่ง" value={viewingOrder.shippingMethod || "-"} />
                  <DetailRow
                    label="เลขพัสดุ"
                    value={viewingOrder.trackingNumber ? <span style={{ color: "var(--accent-green)", fontWeight: "bold" }}>{viewingOrder.trackingNumber}</span> : "-"}
                  />
                  <DetailRow
                    label="สลิปโอนเงิน"
                    value={viewingOrder.transferSlip ? <a href={viewingOrder.transferSlip} target="_blank" rel="noreferrer" style={{ color: "var(--accent-blue)", textDecoration: "underline" }}>ดูสลิป</a> : "-"}
                  />
                </DetailSection>

                {viewingOrder.adminNote && (
                  <div style={{ background: "rgba(255,172,51,0.1)", border: "1px solid #ffac33", padding: "10px 12px", borderRadius: "8px", color: "#ffac33", fontSize: "14px" }}>
                    <span style={{ fontWeight: "bold" }}>⚠️ หมายเหตุแอดมิน:</span> {viewingOrder.adminNote}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {showSaveToast && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "var(--success-color)",
            color: "#fff",
            padding: "22px 40px",
            borderRadius: "16px",
            fontSize: "22px",
            fontWeight: 700,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            gap: "12px",
            animation: "toastPop 0.2s ease-out",
            pointerEvents: "none",
          }}
        >
          ✓ บันทึกข้อมูลสำเร็จ
        </div>
      )}
    </div>
  );
}
