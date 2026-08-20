"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "../app/page.module.css";
import { useUser } from "./UserProvider";
import { useSettings } from "./SettingsProvider";
import { isSuperAdminRole } from "../lib/roles";
import { BASE_PATH } from "../lib/basePath";
import { calculateCodAmount, AppSettings, computeVatAmount, computeActualReceivedAmount, getPricePerKg } from "../lib/money";
import { calculateShippingCost, computeBoxCount, MAX_WEIGHT_PER_BOX_KG } from "../lib/shipping";
import { computeRackAllocation, buildAllocationDiffNote, MAX_OVER_DEVIATION_KG, MIN_UNDER_DEVIATION_KG, MAX_UNDER_DEVIATION_KG } from "../lib/rackAllocate";
import { sumUsableSlipAmounts, isTotalAmountMatched, hasAnySlipIssue, buildSlipIssueNote, isSlipIssueReasonComplete, SLIP_ISSUE_OTHER } from "../lib/slipVerification";
import { nextDayStr, previousDayStr } from "../lib/packingCutoff";
import { isValidPhone, isValidZip, cleanPhoneInput, cleanZipInput } from "../lib/addressParse";
import { formatMoney, getOrderStatusInfo, DetailSection, DetailRow } from "./OrderDetailShared";
import { getEffectiveItems, sumItemsWeight } from "../lib/orderItems";
import { PRODUCT_TYPES, DEFAULT_PRODUCT_TYPE, parseRackCode, getBaseRackKeyAuto } from "../lib/rackCode";
import PetCorner from "./PetCorner";
import { PLATFORM_OPTIONS } from "./PlatformIcons";
import { SlipVerificationBadge, CombinedSlipSummary, SlipIssueReasonPicker } from "./SlipVerification";
import { RackPiece, AssignItemPicker } from "./AssignStockPicker";

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
  shippingMethod?: string;
  createdAt: string;
  isClaim?: boolean;
}

interface RackDetail {
  rackNo: string;
  weight: number;
  assignmentId: string;
}

// One product line within an order — an order is 1+ of these. "AUTO"
// promotion means "compute this line's price from its product's rate in
// Settings"; anything else (just "") means the admin types the price by
// hand for that line, same override capability the old single-item price
// field used to give at the whole-order level.
interface OrderLineItem {
  productType: string;
  promotion: "AUTO" | "";
  weightStr: string;
  priceStr: string;
  rackDetails: RackDetail[];
  allocationMode: 'weight' | 'count' | null;
  desiredPieceCount: string;
  pieceSortOrder: 'asc' | 'desc';
  weightSearch: string;
}

function makeDefaultLineItem(productType: string): OrderLineItem {
  return {
    productType,
    promotion: "AUTO",
    weightStr: "",
    priceStr: "",
    rackDetails: [],
    allocationMode: null,
    desiredPieceCount: "",
    pieceSortOrder: 'desc',
    weightSearch: "",
  };
}

// Recomputes one line item's price from its own weight/product rate — the
// per-line replacement for the old single computeWeightDerivedFields, used
// whenever that line's weight, promotion, or product changes. Only touches
// price; COD/shipping are order-level (courier boxes by total kg, not by
// product) and derived separately from the combined weight below.
function computeItemPrice(item: Pick<OrderLineItem, 'promotion' | 'weightStr' | 'productType' | 'priceStr'>, settings: AppSettings): string {
  if (item.promotion !== "AUTO") return item.priceStr;
  const parsedWeight = parseFloat(item.weightStr);
  if (isNaN(parsedWeight) || parsedWeight <= 0) return item.priceStr;
  return (parsedWeight * getPricePerKg(item.productType, settings)).toFixed(2);
}

// True for an order that claims a real weight was sold but has zero actual
// rack stock behind it — the gap POST /api/orders' own "no real stock"
// check now blocks going forward (see handleSubmit's itemWithNoStock
// check), but an order created before that check existed can still be
// sitting in this state. Drives both the list's red-border flag and the
// detail view's "เติมหมู" banner below.
function orderHasNoRealStock(order: any): boolean {
  const weight = parseFloat(order?.crispyPorkWeight) || 0;
  if (weight <= 0) return false;
  if (!order.rackDetails) return true;
  try {
    const parsed = JSON.parse(order.rackDetails);
    if (!Array.isArray(parsed)) return true;
    const total = parsed.reduce((sum: number, r: any) => sum + (Number(r?.weight) || 0), 0);
    return total <= 0;
  } catch (e) {
    return true;
  }
}




// `mode="normal"` is the full order-entry form (Order Details page).
// `mode="walkin"` is the fixed, always-on walk-in/private-client sale form
// (Private Clients page) — same picker/VAT/submit logic, just permanently in
// the simplified storefront-style flow with no toggle back to normal mode.
export default function OrderEntryForm({ mode }: { mode: "normal" | "walkin" }) {
  const initialForm = {
    customerName: "",
    // "PrivateClient" is its own distinct value, deliberately not
    // "Storefront" — Private Clients and the actual Store Front page used to
    // share the same platform value and couldn't be told apart; this keeps
    // them in fully separate queries (see fetchOrders below and the
    // excludePlatform list on Order Details' own fetch).
    platform: mode === "walkin" ? "PrivateClient" : "",
    socialMediaName: "",
    crispyPorkPiece: "",
    crispyPorkWeight: "",
    packedPork: "",
    price: "",
    shippingMethod: mode === "walkin" ? "รับหน้าร้าน" : "",
    additionalShippingCost: "",
    isCod: false,
    codAmount: "",
    vatAmount: "",
    actualReceivedAmount: "",
    transferSlip: "",
    paymentStatus: mode === "walkin" ? "Paid" : "",
    customerAddress: "",
    customerPhone: "",
    customerZip: "",
    needsTaxInvoice: false,
    orderStatus: "",
    sellerName: "",
    trackingNumber: "",
    adminNote: "",
    entryDate: "",
    // A free replacement for a customer's quality complaint ("ลูกค้าเคลม") —
    // real pork still gets picked from stock exactly like a normal order,
    // only the money side is zeroed (see the effect below and handleSubmit's
    // own override — the server also force-zeroes it independently, see
    // POST /api/orders).
    isClaim: false,
  };

  const isStorefrontMode = mode === "walkin";
  const [formData, setFormData] = useState(initialForm);
  // One or more product lines making up this order — see OrderLineItem.
  // formData.crispyPorkWeight/crispyPorkPiece/price are kept in sync as the
  // SUM across these (see the aggregate effect below) so every downstream
  // consumer of those 3 fields (VAT/total effect, box-count check, submit
  // body) keeps working unchanged.
  const [items, setItems] = useState<OrderLineItem[]>([makeDefaultLineItem(DEFAULT_PRODUCT_TYPE)]);
  // Which product "คลังหมูของฉัน" is currently browsing — deliberately NOT
  // tied to a line-item index. Looking at a product with no line yet just
  // shows its stock (see the panel's own hasRealItem check below); a real
  // line only gets created the moment a piece is actually picked, not on
  // every tab click, so browsing never adds an unwanted empty line.
  const [viewProductType, setViewProductType] = useState(DEFAULT_PRODUCT_TYPE);
  // "หาชิ้นใกล้เคียงน้ำหนัก" input's value while browsing a product with no
  // real line yet — once a real line exists, its own weightSearch field
  // (on the OrderLineItem) takes over instead of this.
  const [previewWeightSearch, setPreviewWeightSearch] = useState("");
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [showUnpaidOnly, setShowUnpaidOnly] = useState(false);
  const [filterShippingMethod, setFilterShippingMethod] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [slipVerification, setSlipVerification] = useState<any | null>(null);
  const [slipIssueReason, setSlipIssueReason] = useState("");
  const [slipIssueOtherText, setSlipIssueOtherText] = useState("");
  // Extra slips beyond the primary one (formData.transferSlip) — only used
  // when a customer paid short and transferred the rest separately.
  const [extraSlips, setExtraSlips] = useState<{ url: string; verification: any; uploading?: boolean }[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  // "เติมหมู" picker for an order that has zero real rack stock behind its
  // claimed weight (see orderHasNoRealStock) — seeded with an auto-allocated
  // suggestion (same nearest-weight matching Order Entry's own create flow
  // uses) whenever a different order with this problem is opened, so an
  // admin usually just confirms rather than hand-picking from scratch.
  const [assignOrderSelections, setAssignOrderSelections] = useState<RackPiece[]>([]);
  const [isAssigningOrderStock, setIsAssigningOrderStock] = useState(false);
  // Opened by the detail view's 🗑️ ลบ button — the actual delete only fires
  // once the popup's "กรอกข้อมูลผิด" / "ยกเลิกจริง คืนเงิน" choice is made
  // (same pattern as app/packing/page.tsx's own delete-choice popup).
  const [deleteChoiceOrder, setDeleteChoiceOrder] = useState<any | null>(null);
  const [isDeletingOrder, setIsDeletingOrder] = useState(false);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [editOrderData, setEditOrderData] = useState<any | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isEditUploading, setIsEditUploading] = useState(false);
  const [editSlipVerification, setEditSlipVerification] = useState<any | null>(null);
  const [editSlipIssueReason, setEditSlipIssueReason] = useState("");
  const [editSlipIssueOtherText, setEditSlipIssueOtherText] = useState("");
  const [editExtraSlips, setEditExtraSlips] = useState<{ url: string; verification: any; uploading?: boolean }[]>([]);
  const [alertData, setAlertData] = useState({
    show: false,
    message: "",
    customerName: "",
  });
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

  const [filterAdminName, setFilterAdminName] = useState("");
  // Order Details' date filter means "วันที่จะจัดส่ง" (shipping date, same
  // framing Packing uses) — an order entered today ships tomorrow, so this
  // defaults to tomorrow too, matching what Packing's own picker defaults
  // to for that same freshly-entered batch. Private Clients (mode="walkin")
  // keeps the old createdAt-based "today" filter — those are same-day
  // pickup/counter sales with no real next-day shipping concept.
  const [filterDate, setFilterDate] = useState(() => {
    const today = new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" });
    const d = new Date(today);
    const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return mode === "normal" ? nextDayStr(todayStr) : todayStr;
  });
  const [customerSearchInput, setCustomerSearchInput] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showInventory, setShowInventory] = useState(false);
  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const [isOrdersModalFullscreen, setIsOrdersModalFullscreen] = useState(false);
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
      setFormData(prev => ({
        ...prev,
        sellerName: currentUser.name,
        // Only fills in a still-empty platform — never overwrites a channel
        // the admin already picked for the order in progress. This effect
        // re-fires on every currentUser refresh (fetchUsers() runs after
        // every order save), which is also what makes the default reapply
        // once the form resets back to an empty platform after each save.
        platform: (!isStorefrontMode && !prev.platform && currentUser.defaultPlatform) ? currentUser.defaultPlatform : prev.platform,
      }));
    }
  }, [currentUser]);

  useEffect(() => {
    const p = parseFloat(formData.price) || 0;
    const s = parseFloat(formData.additionalShippingCost) || 0;
    const c = parseFloat(formData.codAmount) || 0;

    if (formData.price !== "" || formData.additionalShippingCost !== "" || formData.codAmount !== "") {
      const vat = computeVatAmount(p, s);
      // .50 ขึ้นไปปัดขึ้น ต่ำกว่าปัดลง (Math.round already rounds half-up for positive amounts)
      const roundedTotal = computeActualReceivedAmount(p, s, c);
      setFormData(prev => ({
        ...prev,
        vatAmount: vat.toFixed(2),
        actualReceivedAmount: roundedTotal.toString()
      }));
    } else if (formData.vatAmount !== "") {
      setFormData(prev => ({ ...prev, vatAmount: "" }));
    }
  }, [formData.price, formData.additionalShippingCost, formData.codAmount]);

  // Keeps the order-level aggregate fields in sync with the sum across line
  // items — every downstream reader (VAT/total effect above, box-count
  // check, submit body, the read-only "จำนวนชิ้น" display) keeps working
  // against these 3 fields exactly as before, unaware there's more than one
  // product line behind them. Writes to formData (not items), so this can
  // never self-trigger a loop.
  useEffect(() => {
    const totalWeight = items.reduce((sum, it) => sum + (parseFloat(it.weightStr) || 0), 0);
    const totalPieces = items.reduce((sum, it) => sum + it.rackDetails.length, 0);
    const totalPrice = items.reduce((sum, it) => sum + (parseFloat(it.priceStr) || 0), 0);
    const weightStr = totalWeight > 0 ? String(Number(totalWeight.toFixed(2))) : "";
    const priceStr = totalPrice > 0 ? totalPrice.toFixed(2) : "";
    const pieceStr = String(totalPieces);
    setFormData(prev => {
      if (prev.crispyPorkWeight === weightStr && prev.crispyPorkPiece === pieceStr && prev.price === priceStr) return prev;
      return { ...prev, crispyPorkWeight: weightStr, crispyPorkPiece: pieceStr, price: priceStr };
    });
  }, [items]);

  // Seeds the "เติมหมู" picker with an auto-allocated suggestion (same
  // nearest-weight matching the create flow's own auto-allocation uses)
  // whenever a different order missing real stock is opened — an admin
  // usually just confirms rather than hand-picking from scratch. Targets
  // the order's first product line, since Order.rackDetails is one flat
  // pool for the whole order rather than itemized per line (see the
  // assign-stock route's own comment on why).
  useEffect(() => {
    if (!selectedOrder || !orderHasNoRealStock(selectedOrder)) {
      setAssignOrderSelections([]);
      return;
    }
    const effectiveItems = getEffectiveItems(selectedOrder);
    const targetProductType = effectiveItems[0]?.productType || DEFAULT_PRODUCT_TYPE;
    const targetWeight = sumItemsWeight(effectiveItems);
    const matchingRacks = (currentUser?.racks || []).filter((r: any) => (r.productType || DEFAULT_PRODUCT_TYPE) === targetProductType);
    setAssignOrderSelections(targetWeight > 0 ? computeRackAllocation(matchingRacks as any, targetWeight) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrder?.id]);

  // COD/shipping are order-level, not per-line — a courier boxes and
  // collects cash by total kg regardless of product mix — so they derive
  // from the combined weight rather than from any one line item. Mirrors
  // the old handleChange's crispyPorkWeight/shippingMethod branches, just
  // moved to an effect since weight is no longer a single directly-typed
  // input. Never touches a value the admin edited by hand otherwise.
  useEffect(() => {
    const weight = parseFloat(formData.crispyPorkWeight) || 0;
    const method = formData.shippingMethod;
    setFormData(prev => {
      let additionalShippingCost = prev.additionalShippingCost;
      if (method === "ส่งในพื้นที่") {
        additionalShippingCost = calculateShippingCost(method, 0).toFixed(2);
      } else if ((method === "EMS" || method === "NIM Express") && weight > 0) {
        additionalShippingCost = calculateShippingCost(method, weight).toFixed(2);
      } else if (method !== "EMS" && method !== "NIM Express" && method !== "ส่งในพื้นที่") {
        additionalShippingCost = "";
      }
      let codAmount = prev.codAmount;
      if (prev.isCod && weight > 0) {
        codAmount = calculateCodAmount(weight, settings).toFixed(2);
      }
      if (additionalShippingCost === prev.additionalShippingCost && codAmount === prev.codAmount) return prev;
      return { ...prev, additionalShippingCost, codAmount };
    });
  }, [formData.crispyPorkWeight, formData.shippingMethod, formData.isCod, settings]);

  // A claim never collects any money — COD makes no sense on a free
  // replacement, and there's nothing to owe, so payment status is trivially
  // "Paid". Only fires forward (checking the box clears these); unchecking
  // deliberately leaves them as-is rather than guessing what the admin meant
  // to restore, same as every other "clear on uncheck" field in this form.
  useEffect(() => {
    if (!formData.isClaim) return;
    setFormData(prev => {
      if (!prev.isCod && prev.codAmount === "" && prev.additionalShippingCost === "0" && prev.paymentStatus === "Paid") return prev;
      return { ...prev, isCod: false, codAmount: "", additionalShippingCost: "0", paymentStatus: "Paid" };
    });
  }, [formData.isClaim]);

  const fetchOrders = async (adminName?: string, date?: string, customerNameSearch?: string) => {
    try {
      const params = new URLSearchParams();
      if (adminName) params.set("sellerName", adminName);
      if (date) {
        // filterDate is a shipping date in mode="normal" — convert to the
        // entryDate it actually maps to (shipping day minus 1), same
        // conversion Packing's own date picker does.
        if (mode === "normal") params.set("entryDate", previousDayStr(date));
        else params.set("date", date);
      }
      if (customerNameSearch) params.set("customerName", customerNameSearch);
      // Each page's own order list only shows what it's responsible for —
      // Private Clients sees only its own PrivateClient-platform walk-in
      // sales, Order Details sees everything except that AND the actual
      // Store Front page's own Storefront-platform sales.
      if (mode === "walkin") params.set("platform", "PrivateClient");
      else params.set("excludePlatform", "Storefront,PrivateClient");
      const qs = params.toString();
      const url = qs ? `${BASE_PATH}/api/orders?${qs}` : `${BASE_PATH}/api/orders`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.orders) {
        setRecentOrders(data.orders);
      }
    } catch (err) {
      console.error("Failed to fetch orders", err);
    }
  };

  const updateItem = (index: number, patch: Partial<OrderLineItem>) => {
    setItems(prev => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  // Re-derives one item's weight/price from its rackDetails total — used for
  // every DISCRETE action that changes which pieces are selected (manual
  // add/remove/change, toggling a piece from the search panel, auto-select-
  // by-count). Never used for the typing-driven weight flow, which must not
  // fight the admin's keystrokes (see handleItemWeightChange).
  const syncItemFromRackDetails = (index: number, newRackDetails: RackDetail[]) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== index) return it;
      const totalWeight = Number(newRackDetails.reduce((sum, r) => sum + (r.weight || 0), 0).toFixed(2));
      const weightStr = totalWeight > 0 ? String(totalWeight) : "";
      const priceStr = computeItemPrice({ ...it, weightStr }, settings);
      return {
        ...it,
        rackDetails: newRackDetails,
        weightStr,
        priceStr,
        allocationMode: newRackDetails.length === 0 ? null : it.allocationMode,
        desiredPieceCount: newRackDetails.length === 0 ? "" : it.desiredPieceCount,
      };
    }));
  };

  const autoAllocateRacksForItem = (index: number, productType: string, targetWeight: number) => {
    if (!currentUser || !currentUser.racks) return;
    const productRacks = currentUser.racks.filter((r: any) => (r.productType || DEFAULT_PRODUCT_TYPE) === productType);
    updateItem(index, { rackDetails: computeRackAllocation(productRacks as any, targetWeight) });
  };

  // Alternative to picking by weight: grab the N lightest or N heaviest
  // available pieces of that item's product, then derive weight/price from
  // whatever that comes out to.
  const autoAllocateRacksByCountForItem = (index: number, productType: string, count: number, order: 'asc' | 'desc') => {
    if (!currentUser || !currentUser.racks) return;

    const availableRacks = currentUser.racks
      .filter((r: any) => (r.productType || DEFAULT_PRODUCT_TYPE) === productType && !r.isUsedUp && r.remainingWeight > 0)
      .sort((a: any, b: any) => order === 'asc' ? a.remainingWeight - b.remainingWeight : b.remainingWeight - a.remainingWeight);

    const selected = availableRacks.slice(0, count);
    const newAllocation: RackDetail[] = selected.map((rack: any) => ({
      assignmentId: rack.id,
      rackNo: rack.rackNo,
      weight: rack.remainingWeight,
    }));
    syncItemFromRackDetails(index, newAllocation);
  };

  const handlePieceCountChangeForItem = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const productType = items[index].productType;
    const count = parseInt(value, 10);
    if (!isNaN(count) && count > 0) {
      updateItem(index, { desiredPieceCount: value, allocationMode: 'count' });
      autoAllocateRacksByCountForItem(index, productType, count, items[index].pieceSortOrder);
    } else {
      updateItem(index, { desiredPieceCount: value, allocationMode: null, rackDetails: [], weightStr: "" });
    }
  };

  const handlePieceSortOrderChangeForItem = (index: number, order: 'asc' | 'desc') => {
    updateItem(index, { pieceSortOrder: order });
    const item = items[index];
    const count = parseInt(item.desiredPieceCount, 10);
    if (!isNaN(count) && count > 0) {
      autoAllocateRacksByCountForItem(index, item.productType, count, order);
    }
  };

  // The one place a line item's weight is directly typed — deliberately
  // separate from syncItemFromRackDetails (which derives weight FROM the
  // pieces), since here the typed number is the source of truth and must
  // never get fought mid-keystroke by a re-derive from whatever the
  // allocator happened to land on.
  const handleItemWeightChange = (index: number, value: string) => {
    const trimmed = value.trim();
    setItems(prev => prev.map((it, i) => {
      if (i !== index) return it;
      const priceStr = computeItemPrice({ ...it, weightStr: value }, settings);
      return {
        ...it,
        weightStr: value,
        priceStr,
        allocationMode: trimmed !== "" ? 'weight' : null,
        desiredPieceCount: trimmed === "" ? "" : it.desiredPieceCount,
      };
    }));

    const parsedWeight = parseFloat(trimmed);
    if (!isNaN(parsedWeight) && parsedWeight > 0) {
      autoAllocateRacksForItem(index, items[index].productType, parsedWeight);
    } else {
      updateItem(index, { rackDetails: [] });
    }
  };

  const handleItemPromotionChange = (index: number, promotion: "AUTO" | "") => {
    const item = items[index];
    const priceStr = computeItemPrice({ ...item, promotion }, settings);
    updateItem(index, { promotion, priceStr });
  };

  const handleItemProductChange = (index: number, productType: string) => {
    const item = items[index];
    const priceStr = computeItemPrice({ ...item, productType }, settings);
    // Clears any already-picked pieces — they belong to the old product and
    // would silently mismatch this line's new one otherwise.
    updateItem(index, { productType, priceStr, rackDetails: [], allocationMode: null, desiredPieceCount: "" });
  };

  const addLineItem = () => {
    setItems(prev => {
      const usedTypes = new Set(prev.map(it => it.productType));
      const nextType = Object.keys(PRODUCT_TYPES).find(t => !usedTypes.has(t)) || DEFAULT_PRODUCT_TYPE;
      return [...prev, makeDefaultLineItem(nextType)];
    });
  };

  // Switches "คลังหมูของฉัน" to browse a specific product's stock — purely a
  // view switch, no line item created. Lets an admin check every product's
  // stock levels without first needing to commit an "เพิ่มสินค้าอีกชนิด" line
  // for it (a real line only appears once a piece is actually picked — see
  // the panel's own handlePieceClick below).
  const selectPanelProductType = (productType: string) => {
    setViewProductType(productType);
  };

  const removeLineItem = (index: number) => {
    setItems(prev => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const target = e.target as HTMLInputElement;
    const name = target.name;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleIsCodChange = (checked: boolean) => {
    setFormData(prev => {
      const next = { ...prev, isCod: checked, paymentStatus: checked ? "COD" : (prev.paymentStatus === "COD" ? "" : prev.paymentStatus) };
      if (!checked) next.codAmount = "";
      return next;
    });
  };

  // Best-effort check via Thunder Solution — never blocks saving the order,
  // just surfaces a warning if the slip looks off so the admin can double-check.
  // NOTE: requires `url` to be publicly reachable (Thunder fetches it
  // themselves) — won't resolve on localhost without a tunnel like ngrok.
  const verifySlip = async (url: string, matchAmount?: number) => {
    try {
      const res = await fetch(`${BASE_PATH}/api/verify-slip`, {
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

  const uploadSlipFile = async (file: File) => {
    setIsUploading(true);
    setSlipVerification(null);
    setSlipIssueReason("");
    setSlipIssueOtherText("");
    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch(`${BASE_PATH}/api/upload`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (data.url) {
        setFormData(prev => ({ ...prev, transferSlip: data.url, paymentStatus: "Paid" }));
        // /api/upload returns a basePath-prefixed path like
        // "/admin/api/uploads/xxx.jpg" — Thunder needs a full absolute URL,
        // not a bare path. No matchAmount here anymore — with a second slip
        // now possible, per-slip amount-matching doesn't make sense; the
        // combined total across every slip is checked separately instead
        // (see CombinedSlipSummary / lib/slipVerification.ts).
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

  // Lets an admin copy a slip image straight from a chat app and paste it
  // here (Ctrl+V) instead of having to save it to disk first, then browse
  // for it — same upload + Thunder verification pipeline either way.
  const handleSlipPaste = (e: React.ClipboardEvent) => {
    if (isUploading || formData.paymentStatus === "Unpaid" || formData.paymentStatus === "COD") return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          uploadSlipFile(file);
        }
        return;
      }
    }
  };

  // Adds an empty extra-slip slot — for when a customer paid short the
  // first time and transferred the rest separately.
  const addExtraSlipSlot = () => {
    setExtraSlips(prev => [...prev, { url: "", verification: null }]);
  };

  const removeExtraSlip = (index: number) => {
    setExtraSlips(prev => prev.filter((_, i) => i !== index));
  };

  const uploadExtraSlipFile = async (index: number, file: File) => {
    setExtraSlips(prev => prev.map((s, i) => i === index ? { ...s, uploading: true, verification: null } : s));
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${BASE_PATH}/api/upload`, { method: "POST", body: form });
      const data = await res.json();
      if (data.url) {
        setExtraSlips(prev => prev.map((s, i) => i === index ? { ...s, url: data.url, uploading: false } : s));
        const absoluteSlipUrl = data.url.startsWith("http") ? data.url : `${window.location.origin}${data.url}`;
        const result = await verifySlip(absoluteSlipUrl);
        setExtraSlips(prev => prev.map((s, i) => i === index ? { ...s, verification: result } : s));
      } else {
        alert("อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        setExtraSlips(prev => prev.map((s, i) => i === index ? { ...s, uploading: false } : s));
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะอัปโหลดไฟล์");
      setExtraSlips(prev => prev.map((s, i) => i === index ? { ...s, uploading: false } : s));
    }
  };

  const handleExtraSlipFileInput = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadExtraSlipFile(index, file);
  };

  const handleExtraSlipPaste = (index: number, e: React.ClipboardEvent) => {
    if (extraSlips[index]?.uploading) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          uploadExtraSlipFile(index, file);
        }
        return;
      }
    }
  };

  const handleStartEditOrder = () => {
    setEditOrderData({ ...selectedOrder });
    setIsEditingOrder(true);
    setEditSlipVerification(null);
    setEditSlipIssueReason("");
    setEditSlipIssueOtherText("");
    // Existing extra slips already saved on this order carry over into the
    // edit form as already-uploaded (no re-verification needed unless the
    // admin explicitly replaces one — verification is just advisory).
    setEditExtraSlips((selectedOrder?.extraSlips || []).map((s: any) => ({ url: s.url, verification: null })));
  };

  const handleCancelEditOrder = () => {
    setIsEditingOrder(false);
    setEditOrderData(null);
    setEditSlipVerification(null);
    setEditSlipIssueReason("");
    setEditSlipIssueOtherText("");
    setEditExtraSlips([]);
  };

  const handleCloseOrderDetail = () => {
    setSelectedOrder(null);
    setIsEditingOrder(false);
    setEditOrderData(null);
    setEditSlipVerification(null);
    setEditSlipIssueReason("");
    setEditSlipIssueOtherText("");
    setEditExtraSlips([]);
  };

  const handleToggleOrderStockPiece = (piece: RackPiece) => {
    setAssignOrderSelections((prev) =>
      prev.some((p) => p.assignmentId === piece.assignmentId)
        ? prev.filter((p) => p.assignmentId !== piece.assignmentId)
        : [...prev, piece]
    );
  };

  // Saves the "เติมหมู" picker's selection onto an already-placed order —
  // see app/api/orders/[id]/assign-stock's own comment for why this exists
  // (retrofitting real stock onto an order that has none) and why it's one
  // flat pool rather than itemized per line.
  const handleSaveOrderStock = async () => {
    if (!selectedOrder) return;
    setIsAssigningOrderStock(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/orders/${selectedOrder.id}/assign-stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rackDetails: assignOrderSelections }),
      });
      const data = await res.json();
      if (res.ok) {
        setSelectedOrder(data.order);
        flashSaveToast();
        await fetchUsers(); // Refresh currentUser.racks so the picker reflects the new remaining weights
        const dateForFetch = customerSearch ? undefined : filterDate;
        if (isSuperAdminRole(currentUser?.role)) {
          fetchOrders(filterAdminName, dateForFetch, customerSearch);
        } else {
          fetchOrders(currentUser?.name, dateForFetch, customerSearch);
        }
      } else {
        alert(data.error || "เติมหมูไม่สำเร็จ");
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะเติมหมู");
    } finally {
      setIsAssigningOrderStock(false);
    }
  };

  const confirmDeleteOrder = async (order: any, reason: "mistake" | "cancelled") => {
    setDeleteChoiceOrder(null);
    setIsDeletingOrder(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/orders/${order.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (res.ok) {
        handleCloseOrderDetail();
        const dateForFetch = customerSearch ? undefined : filterDate;
        if (isSuperAdminRole(currentUser?.role)) {
          fetchOrders(filterAdminName, dateForFetch, customerSearch);
        } else {
          fetchOrders(currentUser?.name, dateForFetch, customerSearch);
        }
      } else {
        alert(data.error || "ลบออเดอร์ไม่สำเร็จ");
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะลบออเดอร์");
    } finally {
      setIsDeletingOrder(false);
    }
  };

  // Same "uploading a slip means it's paid" rule as the main new-order form —
  // covers the case where a customer sends the slip after the order was
  // already saved as unpaid.
  const uploadEditSlipFile = async (file: File) => {
    setIsEditUploading(true);
    setEditSlipVerification(null);
    setEditSlipIssueReason("");
    setEditSlipIssueOtherText("");
    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch(`${BASE_PATH}/api/upload`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (data.url) {
        setEditOrderData((prev: any) => ({ ...prev, transferSlip: data.url, paymentStatus: "Paid" }));
        const absoluteSlipUrl = data.url.startsWith("http") ? data.url : `${window.location.origin}${data.url}`;
        const result = await verifySlip(absoluteSlipUrl);
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

  const handleEditFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadEditSlipFile(file);
  };

  const handleEditSlipPaste = (e: React.ClipboardEvent) => {
    if (isEditUploading || editOrderData?.paymentStatus === "Unpaid" || editOrderData?.paymentStatus === "COD") return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          uploadEditSlipFile(file);
        }
        return;
      }
    }
  };

  const addEditExtraSlipSlot = () => {
    setEditExtraSlips(prev => [...prev, { url: "", verification: null }]);
  };

  const removeEditExtraSlip = (index: number) => {
    setEditExtraSlips(prev => prev.filter((_, i) => i !== index));
  };

  const uploadEditExtraSlipFile = async (index: number, file: File) => {
    setEditExtraSlips(prev => prev.map((s, i) => i === index ? { ...s, uploading: true, verification: null } : s));
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${BASE_PATH}/api/upload`, { method: "POST", body: form });
      const data = await res.json();
      if (data.url) {
        setEditExtraSlips(prev => prev.map((s, i) => i === index ? { ...s, url: data.url, uploading: false } : s));
        const absoluteSlipUrl = data.url.startsWith("http") ? data.url : `${window.location.origin}${data.url}`;
        const result = await verifySlip(absoluteSlipUrl);
        setEditExtraSlips(prev => prev.map((s, i) => i === index ? { ...s, verification: result } : s));
      } else {
        alert("อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        setEditExtraSlips(prev => prev.map((s, i) => i === index ? { ...s, uploading: false } : s));
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะอัปโหลดไฟล์");
      setEditExtraSlips(prev => prev.map((s, i) => i === index ? { ...s, uploading: false } : s));
    }
  };

  const handleEditExtraSlipFileInput = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadEditExtraSlipFile(index, file);
  };

  const handleEditExtraSlipPaste = (index: number, e: React.ClipboardEvent) => {
    if (editExtraSlips[index]?.uploading) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          uploadEditExtraSlipFile(index, file);
        }
        return;
      }
    }
  };

  const editAllSlipResults = [editSlipVerification, ...editExtraSlips.map(s => s.verification)];
  const editTotalVerifiedSlipAmount = sumUsableSlipAmounts(editAllSlipResults);
  const editExpectedPaymentTotal = parseFloat(editOrderData?.actualReceivedAmount) || 0;
  const editHasAnySlipUploaded = !!editOrderData?.transferSlip || editExtraSlips.length > 0;
  const editSlipAmountMismatch = editHasAnySlipUploaded && editExpectedPaymentTotal > 0 && !isTotalAmountMatched(editTotalVerifiedSlipAmount, editExpectedPaymentTotal);
  const editHasSlipIssue = hasAnySlipIssue(editAllSlipResults) || editSlipAmountMismatch;
  // Orders with 2+ product lines get per-item weight/price edit rows
  // instead of the flat weight/piece/price inputs — editing the flat
  // aggregate directly would have nowhere sensible to redistribute back
  // into the underlying items.
  const isMultiItemEdit = (editOrderData?.items?.length ?? 0) > 1;

  const handleSaveOrderEdit = async () => {
    if (!editOrderData) return;
    // Same "at least one real item" rule the create flow enforces (see
    // handleSubmit above) — an edit that zeroes out every item's weight (or
    // the flat weight field, for a single-item order) would otherwise
    // silently leave an order with no pork in it at all.
    const editTotalWeight = isMultiItemEdit
      ? editOrderData.items.reduce((sum: number, it: any) => sum + (Number(it.weight) || 0), 0)
      : parseFloat(editOrderData.crispyPorkWeight) || 0;
    const editTotalPieces = isMultiItemEdit
      ? editOrderData.items.reduce((sum: number, it: any) => sum + (Number(it.pieceCount) || 0), 0)
      : parseFloat(editOrderData.crispyPorkPiece) || 0;
    if (editTotalWeight <= 0 && editTotalPieces <= 0) {
      alert("ออเดอร์ต้องมีน้ำหนักหรือจำนวนหมูอย่างน้อย 1 รายการ ลบออกจนหมดไม่ได้");
      return;
    }
    if (editHasSlipIssue && !isSlipIssueReasonComplete(editSlipIssueReason, editSlipIssueOtherText)) {
      alert(
        editSlipIssueReason === SLIP_ISSUE_OTHER
          ? "กรุณาระบุว่าสลิปมีปัญหาอะไรก่อนบันทึกออเดอร์"
          : "สลิปมีปัญหา กรุณาเลือกเหตุผลก่อนบันทึกออเดอร์"
      );
      return;
    }
    const slipIssueNote = editHasSlipIssue ? buildSlipIssueNote(editSlipIssueReason, editSlipIssueOtherText) : "";
    const combinedAdminNote = [editOrderData.adminNote, slipIssueNote].filter(Boolean).join(" ");
    setIsSavingEdit(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/orders/${editOrderData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: editOrderData.customerName,
          customerAddress: editOrderData.customerAddress,
          customerPhone: editOrderData.customerPhone,
          customerZip: editOrderData.customerZip,
          needsTaxInvoice: editOrderData.needsTaxInvoice,
          ...(isMultiItemEdit
            ? { items: editOrderData.items.map((it: any) => ({ id: it.id, weight: it.weight, pieceCount: it.pieceCount, price: it.price })) }
            : { price: editOrderData.price, crispyPorkWeight: editOrderData.crispyPorkWeight, crispyPorkPiece: editOrderData.crispyPorkPiece }),
          codAmount: editOrderData.codAmount,
          trackingNumber: editOrderData.trackingNumber,
          adminNote: combinedAdminNote,
          paymentStatus: editOrderData.paymentStatus,
          transferSlip: editOrderData.transferSlip,
          extraSlipUrls: editExtraSlips.map(s => s.url).filter(Boolean),
          editedBy: currentUser?.name,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSelectedOrder(data.order);
        setIsEditingOrder(false);
        setEditOrderData(null);
        setEditExtraSlips([]);
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

  const handleAddManualRackForItem = (index: number) => {
    const updated = [...items[index].rackDetails, { assignmentId: "", rackNo: "", weight: 0 }];
    syncItemFromRackDetails(index, updated);
  };

  const handleManualRackChangeForItem = (index: number, rackIdx: number, field: keyof RackDetail, value: string | number) => {
    const updated = [...items[index].rackDetails];
    if (field === "assignmentId") {
      const selected = currentUser?.racks?.find((r: any) => r.id === value) as any;
      updated[rackIdx] = selected
        ? { assignmentId: selected.id, rackNo: selected.rackNo, weight: selected.remainingWeight }
        : { assignmentId: "", rackNo: "", weight: 0 };
    } else if (field === "weight") {
      updated[rackIdx] = { ...updated[rackIdx], weight: Number(value) };
    }
    syncItemFromRackDetails(index, updated);
  };

  const handleRemoveRackForItem = (index: number, rackIdx: number) => {
    const updated = items[index].rackDetails.filter((_, i) => i !== rackIdx);
    syncItemFromRackDetails(index, updated);
  };

  // Lets a search result row itself act as the "add to order" control — click
  // once to add the piece, click again to take it back out.
  const handleTogglePieceInOrderForItem = (index: number, piece: any) => {
    const item = items[index];
    const exists = item.rackDetails.some(r => r.assignmentId === piece.id);

    if (exists) {
      // Removing always falls back to the normal "derive weight/price from
      // whatever's actually selected" behavior, same as any other manual edit.
      syncItemFromRackDetails(index, item.rackDetails.filter(r => r.assignmentId !== piece.id));
      return;
    }

    const updated = [...item.rackDetails, { assignmentId: piece.id, rackNo: piece.rackNo, weight: piece.remainingWeight }];

    // Picking a piece off the "หาชิ้นหมูใกล้เคียงน้ำหนัก" search results is
    // choosing "close enough" on purpose, not a request to bill the customer
    // for whatever that specific piece happens to weigh — pin this item's
    // weight/price to the number that was searched for instead of the real
    // piece total. targetWeight then no longer equals the allocated total,
    // which is exactly what makes the shortage/overage note below (already
    // comparing those two) surface "เกินมา/ขาดอีก X กก." for Packing on its
    // own — nothing extra to do here for that part.
    const searchTarget = parseFloat(item.weightSearch);
    const hasActiveSearch = item.weightSearch !== "" && !isNaN(searchTarget) && searchTarget > 0;

    if (hasActiveSearch) {
      const weightStr = String(searchTarget);
      const priceStr = computeItemPrice({ ...item, weightStr }, settings);
      updateItem(index, { rackDetails: updated, weightStr, priceStr });
    } else {
      syncItemFromRackDetails(index, updated);
    }
  };

  const handleSubmit = async (e: React.FormEvent, bypassDuplicateCheck = false) => {
    e.preventDefault();
    if (!formData.customerName.trim()) return;
    if (!isStorefrontMode && !formData.platform) {
      alert("กรุณาเลือกช่องทางการขายก่อนบันทึกออเดอร์");
      return;
    }
    if (!isStorefrontMode) {
      const phoneInvalid = !isValidPhone(formData.customerPhone);
      const zipInvalid = !isValidZip(formData.customerZip);
      if (phoneInvalid || zipInvalid) {
        const problems = [];
        if (phoneInvalid) problems.push("เบอร์โทร (ต้องมี 10 หลัก)");
        if (zipInvalid) problems.push("รหัสไปรษณีย์ (ต้องมี 5 หลัก)");
        alert(`กรุณากรอก ${problems.join(" และ ")} ให้ครบก่อนบันทึกออเดอร์`);
        return;
      }
    }
    if (combinedHasSlipIssue && !isSlipIssueReasonComplete(slipIssueReason, slipIssueOtherText)) {
      alert(
        slipIssueReason === SLIP_ISSUE_OTHER
          ? "กรุณาระบุว่าสลิปมีปัญหาอะไรก่อนบันทึกออเดอร์"
          : "สลิปมีปัญหา กรุณาเลือกเหตุผลก่อนบันทึกออเดอร์"
      );
      return;
    }

    const slipIssueNote = combinedHasSlipIssue ? buildSlipIssueNote(slipIssueReason, slipIssueOtherText) : "";
    const combinedAdminNote = [derivedAdminNote, slipIssueNote].filter(Boolean).join(" ");

    // Drop any line the admin added but never actually filled in (e.g.
    // clicked "+ เพิ่มสินค้าอีกชนิด" then changed their mind) so an empty
    // second line never creates a zero-weight OrderItem row.
    const itemsToSubmit = items.filter(it => (parseFloat(it.weightStr) || 0) > 0 || it.rackDetails.length > 0);

    if (itemsToSubmit.length === 0) {
      alert("กรุณาใส่น้ำหนักหมูอย่างน้อย 1 รายการก่อนบันทึกออเดอร์");
      return;
    }

    // A line with weight typed in but nothing actually picked from the rack
    // already gets the ⚠️ warning above (itemNotes) — this turns it into a
    // hard block instead, since a real Order should always have real stock
    // behind it (that's exactly what "ลูกค้ารอหมู" is for when there isn't).
    const itemWithNoStock = itemsToSubmit.find(it => (parseFloat(it.weightStr) || 0) > 0 && it.rackDetails.length === 0);
    if (itemWithNoStock) {
      alert('มีสินค้าที่ใส่น้ำหนักไว้แต่ยังไม่ได้เลือกชิ้นหมูจากคลังจริง กรุณาเลือกชิ้นหมูก่อนบันทึกออเดอร์ (ถ้ายังไม่มีของจริง ให้ใช้หน้า "ลูกค้ารอหมู" แทน)');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          orderStatus: isStorefrontMode ? "Completed" : formData.orderStatus,
          adminNote: combinedAdminNote,
          rackDetails: JSON.stringify(items.flatMap(it => it.rackDetails)),
          items: itemsToSubmit.map(it => ({
            productType: it.productType,
            weight: parseFloat(it.weightStr) || 0,
            pieceCount: it.rackDetails.length || null,
            // Zeroed client-side too for a claim, even though the server
            // force-zeroes it independently — keeps what's shown right
            // after saving (the refetched order) honest with what the
            // summary above already displayed before submit.
            price: formData.isClaim ? 0 : (parseFloat(it.priceStr) || 0),
            pricePerKg: getPricePerKg(it.productType, settings),
          })),
          extraSlipUrls: extraSlips.map(s => s.url).filter(Boolean),
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
        // sellerName is also reapplied here since it's normally set by a
        // useEffect keyed on currentUser, which won't re-fire on its own
        // just because the form was reset.
        setFormData(
          currentUser?.role === "STOREFRONT"
            ? { ...initialForm, customerName: "ลูกค้าหน้าร้าน", platform: "Storefront", shippingMethod: "รับหน้าร้าน", paymentStatus: "Paid", sellerName: currentUser?.name || "" }
            : { ...initialForm, sellerName: currentUser?.name || "" }
        );
        setItems([makeDefaultLineItem(DEFAULT_PRODUCT_TYPE)]);
        setViewProductType(DEFAULT_PRODUCT_TYPE);
        setPreviewWeightSearch("");
        setAlertData({ show: false, message: "", customerName: "" });
        setSlipVerification(null);
        setSlipIssueReason("");
        setSlipIssueOtherText("");
        setExtraSlips([]);
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
        flashSaveToast();
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

  // SUPER_ADMIN-only, Order Details-only action — closes out today's order
  // numbering without touching any existing order's status (unlike Packing's
  // own "จบงานวันนี้", which also bulk-marks orders Shipped). Any order
  // entered for the rest of today then numbers as tomorrow's instead, and
  // since Packing already shows a day ahead of that, it surfaces there two
  // calendar days after today.
  const handleEndTodayOrders = async () => {
    if (!confirm("ยืนยันจบออเดอร์ของวันนี้?\n\nออเดอร์ที่ลงหลังจากนี้ (แม้ยังเป็นวันเดิม) จะถูกนับเป็นออเดอร์ของวันถัดไปแทน แล้วจะไปขึ้นหน้า Packing ของอีก 2 วันข้างหน้า")) {
      return;
    }
    try {
      const res = await fetch(`${BASE_PATH}/api/settings/packing-cutoff`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        alert(`เรียบร้อยครับ ออเดอร์ที่ลงหลังจากนี้ในวันนี้จะถูกนับเป็นออเดอร์ของวันที่ ${data.nextOrderDate}`);
      } else {
        alert(data.error || "เกิดข้อผิดพลาด");
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    }
  };

  const handleConfirmDuplicate = () => {
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
    handleSubmit(fakeEvent, true);
  };

  // Combined across the primary slip and every extra one — a customer who
  // paid in two transfers has their amounts summed and checked against the
  // order total together, rather than each slip needing to match the full
  // amount on its own (see lib/slipVerification.ts).
  const allSlipResults = [slipVerification, ...extraSlips.map(s => s.verification)];
  const totalVerifiedSlipAmount = sumUsableSlipAmounts(allSlipResults);
  const expectedPaymentTotal = parseFloat(formData.actualReceivedAmount) || 0;
  const hasAnySlipUploaded = !!formData.transferSlip || extraSlips.length > 0;
  const slipAmountMismatch = hasAnySlipUploaded && expectedPaymentTotal > 0 && !isTotalAmountMatched(totalVerifiedSlipAmount, expectedPaymentTotal);
  const combinedHasSlipIssue = hasAnySlipIssue(allSlipResults) || slipAmountMismatch;

  // computeRackAllocation only ever lands within +0.1kg over target, or
  // 0.15-0.4kg under it (a shortfall closer than 0.15kg is treated as "not
  // close enough" too, same as nothing being available) — flag whichever
  // direction it landed in so the admin always sees exactly how far off it
  // is, and why nothing got picked when picking was impossible within that
  // tolerance. Computed per line item, then combined below — the PORK line
  // deliberately keeps the exact original wording ("หมูในคลังไม่พอดี...",
  // no product name inserted) so lib/porkSlip.ts's extractShortageNote
  // regex, which predates multi-item orders, keeps matching the common
  // single-PORK-item case unchanged.
  const itemNotes = items.map((item) => {
    const itemTargetWeight = parseFloat(item.weightStr) || 0;
    const itemAllocated = Number(item.rackDetails.reduce((sum, r) => sum + r.weight, 0).toFixed(2));
    const label = item.productType === DEFAULT_PRODUCT_TYPE ? "หมู" : (PRODUCT_TYPES[item.productType]?.label || item.productType);
    if (itemTargetWeight > 0 && item.rackDetails.length > 0 && itemAllocated !== itemTargetWeight) {
      const adminNote = buildAllocationDiffNote(label, itemTargetWeight, itemAllocated)!;
      return { adminNote, warning: `⚠️ ${adminNote} - ระบบจะบันทึกเป็น Comment ติดออเดอร์ไว้ให้ครับ` };
    }
    if (itemTargetWeight > 0 && item.rackDetails.length === 0) {
      return {
        adminNote: `ไม่มีชิ้น${label}ที่ใกล้เคียงพอ ขาดอีก ${itemTargetWeight} กก.`,
        warning: `⚠️ ไม่มีชิ้น${label}ในคลังที่น้ำหนักใกล้เคียงกับที่ต้องการมากพอ (ต้องเกินไม่เกิน ${MAX_OVER_DEVIATION_KG} กก. หรือขาดอยู่ในช่วง ${MIN_UNDER_DEVIATION_KG}-${MAX_UNDER_DEVIATION_KG} กก.) — กรุณาเลือกชิ้นหมูเองด้านล่าง หรือปรับน้ำหนักที่ต้องการ`,
      };
    }
    return null;
  });
  const derivedAdminNote = itemNotes.map(n => n?.adminNote).filter(Boolean).join(" / ");

  if (currentUser?.role === "PACKING" || currentUser?.role === "STOREFRONT") return null;

  if (mode === "walkin" && currentUser && !isSuperAdminRole(currentUser.role)) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>ไม่มีสิทธิ์เข้าถึง</h1>
          <p className={styles.subtitle}>เฉพาะ Super Admin เท่านั้นที่เข้าหน้านี้ได้</p>
        </div>
      </div>
    );
  }

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
  const displayedOrders = recentOrders
    .filter(o => !showUnpaidOnly || o.paymentStatus === "Unpaid")
    .filter(o => !filterShippingMethod || o.shippingMethod === filterShippingMethod);
  // Super Admin/DEV using storefront mode themselves get the same click-a-
  // piece picker as the storefront role, instead of the full weight/piece-
  // count auto-allocate form meant for shipped orders.
  const useSimplifiedPicker = isStorefrontMode && (isStorefrontRole || isSuperAdminRole(currentUser?.role));

  return (
    <div className={styles.container}>
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className={styles.title}>บันทึกออเดอร์ใหม่</h1>
          <p className={styles.subtitle}>กรอกรายละเอียดออเดอร์ให้ครบ ระบบจะช่วยเช็คชื่อลูกค้าซ้ำให้อัตโนมัติ</p>
        </div>
        {!isStorefrontMode && isSuperAdminRole(currentUser?.role) && (
          <button
            type="button"
            onClick={handleEndTodayOrders}
            style={{ background: '#4facfe', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap' }}
          >
            ✅ จบ Order วันนี้
          </button>
        )}
      </div>

      <div className={styles.layout}>
        <div className={`${styles.mainContent} glass-panel`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 className={styles.cardTitle} style={{ marginBottom: 0 }}>{isStorefrontMode ? "ขายหน้าร้าน" : "รายละเอียดออเดอร์"}</h2>
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
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="checkbox" name="isClaim" checked={formData.isClaim} onChange={handleChange} style={{ width: '16px', height: '16px' }} />
                  <span className={styles.label} style={{ margin: 0 }}>🎁 ออเดอร์เคลม (ลูกค้าเคลมหมู — ไม่คิดเงิน)</span>
                </label>
                {formData.isClaim && (
                  <div style={{ fontSize: '12px', color: '#ffac33', marginTop: '4px' }}>
                    ยังต้องเลือกหมูจริงจากคลังให้ลูกค้าตามปกติ แค่ไม่เก็บเงิน/ไม่คิดค่าคอม
                  </div>
                )}
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>วันที่จะจัดส่ง <span style={{ fontWeight: 'normal', color: 'var(--text-secondary)' }}>(ไม่เลือก = พรุ่งนี้)</span></label>
                <input
                  type="date"
                  name="shippingDate"
                  // formData.entryDate is still what actually gets submitted
                  // (and is what every downstream consumer — Packing, this
                  // same order's own record — expects) — this field just
                  // displays/edits it one day ahead, in the shipping-date
                  // terms an admin actually thinks in. Blank stays blank
                  // (server defaults it to today, i.e. ships tomorrow,
                  // unchanged from before).
                  value={formData.entryDate ? nextDayStr(formData.entryDate) : ""}
                  onChange={(e) => {
                    const shippingDate = e.target.value;
                    setFormData((prev) => ({ ...prev, entryDate: shippingDate ? previousDayStr(shippingDate) : "" }));
                  }}
                  className={styles.input}
                />
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>ช่องทางการขาย <span style={{ color: '#ff6b6b' }}>*</span></label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {PLATFORM_OPTIONS.map((opt) => (
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
                        background: formData.platform === opt.value ? 'var(--accent-blue)' : 'rgba(var(--surface-rgb),0.05)',
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
                <textarea name="customerAddress" value={formData.customerAddress} onChange={handleChange} className={styles.textarea} placeholder="กรอกที่อยู่ลูกค้าสำหรับจัดส่ง (ไม่ต้องใส่เบอร์โทร/รหัสไปรษณีย์ มีช่องแยกด้านล่าง)"></textarea>
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>เบอร์โทร</label>
                <input type="text" name="customerPhone" value={formData.customerPhone} onChange={(e) => setFormData(prev => ({ ...prev, customerPhone: cleanPhoneInput(e.target.value) }))} className={styles.input} placeholder="เช่น 0812345678" />
                {!isValidPhone(formData.customerPhone) && (
                  <div style={{ color: '#ff6b6b', fontSize: '12px', marginTop: '4px' }}>⚠️ เบอร์โทรต้องมี 10 หลัก</div>
                )}
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>รหัสไปรษณีย์</label>
                <input type="text" name="customerZip" value={formData.customerZip} onChange={(e) => setFormData(prev => ({ ...prev, customerZip: cleanZipInput(e.target.value) }))} className={styles.input} placeholder="เช่น 10110" />
                {!isValidZip(formData.customerZip) && (
                  <div style={{ color: '#ff6b6b', fontSize: '12px', marginTop: '4px' }}>⚠️ รหัสไปรษณีย์ต้องมี 5 หลัก</div>
                )}
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="checkbox" name="needsTaxInvoice" checked={formData.needsTaxInvoice} onChange={handleChange} />
                  <span className={styles.label} style={{ margin: 0 }}>🧾 ต้องการใบกำกับภาษี</span>
                </label>
              </div>
            </div>

            {/* Product Details */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>รายละเอียดสินค้า</h3>
              {useSimplifiedPicker ? (
                <div className={styles.formGroup} style={{ gridColumn: '1 / -1', background: 'rgba(var(--surface-rgb),0.05)', padding: '16px', borderRadius: '8px' }}>
                  <label className={styles.label}>หมูที่ขาย</label>
                  <div style={{ marginBottom: '10px' }}>
                    <label className={styles.label} style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>หรือพิมพ์น้ำหนักเอง (กก.) — ระบบจะตัดสต็อกให้อัตโนมัติ</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={items[0].weightStr}
                      onChange={(e) => handleItemWeightChange(0, e.target.value)}
                      className={styles.input}
                      placeholder="เช่น 1.5"
                    />
                  </div>
                  {itemNotes[0]?.warning && (
                    <div style={{ color: '#ffac33', fontSize: '12px', margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '14px' }}>⚠️</span> {itemNotes[0].warning}
                    </div>
                  )}
                  {items[0].rackDetails.length === 0 ? (
                    <p style={{ fontSize: '13px', color: '#ff6b6b', margin: '4px 0 0 0' }}>⚠️ ยังไม่ได้เลือกชิ้นที่ขาย — เลือกจากรายการ "คลังหมูของฉัน" ด้านขวา หรือพิมพ์น้ำหนักด้านบน</p>
                  ) : (
                    <>
                      <p style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--accent-green)', margin: '4px 0 0 0' }}>
                        {Number(items[0].rackDetails.reduce((sum, r) => sum + r.weight, 0).toFixed(2))} กก. ({items[0].rackDetails.length} ชิ้น)
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                        {items[0].rackDetails.map((rack, rackIdx) => (
                          <span key={rackIdx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(88,166,255,0.15)', border: '1px solid var(--accent-blue)', borderRadius: '999px', padding: '6px 10px', fontSize: '13px' }}>
                            {rack.weight} กก.
                            <button type="button" onClick={() => handleRemoveRackForItem(0, rackIdx)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {items.map((item, index) => {
                    const itemTotalAllocated = Number(item.rackDetails.reduce((sum, r) => sum + r.weight, 0).toFixed(2));
                    const itemTargetWeight = parseFloat(item.weightStr) || 0;
                    const productLabel = PRODUCT_TYPES[item.productType]?.label || item.productType;
                    return (
                      <div key={index} style={{ gridColumn: '1 / -1', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>สินค้า:</span>
                            <select
                              value={item.productType}
                              onChange={(e) => handleItemProductChange(index, e.target.value)}
                              className={styles.input}
                              style={{ maxWidth: '220px' }}
                            >
                              {Object.values(PRODUCT_TYPES).map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
                            </select>
                          </div>
                          {items.length > 1 && (
                            <button type="button" onClick={() => removeLineItem(index)} style={{ background: 'rgba(255,107,107,0.15)', border: '1px solid rgba(255,107,107,0.4)', color: '#ff6b6b', cursor: 'pointer', borderRadius: '6px', padding: '4px 10px', fontSize: '12px' }}>
                                ✕ เอาออก
                              </button>
                            )}
                        </div>

                        <div className={styles.formGroup}>
                          <label className={styles.label}>น้ำหนัก{productLabel} (กก.) <span style={{ color: '#ff6b6b' }}>*</span></label>
                          <input
                            required
                            type="number"
                            step="0.01"
                            value={item.weightStr}
                            onChange={(e) => handleItemWeightChange(index, e.target.value)}
                            className={styles.input}
                            placeholder="เช่น 1.5"
                            disabled={item.allocationMode === 'count'}
                            style={{ opacity: item.allocationMode === 'count' ? 0.5 : 1 }}
                          />
                          {itemNotes[index]?.warning && (
                            <div style={{ color: '#ffac33', fontSize: '12px', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontSize: '14px' }}>⚠️</span> {itemNotes[index]!.warning}
                            </div>
                          )}
                        </div>

                        <div className={styles.formGroup}>
                          <label className={styles.label}>หรือเลือกจากจำนวนชิ้น (แทนการกรอกน้ำหนัก)</label>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <input
                              type="number"
                              min="0"
                              value={item.desiredPieceCount}
                              onChange={(e) => handlePieceCountChangeForItem(index, e)}
                              className={styles.input}
                              placeholder="จำนวนชิ้น"
                              disabled={item.allocationMode === 'weight'}
                              style={{ maxWidth: '160px', opacity: item.allocationMode === 'weight' ? 0.5 : 1 }}
                            />
                            <select
                              value={item.pieceSortOrder}
                              onChange={(e) => handlePieceSortOrderChangeForItem(index, e.target.value as 'asc' | 'desc')}
                              className={styles.input}
                              disabled={item.allocationMode === 'weight'}
                              style={{ maxWidth: '220px', opacity: item.allocationMode === 'weight' ? 0.5 : 1 }}
                            >
                              <option value="desc">เอาน้ำหนักมากไปน้อย</option>
                              <option value="asc">เอาน้ำหนักน้อยไปมาก</option>
                            </select>
                          </div>
                          {item.allocationMode === 'count' && (
                            <div style={{ fontSize: '12px', marginTop: '8px' }}>
                              {item.rackDetails.length > 0 ? (
                                <span style={{ color: 'var(--accent-green)' }}>
                                  น้ำหนักรวม {item.weightStr || 0} กก. ({item.rackDetails.length} ชิ้น)
                                </span>
                              ) : (
                                <span style={{ color: '#ff6b6b' }}>⚠️ ไม่มีชิ้น{productLabel}ในคลังให้เลือก</span>
                              )}
                              {Number(item.desiredPieceCount) > item.rackDetails.length && item.rackDetails.length > 0 && (
                                <span style={{ color: '#ffac33', marginLeft: '8px' }}>
                                  (ขอ {item.desiredPieceCount} ชิ้น แต่ในคลังมีให้แค่ {item.rackDetails.length} ชิ้น)
                                </span>
                              )}
                            </div>
                          )}
                          {item.allocationMode === 'weight' && (
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                              ลบน้ำหนักด้านบนออกก่อน ถ้าจะเลือกตามจำนวนชิ้นแทน
                            </div>
                          )}
                        </div>

                        {/* Rack Allocation UI */}
                        <div className={styles.formGroup} style={{ background: 'rgba(var(--surface-rgb),0.05)', padding: '16px', borderRadius: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <label className={styles.label} style={{ marginBottom: 0 }}>ชิ้น{productLabel}ที่ใช้</label>
                            <span style={{ fontSize: '12px', color: itemTotalAllocated < itemTargetWeight ? '#ff6b6b' : 'var(--accent-green)' }}>
                              จัดแล้ว {itemTotalAllocated} / {itemTargetWeight} กก.
                            </span>
                          </div>
                          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>
                            ระบบเลือกชิ้นจากคลังให้อัตโนมัติตามน้ำหนักที่กรอกด้านบน ถ้าต้องการแก้ไขเอง กด "เลือกชิ้นหมู" เพื่อเปลี่ยน หรือลบ/เพิ่มรายการได้
                          </p>

                          {item.rackDetails.map((rack, rackIdx) => (
                            <div key={rackIdx} className={styles.mobileStackGrid} style={{ display: 'grid', gridTemplateColumns: '1fr 100px auto', gap: '8px', marginBottom: '8px' }}>
                              <select
                                className={styles.input}
                                value={rack.assignmentId}
                                onChange={(e) => handleManualRackChangeForItem(index, rackIdx, "assignmentId", e.target.value)}
                              >
                                <option value="">-- เลือกชิ้นหมู --</option>
                                {[...(currentUser?.racks || [])]
                                  .filter((r: any) => (!r.isUsedUp || r.id === rack.assignmentId) && (r.productType || DEFAULT_PRODUCT_TYPE) === item.productType)
                                  .sort((a: any, b: any) => {
                                    const matchA = parseRackCode(a.rackNo, item.productType);
                                    const matchB = parseRackCode(b.rackNo, item.productType);
                                    if (matchA && matchB) {
                                      if (matchA.prefix !== matchB.prefix) return matchA.prefix.localeCompare(matchB.prefix);
                                      if (matchA.num !== matchB.num) return matchA.num - matchB.num;
                                      if (matchA.piece !== null && matchB.piece !== null) return matchA.piece - matchB.piece;
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
                                style={{ background: 'rgba(var(--surface-rgb),0.05)', color: 'var(--text-secondary)' }}
                                placeholder="kg"
                                title="ห้ามย่อยขาย (Force whole piece)"
                              />
                              <button
                                type="button"
                                onClick={() => handleRemoveRackForItem(index, rackIdx)}
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
                          <button type="button" onClick={() => handleAddManualRackForItem(index)} className={styles.button} style={{ width: '100%', marginTop: '10px', padding: '14px 20px', fontSize: '16px', fontWeight: 'bold', background: 'rgba(var(--surface-rgb),0.1)' }}>
                            + เพิ่มชิ้นเอง
                          </button>
                        </div>

                        <div className={styles.mobileStackGrid} style={{ display: isStorefrontMode ? 'none' : 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                          <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                            <label className={styles.label}>โปรโมชั่น</label>
                            <select value={item.promotion} onChange={(e) => handleItemPromotionChange(index, e.target.value as "AUTO" | "")} className={styles.input}>
                              <option value="">ไม่มีโปรโมชั่น</option>
                              <option value="AUTO">1 กก. {getPricePerKg(item.productType, settings)} บาท</option>
                            </select>
                          </div>
                          <div className={styles.formGroup} style={{ marginBottom: 0, display: showPriceAndSlip ? 'block' : 'none' }}>
                            <label className={styles.label}>ราคา{productLabel} (บาท) <span style={{ color: '#ff6b6b' }}>*</span></label>
                            <input required={showPriceAndSlip} type="number" step="0.01" value={item.priceStr} onChange={(e) => updateItem(index, { priceStr: e.target.value })} className={styles.input} placeholder={`ราคา${productLabel}`} />
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {!isStorefrontMode && Object.keys(PRODUCT_TYPES).length > items.length && (
                    <button type="button" onClick={addLineItem} className={styles.button} style={{ width: '100%', marginBottom: '8px', background: 'rgba(88,166,255,0.12)', border: '1px solid rgba(88,166,255,0.3)', color: 'var(--accent-blue)' }}>
                      + เพิ่มสินค้าอีกชนิด
                    </button>
                  )}

                  <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
                    <label className={styles.label}>รวมทุกรายการ</label>
                    <div style={{ fontSize: '15px', color: 'var(--text-secondary)' }}>
                      {formData.crispyPorkWeight || 0} กก. ({formData.crispyPorkPiece || 0} ชิ้น)
                    </div>
                    {computeBoxCount(parseFloat(formData.crispyPorkWeight) || 0) > 1 && (
                      <div style={{ color: '#ffac33', fontSize: '12px', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontSize: '14px' }}>📦</span> น้ำหนักเกิน {MAX_WEIGHT_PER_BOX_KG} กก. ต่อกล่อง — ต้องแบ่งเป็น {computeBoxCount(parseFloat(formData.crispyPorkWeight) || 0)} กล่อง (แต่ละกล่องได้เลข track แยกกัน)
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Financials */}
            <div className={styles.formSection} style={{ display: showPriceAndSlip ? 'grid' : 'none', gridTemplateColumns: '1fr', gap: '20px' }}>
              <h3 className={styles.sectionTitle} style={{ marginBottom: 0 }}>ยอดเงินและค่าส่ง</h3>

              {/* Primary, required inputs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>ราคาสินค้ารวม (บาท)</label>
                  <input type="number" step="0.01" value={formData.price} readOnly className={styles.input} placeholder="ราคาหมูกรอบ" style={{ opacity: 0.7, background: 'rgba(var(--surface-rgb),0.05)', color: 'var(--text-secondary)' }} />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label}>วิธีจัดส่ง <span style={{ color: '#ff6b6b' }}>*</span></label>
                  <select required={showPriceAndSlip} name="shippingMethod" value={formData.shippingMethod} onChange={handleChange} className={styles.input}>
                    <option value="">-- เลือกวิธีจัดส่ง --</option>
                    {!isStorefrontMode && (
                      <>
                        <option value="EMS">EMS</option>
                        <option value="NIM Express">NIM Express</option>
                        <option value="ส่งในพื้นที่">ส่งในพื้นที่</option>
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

              {/* Optional extras — hidden entirely for a claim: no shipping
                  charge and no COD makes sense on a free replacement. */}
              {!formData.isClaim && (
                <div style={{ display: isStorefrontMode ? 'none' : 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>ค่าส่งเพิ่มเติม (บาท)</label>
                    <input type="number" step="0.01" name="additionalShippingCost" value={formData.additionalShippingCost} onChange={handleChange} className={styles.input} placeholder="ระบบคำนวณให้อัตโนมัติเมื่อเลือกวิธีจัดส่ง" />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input type="checkbox" checked={formData.isCod} onChange={(e) => handleIsCodChange(e.target.checked)} style={{ width: '16px', height: '16px' }} />
                      เก็บเงินปลายทาง (COD)
                    </label>
                    <input type="number" step="0.01" name="codAmount" value={formData.codAmount} readOnly className={styles.input} placeholder="ยอดเก็บปลายทาง" style={{ opacity: formData.isCod ? 1 : 0.5, background: 'rgba(var(--surface-rgb),0.05)', color: 'var(--text-secondary)' }} />
                  </div>
                </div>
              )}

              {/* Auto-calculated summary — visually separated so it reads as
                  "the system worked this out", not more fields to fill in.
                  Shown in storefront mode too: VAT/total are already computed
                  off formData.price regardless of mode and saved with the
                  order, they just weren't visible here before. A claim
                  overrides both to plainly show ฿0, matching what's actually
                  submitted (see handleSubmit and POST /api/orders' own
                  force-zero). */}
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', borderTop: '1px dashed rgba(var(--surface-rgb),0.1)', paddingTop: '16px' }}>
                <div style={{ flex: '1 1 200px', background: 'rgba(var(--surface-rgb),0.03)', borderRadius: '10px', padding: '14px 16px' }}>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>🧮 ภาษีมูลค่าเพิ่ม (VAT 7%)</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{formData.isClaim ? '฿0' : (formData.vatAmount ? `฿${formData.vatAmount}` : '-')}</div>
                </div>
                <div style={{ flex: '1 1 200px', background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.25)', borderRadius: '10px', padding: '14px 16px' }}>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>🧮 ยอดรับจริงทั้งหมด</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--accent-green)' }}>{formData.isClaim ? '฿0 (เคลม)' : (formData.actualReceivedAmount ? `฿${formData.actualReceivedAmount}` : '-')}</div>
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
                <div
                  tabIndex={0}
                  onPaste={handleSlipPaste}
                  style={{
                    border: '2px dashed rgba(88,166,255,0.4)',
                    borderRadius: '8px',
                    padding: '14px',
                    background: 'rgba(88,166,255,0.05)',
                    opacity: (formData.paymentStatus === "Unpaid" || formData.paymentStatus === "COD") ? 0.5 : 1,
                  }}
                >
                  <div style={{ fontSize: '13px', color: 'var(--accent-blue)', marginBottom: '10px', fontWeight: 'bold' }}>
                    📋 คลิกตรงนี้แล้วกด Ctrl+V เพื่อวางรูปสลิป หรือเลือกไฟล์ด้านล่าง
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input type="file" accept="image/*" onChange={handleFileUpload} ref={fileInputRef} className={styles.input} style={{ padding: '8px' }} disabled={isUploading || formData.paymentStatus === "Unpaid" || formData.paymentStatus === "COD"} />
                    {isUploading && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>กำลังอัปโหลด...</span>}
                  </div>
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
                    <button type="button" onClick={() => { setFormData(prev => ({ ...prev, transferSlip: "" })); setSlipVerification(null); setSlipIssueReason(""); setSlipIssueOtherText(""); if (fileInputRef.current) fileInputRef.current.value = ""; }} style={{ marginLeft: '12px', background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}>ลบสลิป</button>
                  </div>
                )}
                <SlipVerificationBadge result={slipVerification} />

                {/* Extra slips — ลูกค้าโอนไม่ครบรอบแรกแล้วโอนเพิ่มรอบหลัง */}
                {extraSlips.map((slip, index) => (
                  <div key={index} style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed rgba(var(--surface-rgb),0.15)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>สลิปเพิ่มเติม #{index + 1}</span>
                      <button type="button" onClick={() => removeExtraSlip(index)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '12px' }}>✕ ลบ</button>
                    </div>
                    {!slip.url ? (
                      <div
                        tabIndex={0}
                        onPaste={(e) => handleExtraSlipPaste(index, e)}
                        style={{ border: '2px dashed rgba(88,166,255,0.4)', borderRadius: '8px', padding: '14px', background: 'rgba(88,166,255,0.05)' }}
                      >
                        <div style={{ fontSize: '13px', color: 'var(--accent-blue)', marginBottom: '10px', fontWeight: 'bold' }}>
                          📋 คลิกตรงนี้แล้วกด Ctrl+V เพื่อวางรูปสลิป หรือเลือกไฟล์ด้านล่าง
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <input type="file" accept="image/*" onChange={(e) => handleExtraSlipFileInput(index, e)} className={styles.input} style={{ padding: '8px' }} disabled={slip.uploading} />
                          {slip.uploading && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>กำลังอัปโหลด...</span>}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px' }}>
                        <a href={slip.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>ดูสลิปที่อัปโหลด</a>
                      </div>
                    )}
                    <SlipVerificationBadge result={slip.verification} />
                  </div>
                ))}
                {formData.transferSlip && formData.paymentStatus !== "Unpaid" && formData.paymentStatus !== "COD" && (
                  <button type="button" onClick={addExtraSlipSlot} style={{ marginTop: '10px', background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.3)', color: 'var(--accent-blue)', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>
                    + เพิ่มสลิป (ถ้าลูกค้าโอนไม่ครบแล้วโอนเพิ่ม)
                  </button>
                )}
                <CombinedSlipSummary totalVerified={totalVerifiedSlipAmount} expectedTotal={expectedPaymentTotal} slipCount={allSlipResults.filter(Boolean).length} />
                {combinedHasSlipIssue && (
                  <SlipIssueReasonPicker reason={slipIssueReason} onReasonChange={setSlipIssueReason} otherText={slipIssueOtherText} onOtherTextChange={setSlipIssueOtherText} />
                )}
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>ชื่อผู้ขาย (แอดมิน)</label>
                <input type="text" name="sellerName" value={formData.sellerName} className={styles.input} placeholder="ชื่อผู้ขาย" readOnly={true} style={{ opacity: 0.7, cursor: 'not-allowed', backgroundColor: 'rgba(var(--surface-rgb),0.05)' }} />
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
          {currentUser && (() => {
            const targetProductType = viewProductType;
            const targetProductLabel = PRODUCT_TYPES[targetProductType]?.label || targetProductType;
            const productRacks = (currentUser.racks || []).filter((r: any) => (r.productType || DEFAULT_PRODUCT_TYPE) === targetProductType);
            // A real line for this product may or may not exist yet —
            // browsing never creates one (see selectPanelProductType); this
            // virtual fallback just shows empty/no-selection until a real
            // line does exist, either already or via handlePieceClick below.
            const existingIndex = items.findIndex(it => it.productType === targetProductType);
            const hasRealItem = existingIndex !== -1;
            const targetItem: OrderLineItem = hasRealItem ? items[existingIndex] : { ...makeDefaultLineItem(targetProductType), weightSearch: previewWeightSearch };
            const handleWeightSearchChange = (value: string) => {
              if (hasRealItem) updateItem(existingIndex, { weightSearch: value });
              else setPreviewWeightSearch(value);
            };
            // Picking a piece while browsing a product with no real line yet
            // creates one now, seeded with that piece — same weight/price
            // derivation handleTogglePieceInOrderForItem itself uses for a
            // fresh pick, just with no existing line to fold into.
            const handlePieceClick = (piece: any) => {
              if (hasRealItem) {
                handleTogglePieceInOrderForItem(existingIndex, piece);
                return;
              }
              const searchTarget = parseFloat(previewWeightSearch);
              const hasActiveSearch = previewWeightSearch !== "" && !isNaN(searchTarget) && searchTarget > 0;
              const weightStr = hasActiveSearch ? String(searchTarget) : String(piece.remainingWeight);
              const priceStr = computeItemPrice({ promotion: "AUTO", weightStr, productType: targetProductType, priceStr: "" }, settings);
              const rackDetails: RackDetail[] = [{ assignmentId: piece.id, rackNo: piece.rackNo, weight: piece.remainingWeight }];
              setItems(prev => [...prev, { ...makeDefaultLineItem(targetProductType), weightSearch: previewWeightSearch, weightStr, priceStr, rackDetails }]);
              setPreviewWeightSearch("");
            };

            return (
            <div className={`${styles.card} glass-panel`} style={{ marginBottom: '24px' }}>
              {mode === "normal" && <PetCorner />}
              <h2 className={styles.cardTitle} style={{ marginBottom: '16px', fontSize: '1.2rem' }}>📦 คลังหมูของฉัน</h2>

              {!useSimplifiedPicker && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                  {Object.keys(PRODUCT_TYPES).map((productType) => {
                    const isTarget = targetProductType === productType;
                    return (
                      <button
                        key={productType}
                        type="button"
                        onClick={() => selectPanelProductType(productType)}
                        style={{
                          flex: 1,
                          background: isTarget ? 'var(--accent-blue)' : 'rgba(var(--surface-rgb),0.06)',
                          color: isTarget ? '#fff' : 'var(--text-secondary)',
                          border: isTarget ? 'none' : '1px solid var(--border-color)',
                          borderRadius: '8px',
                          padding: '8px 10px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: 'bold',
                        }}
                      >
                        {PRODUCT_TYPES[productType]?.label || productType}
                      </button>
                    );
                  })}
                </div>
              )}

              <div style={{ marginBottom: '20px', padding: '16px', background: 'rgba(var(--surface-rgb),0.05)', borderRadius: '8px', display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--accent-blue)' }}>
                    {productRacks.filter((r: any) => !r.isUsedUp).length}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>ชิ้น{targetProductLabel}คงเหลือ</div>
                </div>
                <div style={{ borderLeft: '1px solid rgba(var(--surface-rgb),0.1)' }}></div>
                <div>
                  <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--accent-green)' }}>
                    {productRacks.reduce((sum: number, r: any) => sum + (!r.isUsedUp ? (r.remainingWeight || 0) : 0), 0).toFixed(2)}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>กก. คงเหลือ</div>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label className={styles.label} style={{ display: 'block', marginBottom: '6px', fontSize: '13px' }}>🔍 หาชิ้น{targetProductLabel}ใกล้เคียงน้ำหนัก (กก.)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={targetItem.weightSearch}
                  onChange={(e) => handleWeightSearchChange(e.target.value)}
                  className={styles.input}
                  placeholder="เช่น 1.5"
                />
              </div>

              {productRacks.filter((r: any) => !r.isUsedUp).length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>ไม่มีชิ้น{targetProductLabel}ในคลัง</div>
              ) : (() => {
                const availableRacks = productRacks.filter((r: any) => !r.isUsedUp);
                const target = parseFloat(targetItem.weightSearch);
                const isSearching = targetItem.weightSearch !== "" && !isNaN(target) && target > 0;
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
                        {isSearching ? `ชิ้นที่ใกล้เคียง ${target} กก. มากที่สุด:` : (useSimplifiedPicker ? 'กดเพื่อเลือกชิ้นที่ขายไป:' : `รายการชิ้น${targetProductLabel}ที่เหลือ:`)}
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '350px', overflowY: 'auto', paddingRight: '4px' }}>
                        {matches.map((p: any, idx: number) => {
                          const isClose = p.diff !== null && p.diff <= 0.1;
                          const isAdded = targetItem.rackDetails.some(r => r.assignmentId === p.id);
                          return (
                            <div
                              key={p.id || idx}
                              onClick={() => handlePieceClick(p)}
                              style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '10px 14px', borderRadius: '8px', flexShrink: 0, cursor: 'pointer',
                                background: isAdded ? 'rgba(88,166,255,0.16)' : (isClose ? 'rgba(63,185,80,0.12)' : 'rgba(var(--surface-rgb),0.03)'),
                                border: `1px solid ${isAdded ? 'var(--accent-blue)' : (isClose ? 'rgba(63,185,80,0.5)' : 'rgba(var(--surface-rgb),0.08)')}`,
                              }}
                              title={isAdded ? "กดอีกครั้งเพื่อเอาออกจากออเดอร์" : "กดเพื่อเพิ่มชิ้นนี้เข้าออเดอร์"}
                            >
                              <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                                {useSimplifiedPicker ? '🐷 หมู 1 ชิ้น' : `ถาด ${getBaseRackKeyAuto(p.rackNo || '')}${p.rackNo?.includes('-') ? ` • ${p.rackNo}` : ''}`}
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
                  const baseRack = getBaseRackKeyAuto(curr.rackNo);
                  if (!acc[baseRack]) acc[baseRack] = [];
                  acc[baseRack].push(curr);
                  return acc;
                }, {});

                const sortedBaseRacks = Object.keys(groupedRacks).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

                return (
                  <>
                    <h3 style={{ fontSize: '15px', marginBottom: '12px', color: 'var(--text-secondary)' }}>รายการชิ้น{targetProductLabel}ที่เหลือ:</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '350px', overflowY: 'auto', paddingRight: '4px' }}>
                      {sortedBaseRacks.map(baseRack => {
                        const pieces = groupedRacks[baseRack];
                        const totalWeight = pieces.reduce((sum: number, p: any) => sum + p.remainingWeight, 0);
                        const sortedPieces = [...pieces].sort((a: any, b: any) => (a.rackNo || '').localeCompare((b.rackNo || ''), undefined, { numeric: true }));
                        return (
                          <div key={baseRack} style={{ background: 'rgba(var(--surface-rgb),0.03)', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(var(--surface-rgb),0.08)', flexShrink: 0 }}>
                            <div style={{ background: 'rgba(var(--surface-rgb),0.06)', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 'bold', color: 'var(--accent-blue)', fontSize: '16px' }}>ถาด {baseRack}</span>
                              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{pieces.length} ชิ้น รวม {totalWeight.toFixed(2)} กก.</span>
                            </div>
                            <div>
                              {sortedPieces.map((p: any, idx: number) => (
                                <div key={p.rackNo || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderTop: idx === 0 ? 'none' : '1px solid rgba(var(--surface-rgb),0.05)' }}>
                                  <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{p.rackNo || 'ไม่ทราบ'}</span>
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
            );
          })()}

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
            style={
              isOrdersModalFullscreen
                ? { maxWidth: '100vw', width: '100vw', height: '100vh', maxHeight: '100vh', borderRadius: 0, textAlign: 'left', padding: '24px', display: 'flex', flexDirection: 'column' }
                : { maxWidth: '600px', width: '92%', maxHeight: '85vh', textAlign: 'left', padding: '24px', display: 'flex', flexDirection: 'column' }
            }
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(var(--surface-rgb),0.1)', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.3rem', marginBottom: 0 }}>ออเดอร์ทั้งหมด</h3>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setIsOrdersModalFullscreen(v => !v)}
                  title={isOrdersModalFullscreen ? 'ย่อหน้าต่าง' : 'ขยายเต็มหน้าจอ'}
                  style={{ background: 'rgba(var(--surface-rgb),0.08)', border: 'none', color: 'var(--text-secondary)', fontSize: '15px', cursor: 'pointer', padding: '6px 10px', borderRadius: '6px', lineHeight: 1 }}
                >
                  {isOrdersModalFullscreen ? '🗗' : '⛶'}
                </button>
                <button type="button" onClick={() => setShowOrdersModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>✕</button>
              </div>
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
            {!customerSearch && mode === "normal" && (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                📅 กรองตามวันที่จะจัดส่ง (ลงออเดอร์วันนี้ = จัดส่งพรุ่งนี้)
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
                title={mode === "normal" ? "วันที่จะจัดส่ง" : undefined}
              />
              {filterDate && (
                <button
                  type="button"
                  onClick={() => setFilterDate("")}
                  style={{ background: 'rgba(var(--surface-rgb),0.08)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', borderRadius: '8px', padding: '0 14px', cursor: 'pointer', fontSize: '13px' }}
                >
                  ล้างวันที่
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowUnpaidOnly(v => !v)}
                style={{
                  background: showUnpaidOnly ? 'rgba(255,107,107,0.2)' : 'rgba(var(--surface-rgb),0.08)',
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
              <select
                className={styles.input}
                style={{ fontSize: '13px', flex: '1 1 160px' }}
                value={filterShippingMethod}
                onChange={(e) => setFilterShippingMethod(e.target.value)}
              >
                <option value="">วิธีจัดส่งทั้งหมด</option>
                <option value="EMS">EMS</option>
                <option value="NIM Express">NIM Express</option>
                <option value="ส่งในพื้นที่">ส่งในพื้นที่</option>
                <option value="รับหน้าร้าน">รับหน้าร้าน</option>
                <option value="ส่งเอง">ส่งเอง</option>
              </select>
            </div>

            {displayedOrders.length === 0 ? (
              <div className={styles.emptyState}>{showUnpaidOnly ? "ไม่มีออเดอร์ที่ยังไม่จ่ายเงิน" : "ยังไม่มีออเดอร์"}</div>
            ) : (
              <ul className={styles.list} style={{ overflowY: 'auto', paddingRight: '4px' }}>
                {displayedOrders.map((order) => {
                  const needsStock = orderHasNoRealStock(order);
                  return (
                  <li
                    key={order.id}
                    className={styles.listItem}
                    onClick={() => { setSelectedOrder(order); setIsEditingOrder(false); setEditOrderData(null); }}
                    style={needsStock ? { cursor: 'pointer', border: '1px solid #ff6b6b', background: 'rgba(255,107,107,0.06)' } : { cursor: 'pointer' }}
                  >
                    <div className={styles.itemInfo}>
                      <span className={styles.itemName}>
                        {order.orderNo || "?"} - {order.customerName}
                        {order.paymentStatus === "Unpaid" && (
                          <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 'bold', color: '#ff6b6b', background: 'rgba(255,107,107,0.15)', padding: '2px 8px', borderRadius: '999px' }}>
                            ยังไม่จ่าย
                          </span>
                        )}
                        {needsStock && (
                          <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 'bold', color: '#ff6b6b', background: 'rgba(255,107,107,0.15)', padding: '2px 8px', borderRadius: '999px' }}>
                            ⚠️ ยังไม่ได้ใส่หมู
                          </span>
                        )}
                        {order.isClaim && (
                          <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 'bold', color: '#ffac33', background: 'rgba(255,172,51,0.15)', padding: '2px 8px', borderRadius: '999px' }}>
                            🎁 เคลม
                          </span>
                        )}
                      </span>
                      <span className={styles.itemProduct}>
                        {order.platform || "ไม่ระบุช่องทาง"}
                        {order.adminNote && <span style={{ color: '#ffac33', marginLeft: '8px' }} title={order.adminNote}>⚠️ มีหมายเหตุ</span>}
                        {order.trackingNumber && <span style={{ color: 'var(--accent-green)', marginLeft: '8px' }} title={`เลขพัสดุ: ${order.trackingNumber}`}>🚚 ได้เลขพัสดุแล้ว</span>}
                      </span>
                    </div>
                    <span className={styles.itemTime} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {new Date(order.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                      {' '}
                      {new Date(order.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </li>
                  );
                })}
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

      {showSaveToast && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'var(--success-color)',
            color: '#fff',
            padding: '22px 40px',
            borderRadius: '16px',
            fontSize: '22px',
            fontWeight: 700,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            animation: 'toastPop 0.2s ease-out',
            pointerEvents: 'none',
          }}
        >
          ✓ ยืนยันออเดอร์แล้ว
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
            <div className={styles.alertBox} style={{ maxWidth: '760px', width: '92%', maxHeight: '88vh', textAlign: 'left', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(var(--surface-rgb),0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
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
                    {selectedOrder.isClaim && (
                      <span style={{ display: 'inline-block', fontSize: '12px', fontWeight: 'bold', color: '#ffac33', background: 'rgba(255,172,51,0.15)', padding: '4px 12px', borderRadius: '999px' }}>
                        🎁 เคลม — ไม่คิดเงิน
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
                  {/* Super Admin can delete any order; a regular admin only
                      their own — same scoping DELETE /api/orders/[id] itself
                      enforces server-side. */}
                  {!isEditingOrder && (isSuperAdminRole(currentUser?.role) || selectedOrder.sellerName === currentUser?.name) && (
                    <button
                      type="button"
                      onClick={() => setDeleteChoiceOrder(selectedOrder)}
                      style={{ background: 'rgba(255,107,107,0.15)', border: 'none', color: '#ff6b6b', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', padding: '6px 14px', borderRadius: '8px' }}
                    >
                      🗑️ ลบ
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
                    <div className={styles.mobileStackGrid} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                        <label className={styles.label}>เบอร์โทร</label>
                        <input type="text" className={styles.input} value={editOrderData.customerPhone || ''} onChange={e => setEditOrderData({ ...editOrderData, customerPhone: cleanPhoneInput(e.target.value) })} placeholder="เช่น 0812345678" />
                        {!isValidPhone(editOrderData.customerPhone) && (
                          <div style={{ color: '#ff6b6b', fontSize: '12px', marginTop: '4px' }}>⚠️ เบอร์โทรต้องมี 10 หลัก</div>
                        )}
                      </div>
                      <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                        <label className={styles.label}>รหัสไปรษณีย์</label>
                        <input type="text" className={styles.input} value={editOrderData.customerZip || ''} onChange={e => setEditOrderData({ ...editOrderData, customerZip: cleanZipInput(e.target.value) })} placeholder="เช่น 10110" />
                        {!isValidZip(editOrderData.customerZip) && (
                          <div style={{ color: '#ff6b6b', fontSize: '12px', marginTop: '4px' }}>⚠️ รหัสไปรษณีย์ต้องมี 5 หลัก</div>
                        )}
                      </div>
                    </div>
                    <div className={styles.formGroup}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!editOrderData.needsTaxInvoice} onChange={e => setEditOrderData({ ...editOrderData, needsTaxInvoice: e.target.checked })} />
                        <span className={styles.label} style={{ margin: 0 }}>🧾 ต้องการใบกำกับภาษี</span>
                      </label>
                    </div>
                    {isMultiItemEdit ? (
                      <div className={styles.formGroup}>
                        <label className={styles.label}>รายการสินค้า</label>
                        {editOrderData.items.map((it: any, i: number) => (
                          <div key={it.id} className={styles.mobileStackGrid} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{PRODUCT_TYPES[it.productType]?.label || it.productType}</span>
                            <input
                              type="number" step="0.01" className={styles.input} value={it.weight ?? ''}
                              onChange={e => {
                                const nextItems = [...editOrderData.items];
                                nextItems[i] = { ...nextItems[i], weight: e.target.value === '' ? '' : Number(e.target.value) };
                                setEditOrderData({ ...editOrderData, items: nextItems });
                              }}
                              placeholder="น้ำหนัก (กก.)"
                            />
                            <input
                              type="number" step="0.01" className={styles.input} value={it.price ?? ''}
                              onChange={e => {
                                const nextItems = [...editOrderData.items];
                                nextItems[i] = { ...nextItems[i], price: e.target.value === '' ? '' : Number(e.target.value) };
                                setEditOrderData({ ...editOrderData, items: nextItems });
                              }}
                              placeholder="ราคา (บาท)"
                            />
                          </div>
                        ))}
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          เพิ่ม/ลบรายการสินค้าไม่ได้ในหน้านี้ — ถ้าต้องแก้จำนวนรายการ กรุณาลบออเดอร์แล้วลงใหม่
                        </div>
                      </div>
                    ) : (
                      <div className={styles.mobileStackGrid} style={{ display: editOrderData.platform === "Storefront" && editOrderData.customerName === "วางขายหน้าร้าน" ? 'none' : 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                          <label className={styles.label}>ราคาสินค้า (บาท)</label>
                          <input type="number" step="0.01" className={styles.input} value={editOrderData.price ?? ''} onChange={e => setEditOrderData({ ...editOrderData, price: e.target.value })} />
                        </div>
                        <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                          <label className={styles.label}>น้ำหนัก (กก.)</label>
                          <input type="text" className={styles.input} value={editOrderData.crispyPorkWeight || ''} onChange={e => setEditOrderData({ ...editOrderData, crispyPorkWeight: e.target.value })} />
                        </div>
                        <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                          <label className={styles.label}>จำนวนชิ้น</label>
                          <input type="text" className={styles.input} value={editOrderData.crispyPorkPiece || ''} onChange={e => setEditOrderData({ ...editOrderData, crispyPorkPiece: e.target.value })} />
                        </div>
                      </div>
                    )}
                    <div className={styles.formGroup}>
                      <label className={styles.label}>เก็บปลายทาง (บาท)</label>
                      <input type="number" step="0.01" className={styles.input} value={editOrderData.codAmount ?? ''} onChange={e => setEditOrderData({ ...editOrderData, codAmount: e.target.value })} />
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
                      <div
                        tabIndex={0}
                        onPaste={handleEditSlipPaste}
                        style={{
                          border: '2px dashed rgba(88,166,255,0.4)',
                          borderRadius: '8px',
                          padding: '14px',
                          background: 'rgba(88,166,255,0.05)',
                          opacity: (editOrderData.paymentStatus === "Unpaid" || editOrderData.paymentStatus === "COD") ? 0.5 : 1,
                        }}
                      >
                        <div style={{ fontSize: '13px', color: 'var(--accent-blue)', marginBottom: '10px', fontWeight: 'bold' }}>
                          📋 คลิกตรงนี้แล้วกด Ctrl+V เพื่อวางรูปสลิป หรือเลือกไฟล์ด้านล่าง
                        </div>
                        <input type="file" accept="image/*" onChange={handleEditFileUpload} className={styles.input} style={{ padding: '8px' }} disabled={isEditUploading || editOrderData.paymentStatus === "Unpaid" || editOrderData.paymentStatus === "COD"} />
                        {isEditUploading && <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginLeft: '8px' }}>กำลังอัปโหลด...</span>}
                      </div>
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

                      {/* Extra slips — ลูกค้าโอนไม่ครบรอบแรกแล้วโอนเพิ่มรอบหลัง */}
                      {editExtraSlips.map((slip, index) => (
                        <div key={index} style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed rgba(var(--surface-rgb),0.15)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>สลิปเพิ่มเติม #{index + 1}</span>
                            <button type="button" onClick={() => removeEditExtraSlip(index)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '12px' }}>✕ ลบ</button>
                          </div>
                          {!slip.url ? (
                            <div
                              tabIndex={0}
                              onPaste={(e) => handleEditExtraSlipPaste(index, e)}
                              style={{ border: '2px dashed rgba(88,166,255,0.4)', borderRadius: '8px', padding: '14px', background: 'rgba(88,166,255,0.05)' }}
                            >
                              <div style={{ fontSize: '13px', color: 'var(--accent-blue)', marginBottom: '10px', fontWeight: 'bold' }}>
                                📋 คลิกตรงนี้แล้วกด Ctrl+V เพื่อวางรูปสลิป หรือเลือกไฟล์ด้านล่าง
                              </div>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <input type="file" accept="image/*" onChange={(e) => handleEditExtraSlipFileInput(index, e)} className={styles.input} style={{ padding: '8px' }} disabled={slip.uploading} />
                                {slip.uploading && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>กำลังอัปโหลด...</span>}
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: '12px' }}>
                              <a href={slip.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>ดูสลิปที่อัปโหลด</a>
                            </div>
                          )}
                          <SlipVerificationBadge result={slip.verification} />
                        </div>
                      ))}
                      {editOrderData.transferSlip && editOrderData.paymentStatus !== "Unpaid" && editOrderData.paymentStatus !== "COD" && (
                        <button type="button" onClick={addEditExtraSlipSlot} style={{ marginTop: '10px', background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.3)', color: 'var(--accent-blue)', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>
                          + เพิ่มสลิป (ถ้าลูกค้าโอนไม่ครบแล้วโอนเพิ่ม)
                        </button>
                      )}
                      <CombinedSlipSummary totalVerified={editTotalVerifiedSlipAmount} expectedTotal={editExpectedPaymentTotal} slipCount={editAllSlipResults.filter(Boolean).length} />
                      {editHasSlipIssue && (
                        <SlipIssueReasonPicker reason={editSlipIssueReason} onReasonChange={setEditSlipIssueReason} otherText={editSlipIssueOtherText} onOtherTextChange={setEditSlipIssueOtherText} />
                      )}
                    </div>

                    <div className={styles.formGroup}>
                      <label className={styles.label}>หมายเหตุแอดมิน</label>
                      <input type="text" className={styles.input} value={editOrderData.adminNote || ''} onChange={e => setEditOrderData({ ...editOrderData, adminNote: e.target.value })} />
                    </div>
                  </div>

                  <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(var(--surface-rgb),0.1)', display: 'flex', justifyContent: 'flex-end', gap: '12px', flexShrink: 0 }}>
                    <button type="button" onClick={handleCancelEditOrder} className={styles.button} style={{ background: 'rgba(var(--surface-rgb),0.08)' }}>ยกเลิก</button>
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
                      <div style={{ background: 'rgba(var(--surface-rgb),0.03)', border: '1px dashed rgba(var(--surface-rgb),0.15)', borderRadius: '10px', padding: '14px 16px', marginBottom: '24px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        📦 นี่คือการวางขายหน้าร้าน (ตัดสต๊อคหมูเฉยๆ ยังไม่มียอดขาย) — ยอดขายจริงจะดึงมาจากระบบ POS ในอนาคต
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
                        <div style={{ flex: 1, background: 'rgba(var(--surface-rgb),0.04)', borderRadius: '10px', padding: '12px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: '19px', fontWeight: 'bold', color: 'var(--text-primary)' }}>฿{formatMoney(selectedOrder.price)}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>ราคาสินค้า</div>
                        </div>
                        <div style={{ flex: 1, background: 'rgba(var(--surface-rgb),0.04)', borderRadius: '10px', padding: '12px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: '19px', fontWeight: 'bold', color: 'var(--text-primary)' }}>฿{formatMoney(selectedOrder.codAmount)}</div>
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
                      <DetailRow label="เบอร์โทร" value={selectedOrder.customerPhone || '-'} />
                      <DetailRow label="รหัสไปรษณีย์" value={selectedOrder.customerZip || '-'} />
                      <DetailRow label="ใบกำกับภาษี" value={selectedOrder.needsTaxInvoice ? <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>🧾 ต้องการ</span> : 'ไม่ต้องการ'} />
                    </DetailSection>

                    <DetailSection title="สินค้า">
                      {getEffectiveItems(selectedOrder).length > 1 && getEffectiveItems(selectedOrder).map((it, i) => (
                        <DetailRow
                          key={i}
                          label={PRODUCT_TYPES[it.productType]?.label || it.productType}
                          value={`${it.weight} กก.${it.pieceCount ? ` (${it.pieceCount} ชิ้น)` : ''} — ฿${formatMoney(it.price)}`}
                        />
                      ))}
                      <DetailRow label="น้ำหนักรวม" value={`${selectedOrder.crispyPorkWeight || '-'} กก.`} />
                      <DetailRow label="จำนวนชิ้นรวม" value={selectedOrder.crispyPorkPiece || '-'} />
                      <DetailRow
                        label="ชิ้นหมูที่ใช้"
                        value={rackPieces.length > 0 ? rackPieces.map(r => `${r.rackNo} (${r.weight}กก.)`).join(', ') : '-'}
                      />
                    </DetailSection>

                    {orderHasNoRealStock(selectedOrder) && (
                      <div style={{ margin: '0 24px 20px', padding: '16px', borderRadius: '10px', border: '1px solid #ff6b6b', background: 'rgba(255,107,107,0.06)' }}>
                        <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#ff6b6b', marginBottom: '10px' }}>
                          ⚠️ ออเดอร์นี้ยังไม่ได้ตัดสต็อกหมูจริงเลย — กรุณาเติมหมูเข้าไป
                        </div>
                        <AssignItemPicker
                          item={{
                            productType: getEffectiveItems(selectedOrder)[0]?.productType || DEFAULT_PRODUCT_TYPE,
                            weightKg: sumItemsWeight(getEffectiveItems(selectedOrder)),
                          }}
                          racks={currentUser?.racks || []}
                          selected={assignOrderSelections}
                          onToggle={handleToggleOrderStockPiece}
                          onSave={handleSaveOrderStock}
                          isBusy={isAssigningOrderStock}
                        />
                      </div>
                    )}

                    <DetailSection title="การจัดส่ง">
                      <DetailRow
                        label="เลขพัสดุ"
                        value={selectedOrder.trackingNumber ? <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>{selectedOrder.trackingNumber}</span> : '-'}
                      />
                      <DetailRow
                        label="วันที่ส่งจริง"
                        value={selectedOrder.trackingSetAt ? new Date(selectedOrder.trackingSetAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-'}
                      />
                      <DetailRow
                        label="สลิปโอนเงิน"
                        value={selectedOrder.transferSlip ? <a href={selectedOrder.transferSlip} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>ดูสลิป</a> : '-'}
                      />
                      {selectedOrder.extraSlips?.length > 0 && (
                        <DetailRow
                          label="สลิปเพิ่มเติม"
                          value={
                            <span>
                              {selectedOrder.extraSlips.map((s: any, i: number) => (
                                <span key={s.id}>
                                  {i > 0 && ', '}
                                  <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>สลิป #{i + 2}</a>
                                </span>
                              ))}
                            </span>
                          }
                        />
                      )}
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

      {deleteChoiceOrder && (
        <div className={styles.modalOverlay}>
          <div className={styles.alertBox}>
            <div className={styles.alertIcon}>🗑️</div>
            <h3 className={styles.alertTitle}>ลบออเดอร์ "{deleteChoiceOrder.customerName}"</h3>
            <p className={styles.alertText}>
              การลบนี้ย้อนกลับไม่ได้ (น้ำหนักหมูที่ตัดไปจะถูกคืนเข้าคลังให้อัตโนมัติ) — ออเดอร์นี้เกิดจากอะไร?
            </p>
            <div className={styles.alertActions}>
              <button className={styles.btnCancel} onClick={() => setDeleteChoiceOrder(null)} disabled={isDeletingOrder}>
                ยกเลิก
              </button>
              <button
                onClick={() => confirmDeleteOrder(deleteChoiceOrder, "mistake")}
                disabled={isDeletingOrder}
                style={{ padding: "10px 18px", borderRadius: "8px", background: "rgba(var(--surface-rgb),0.08)", border: "1px solid rgba(var(--surface-rgb),0.2)", color: "var(--text-secondary)", cursor: isDeletingOrder ? "wait" : "pointer", fontSize: "13px", fontWeight: "bold" }}
              >
                ✏️ กรอกข้อมูลผิด
              </button>
              <button
                onClick={() => confirmDeleteOrder(deleteChoiceOrder, "cancelled")}
                disabled={isDeletingOrder}
                style={{ padding: "10px 18px", borderRadius: "8px", background: "rgba(255,107,107,0.15)", border: "1px solid #ff6b6b", color: "#ff6b6b", cursor: isDeletingOrder ? "wait" : "pointer", fontSize: "13px", fontWeight: "bold" }}
              >
                🚫 ยกเลิกจริง คืนเงิน
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
