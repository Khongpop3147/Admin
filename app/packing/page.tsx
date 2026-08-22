"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";
import { useRef } from "react";
import { useUser } from "../../components/UserProvider";
import { isSuperAdminRole } from "../../lib/roles";
import { BASE_PATH } from "../../lib/basePath";
import { nextDayStr, previousDayStr } from "../../lib/packingCutoff";
import { getShippingContact, isValidPhone, isValidZip } from "../../lib/addressParse";
import { findShipDateInRows, filterTrackingRowsToClosestDate, extractCellDateStr, TrackingRow } from "../../lib/trackingImport";
import { formatDateDDMMYY_BE } from "../../lib/thaiDate";
import { computeBoxCount, MAX_WEIGHT_PER_BOX_KG } from "../../lib/shipping";
import { getBaseRackKeyAuto, PRODUCT_TYPES, DEFAULT_PRODUCT_TYPE } from "../../lib/rackCode";
import { getEffectiveItems } from "../../lib/orderItems";
import styles from "../page.module.css";

// A courier shipping label/export needs a real product name, not a
// hardcoded "หมูกรอบ" — that was safe when only one product existed, but
// now that an order can hold a mix (see lib/orderItems.ts), the printed
// label has to name whatever's actually in the box. Falls back to the
// default product's label for legacy orders with no OrderItem rows, and
// joins multiple distinct products with "+" for a mixed order.
function getOrderProductLabel(order: { items?: { productType: string }[]; crispyPorkWeight?: string | null; crispyPorkPiece?: string | null; price?: number | null }): string {
  const items = getEffectiveItems(order as any);
  if (items.length === 0) return PRODUCT_TYPES[DEFAULT_PRODUCT_TYPE]?.label || DEFAULT_PRODUCT_TYPE;
  const labels = Array.from(new Set(items.map((it) => PRODUCT_TYPES[it.productType]?.label || it.productType)));
  return labels.join(" + ");
}

function formatMoney(value: unknown): string {
  const num = typeof value === "string" ? parseFloat(value) : (value as number);
  if (num === undefined || num === null || isNaN(num)) return "0";
  return Math.round(num).toLocaleString("th-TH");
}

interface Order {
  id: string;
  orderNo: number;
  customerName: string;
  customerAddress: string;
  customerPhone: string | null;
  customerZip: string | null;
  shippingMethod: string;
  isCod: boolean;
  codAmount: number;
  codConfirmed: boolean;
  isReturned: boolean;
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
  boxPieceCounts: string | null;
  items?: { productType: string; weight: number; pieceCount: number | null; price: number }[];
}

export default function PackingPage() {
  const { currentUser } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (currentUser && !isSuperAdminRole(currentUser.role) && currentUser.role !== "PACKING") {
      router.replace("/orders");
    }
  }, [currentUser, router]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterShipping, setFilterShipping] = useState("All");
  const [sortBy, setSortBy] = useState<"date" | "admin">("date");
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [viewingRacks, setViewingRacks] = useState<Order | null>(null);
  const [nicknameByName, setNicknameByName] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const codFileInputRef = useRef<HTMLInputElement>(null);
  // Tracks which date the most recently *fired* fetch was for, so that if the
  // admin flips the date picker quickly (e.g. A -> B -> A) and the requests
  // resolve out of order, a late-arriving response for an old date can't
  // clobber the screen with stale (or empty) data for the current date.
  const latestRequestedDateRef = useRef<string | null>(null);

  // selectedDate is "the day Packing is working" — the day these pieces
  // actually get packed/shipped. Orders are entered by admins the day
  // *before* that, so this defaults to tomorrow (not today): open the page
  // any time today and it already shows today's growing batch, ready for
  // tomorrow's packing, without anyone needing to flip the date picker
  // forward manually.
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
    const d = new Date(today);
    const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return nextDayStr(todayStr);
  });

  useEffect(() => {
    fetchOrders();
  }, [selectedDate]);

  useEffect(() => {
    fetch(`${BASE_PATH}/api/users`)
      .then(res => res.json())
      .then(data => {
        const map: Record<string, string> = {};
        (data.users || []).forEach((u: any) => {
          if (u.nickname) map[u.name] = u.nickname;
        });
        setNicknameByName(map);
      })
      .catch(() => {});
  }, []);

  // Returns the freshly-fetched list (not just setting state) so callers
  // that need to act on the result right away — like checking for orders
  // still missing a tracking number after an import — don't have to work
  // around the stale-closure problem of reading `orders` right after calling this.
  const fetchOrders = async (): Promise<Order[] | undefined> => {
    const requestedDate = selectedDate;
    latestRequestedDateRef.current = requestedDate;
    setIsLoading(true);
    try {
      // Orders are entered under the day *before* selectedDate (see the
      // comment on selectedDate above) — filter by that entryDate, not the
      // real createdAt instant, so a backdated/forward-dated order shows up
      // on the Packing day it was actually entered for.
      const res = await fetch(`${BASE_PATH}/api/orders?entryDate=${previousDayStr(requestedDate)}`);
      const data = await res.json();
      // A newer request may have fired (and already resolved) while this one
      // was in flight — if so, drop this response instead of overwriting the
      // screen with data for a date the user has since navigated away from.
      if (latestRequestedDateRef.current !== requestedDate) return undefined;
      if (res.ok) {
        const packingOrders = data.orders.filter((o: any) =>
          o.orderStatus !== "Completed" &&
          o.platform !== "Storefront" &&
          o.shippingMethod !== "รับหน้าร้าน" &&
          o.shippingMethod !== "ส่งเอง"
        );
        setOrders(packingOrders);
        return packingOrders;
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (latestRequestedDateRef.current === requestedDate) setIsLoading(false);
    }
    return undefined;
  };


  const updateOrderStatus = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`${BASE_PATH}/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderStatus: newStatus, editedBy: currentUser?.name })
      });
      if (res.ok) {
        setOrders(orders.map(o => o.id === id ? { ...o, orderStatus: newStatus } : o));
      } else {
        alert("เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
    } catch (e) {
      console.error(e);
      alert("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    }
  };

  const updateTracking = async (id: string, tracking: string) => {
    try {
      const res = await fetch(`${BASE_PATH}/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingNumber: tracking, editedBy: currentUser?.name })
      });
      if (res.ok) {
        setOrders(orders.map(o => o.id === id ? { ...o, trackingNumber: tracking } : o));
      } else {
        alert("บันทึกเลขพัสดุไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
    } catch (e) {
      console.error(e);
      alert("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    }
  };

  // Recovery for the "courier's cancelled-shipment rows got joined into a
  // real tracking number" mess (see handleImportTracking's cancelled-row
  // skip) — resets every EMS order on the currently-viewed date that still
  // has no tracking number back to "รอดำเนินการ" (Pending), in case a bad
  // import had already flipped it to "จัดส่งแล้ว" (Shipped) despite there
  // being no real tracking number behind that status.
  const resetMissingEmsToPending = async () => {
    const targets = orders.filter((o) => o.shippingMethod === "EMS" && !o.trackingNumber && o.orderStatus !== "Pending");
    if (targets.length === 0) {
      alert("ไม่มีออเดอร์ EMS ที่ไม่มีเลข Tracking ต้องแก้ไข");
      return;
    }
    if (!confirm(`ตั้งสถานะ "รอดำเนินการ" ให้ออเดอร์ EMS ที่ไม่มีเลข Tracking จำนวน ${targets.length} รายการ ใช่หรือไม่?\n\n${targets.map((o) => `- #${o.orderNo || "?"} ${o.customerName}`).join("\n")}`)) {
      return;
    }
    let failCount = 0;
    for (const o of targets) {
      try {
        const res = await fetch(`${BASE_PATH}/api/orders/${o.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderStatus: "Pending", editedBy: currentUser?.name }),
        });
        if (res.ok) {
          setOrders((prev) => prev.map((p) => (p.id === o.id ? { ...p, orderStatus: "Pending" } : p)));
        } else {
          failCount++;
        }
      } catch (e) {
        console.error(e);
        failCount++;
      }
    }
    alert(failCount > 0 ? `ตั้งสถานะสำเร็จ ${targets.length - failCount} รายการ, ล้มเหลว ${failCount} รายการ` : `ตั้งสถานะ "รอดำเนินการ" สำเร็จ ${targets.length} รายการ`);
  };

  interface RackPiece { assignmentId: string; rackNo: string; weight: number }

  // The individual pork pieces this order actually pulled from the rack —
  // same source data the "ถาดที่ใช้" modal reads. Each entry's index here is
  // what a box's index list (below) refers to.
  const getOrderPieces = (order: Order): RackPiece[] => {
    if (!order.rackDetails) return [];
    try {
      const parsed = JSON.parse(order.rackDetails);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  };

  // boxPieceCounts only ever stores the EXTRA boxes (box 2, 3, ...), each as
  // a list of indices into getOrderPieces(order) — exactly which physical
  // pork pieces the packer ticked into that box. Box 1 is never entered by
  // hand, it's always just "whatever's left" (every piece not claimed by
  // another box), computed fresh by getBox1Indices below rather than stored.
  const getExtraBoxes = (order: Order): number[][] => {
    if (!order.boxPieceCounts) return [];
    try {
      const parsed = JSON.parse(order.boxPieceCounts);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((arr: unknown): arr is number[] => Array.isArray(arr) && arr.every((n) => typeof n === 'number'));
    } catch (e) {
      return [];
    }
  };

  const getBox1Indices = (order: Order): number[] => {
    const total = getOrderPieces(order).length;
    const used = new Set(getExtraBoxes(order).flat());
    const result: number[] = [];
    for (let i = 0; i < total; i++) if (!used.has(i)) result.push(i);
    return result;
  };

  // Exact sum of the real per-piece weights for the given rack-piece indices
  // — since the packer ticks the actual pieces going in each box, this is a
  // real total, not a proportional estimate.
  const getBoxWeight = (order: Order, indices: number[]): number => {
    const pieces = getOrderPieces(order);
    const sum = indices.reduce((s, i) => s + (Number(pieces[i]?.weight) || 0), 0);
    return Math.round(sum * 100) / 100;
  };

  const saveBoxes = async (order: Order, extraBoxes: number[][]) => {
    const value = extraBoxes.length > 0 ? JSON.stringify(extraBoxes) : null;
    setOrders(orders.map(o => o.id === order.id ? { ...o, boxPieceCounts: value } : o));
    try {
      const res = await fetch(`${BASE_PATH}/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boxPieceCounts: value, editedBy: currentUser?.name })
      });
      if (!res.ok) {
        // Revert on failure so the screen doesn't lie about what's saved.
        setOrders(orders.map(o => o.id === order.id ? { ...o, boxPieceCounts: order.boxPieceCounts } : o));
      }
    } catch (e) {
      console.error(e);
      setOrders(orders.map(o => o.id === order.id ? { ...o, boxPieceCounts: order.boxPieceCounts } : o));
    }
  };

  // Which order (by id) currently has the "tick pork pieces for a new box"
  // popup open — only one at a time. pickedIndices holds the in-progress
  // selection inside that popup before it's confirmed.
  const [boxPickerForId, setBoxPickerForId] = useState<string | null>(null);
  const [pickedIndices, setPickedIndices] = useState<number[]>([]);

  const openBoxPicker = (order: Order) => {
    setBoxPickerForId(order.id);
    setPickedIndices([]);
  };

  const togglePickedIndex = (i: number) => {
    setPickedIndices((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]);
  };

  const confirmBoxPicker = (order: Order) => {
    if (pickedIndices.length === 0) return;
    saveBoxes(order, [...getExtraBoxes(order), pickedIndices]);
    setBoxPickerForId(null);
    setPickedIndices([]);
  };

  const removeBox = (order: Order, index: number) => {
    saveBoxes(order, getExtraBoxes(order).filter((_, i) => i !== index));
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;
    
    try {
      const res = await fetch(`${BASE_PATH}/api/orders/${editingOrder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: editingOrder.customerName,
          customerAddress: editingOrder.customerAddress,
          customerPhone: editingOrder.customerPhone,
          customerZip: editingOrder.customerZip,
          codAmount: editingOrder.codAmount,
          crispyPorkPiece: editingOrder.crispyPorkPiece,
          crispyPorkWeight: editingOrder.crispyPorkWeight,
          adminNote: editingOrder.adminNote,
          editedBy: currentUser?.name
        })
      });
      
      if (res.ok) {
        setOrders(orders.map(o => o.id === editingOrder.id ? editingOrder : o));
        setEditingOrder(null);
      } else {
        alert("บันทึกไม่สำเร็จ");
      }
    } catch (error) {
      console.error(error);
      alert("เกิดข้อผิดพลาดขณะบันทึก");
    }
  };

  // Groups same-admin orders together when sorting by admin (stable sort
  // keeps each admin's own orders in their original date order); otherwise
  // leaves the API's own newest-first order untouched.
  const sortOrders = (list: Order[]) => {
    if (sortBy !== "admin") return list;
    return [...list].sort((a, b) => (a.sellerName || "").localeCompare(b.sellerName || "", "th"));
  };

  const matchesStatusFilter = (o: Order) => !filterStatus || filterStatus === "All" || o.orderStatus === filterStatus || (!o.orderStatus && filterStatus === "Pending");
  // View-only filter (which shipping method to look at on screen) — kept
  // separate from the export buttons' own shipping-method filtering, which
  // always splits Postone/NIM correctly regardless of what's shown here.
  const matchesShippingFilter = (o: Order) => filterShipping === "All" || o.shippingMethod === filterShipping;

  // Postone only needs the shipper's own name/phone/address filled in once
  // per file — leaving it blank on every other row makes it fall back to
  // that first row's shipper automatically. Shared by the combined export
  // and the per-admin split (handleExportPostoneByAdmin) so "first row" is
  // always relative to whatever list is actually going into one file.
  const buildPostoneRows = (orderList: Order[]) => {
    const SENDER_NAME = "หมูกรอบอีซี่ l หมูกรอบ EASY";
    const SENDER_PHONE = "0999818018";
    const SENDER_ADDRESS = "153, ตำบล สมอแข อำเภอเมืองพิษณุโลก พิษณุโลก";
    const SENDER_ZIP = "65000";
    const COD_ACCOUNT = "0644177042";

    const rows: (string | number)[][] = [];
    let rowIndex = 0; // across the whole file, not per-order — "first row" (sender info) means the very first row only

    orderList.forEach((order) => {
      const { phone, zip, address } = getShippingContact(order);

      // adminNote (internal packing/admin remarks) is deliberately left out of
      // this column — it's for staff, not something that should go out on the
      // shipping label.
      const boxCount = computeBoxCount(Number(order.crispyPorkWeight) || 0);
      const extraBoxes = getExtraBoxes(order);
      const box1Count = getBox1Indices(order).length;
      // Each box ships as its own physical parcel and gets its own tracking
      // number from the courier — so it needs its own row here too, not one
      // combined row with a note. Only splits once every extra box has
      // actually been recorded and box 1's remainder is still positive
      // (checked before export ever calls this); otherwise falls back to a
      // single row, same as before.
      const useBoxSplit = boxCount > 1 && extraBoxes.length === boxCount - 1 && box1Count > 0;
      const boxesForRows: (number | null)[] = useBoxSplit ? [box1Count, ...extraBoxes.map((b) => b.length)] : [null];

      // The COD column has to be the FULL amount the courier collects in
      // cash from the customer (product + shipping + COD fee) — not just
      // the small COD service fee alone, or Postone would only ever get
      // back a fraction of what's actually owed. Only the first box's row
      // carries it — the courier collects once per delivery, not per box.
      const isCodOrder = Number(order.codAmount) > 0;
      const codTotal = isCodOrder ? (Number(order.actualReceivedAmount) || Number(order.codAmount)) : "";

      const productLabel = getOrderProductLabel(order);
      boxesForRows.forEach((pieces, boxIdx) => {
        const isFirstRow = rowIndex === 0;
        const note = useBoxSplit
          ? `${productLabel} ชิ้น: ${pieces} (กล่อง ${boxIdx + 1}/${boxesForRows.length})`
          : `${productLabel} ชิ้น: ${order.crispyPorkPiece || '-'} น้ำหนัก: ${order.crispyPorkWeight || '-'}kg`
            + (boxCount > 1 ? ` (แบ่ง ${boxCount} กล่อง)` : "");

        rows.push([
          isFirstRow ? SENDER_NAME : "",
          isFirstRow ? SENDER_PHONE : "",
          isFirstRow ? SENDER_ADDRESS : "",
          isFirstRow ? SENDER_ZIP : "",
          "E", "", isCodOrder ? COD_ACCOUNT : "",
          boxIdx === 0 ? codTotal : "",
          note,
          order.customerName, phone, address, zip
        ]);
        rowIndex++;
      });
    });

    return rows;
  };

  // Blocks export until every order needing more than 1 box has a complete
  // box breakdown recorded via "+ เพิ่มกล่อง" — otherwise Postone/NIM can't
  // know how many pieces go on each box's own row/label, and a box's
  // tracking number would have nowhere correct to land on import.
  const confirmBoxBreakdownComplete = (orderList: Order[]): boolean => {
    const incomplete = orderList.filter((order) => {
      const boxCount = computeBoxCount(Number(order.crispyPorkWeight) || 0);
      if (boxCount <= 1) return false;
      const extraBoxes = getExtraBoxes(order);
      // Box 1 isn't entered by hand — it's the remainder — but that
      // remainder still has to be a real, positive count of pieces.
      return extraBoxes.length !== boxCount - 1 || getBox1Indices(order).length <= 0;
    });
    if (incomplete.length === 0) return true;
    alert(
      `ยังแบ่งกล่องไม่ครบ ${incomplete.length} ออเดอร์ — กด "+ เพิ่มกล่อง" ในตารางให้ครบก่อน export:\n\n` +
      incomplete.map((o) => `- ${o.customerName} (${o.crispyPorkWeight} กก. ต้องการ ${computeBoxCount(Number(o.crispyPorkWeight) || 0)} กล่อง)`).join('\n')
    );
    return false;
  };

  // NIM Express ships via its own separate export (see handleExportNim),
  // and "ส่งในพื้นที่" is delivered locally by the shop itself — neither
  // ever goes through Postone.
  const getPostoneEligibleOrders = () =>
    sortOrders(orders.filter(o => matchesStatusFilter(o) && o.shippingMethod !== "NIM Express" && o.shippingMethod !== "ส่งในพื้นที่"));


  // Fills the real Postone template with a given set of data rows — shared
  // by the single combined export and each per-admin file in the ZIP, so
  // both stay byte-for-byte identical in structure to Postone's own template.
  const fillPostoneTemplate = async (dataRows: ReturnType<typeof buildPostoneRows>) => {
    const templateRes = await fetch(`${BASE_PATH}/Postone_Template.xlsx`);
    if (!templateRes.ok) throw new Error('โหลดไฟล์ template ไม่สำเร็จ');
    const templateBuffer = await templateRes.arrayBuffer();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(templateBuffer);
    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) throw new Error('ไม่พบชีตในไฟล์ template');

    // Template's own example row starts at row 3 (rows 1-2 are the
    // headers) — overwrite it and every row after with real order data.
    // Column N (instructions) is left completely untouched since our rows
    // are only 13 columns wide (A-M).
    dataRows.forEach((row, i) => {
      const excelRow = worksheet.getRow(i + 3);
      row.forEach((val, colIdx) => {
        excelRow.getCell(colIdx + 1).value = val;
      });
      excelRow.commit();
    });

    return workbook.xlsx.writeBuffer();
  };

  const handlePreview = () => {
    const exportOrders = getPostoneEligibleOrders();
    if (exportOrders.length === 0) {
      alert("ไม่มีออเดอร์ให้แสดงตัวอย่าง");
      return;
    }
    if (!confirmBoxBreakdownComplete(exportOrders)) return;
    setPreviewData(buildPostoneRows(exportOrders));
    setShowPreview(true);
  };

  const handleExportPostone = async () => {
    const exportOrders = getPostoneEligibleOrders();
    if (exportOrders.length === 0) {
      alert("ไม่มีออเดอร์ให้ส่งออก");
      return;
    }
    if (!confirmBoxBreakdownComplete(exportOrders)) return;
    const dataRows = buildPostoneRows(exportOrders);

    try {
      const buffer = await fillPostoneTemplate(dataRows);
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      // selectedDate is already the Bangkok-anchored date being exported —
      // using it (instead of new Date().toISOString(), which is UTC) avoids
      // the filename landing on the wrong day when exporting between
      // 00:00-06:59 Bangkok time, and is also just the more correct date to
      // put in the filename regardless (the date being exported, not the
      // moment of the click).
      saveAs(blob, `Postone_Export_${selectedDate}.xlsx`);

    } catch (error) {
      console.error("Error exporting excel:", error);
      alert("ส่งออกไฟล์ Excel ไม่สำเร็จ");
    }
  };

  // Same Postone template/eligibility as the combined export, narrowed
  // further to orders that still have no tracking number at all — a
  // re-sendable "what's Postone still missing" file, instead of having to
  // eyeball the full combined export for blank Tracking rows.
  const handleExportMissingTracking = async () => {
    const exportOrders = getPostoneEligibleOrders().filter((o) => !o.trackingNumber);
    if (exportOrders.length === 0) {
      alert("ไม่มีออเดอร์ที่ยังไม่มีเลข Tracking");
      return;
    }
    if (!confirmBoxBreakdownComplete(exportOrders)) return;
    const dataRows = buildPostoneRows(exportOrders);

    try {
      const buffer = await fillPostoneTemplate(dataRows);
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, `Postone_MissingTracking_${selectedDate}.xlsx`);
    } catch (error) {
      console.error("Error exporting excel:", error);
      alert("ส่งออกไฟล์ Excel ไม่สำเร็จ");
    }
  };

  // One Postone-template file per admin, zipped together — same eligible
  // orders and same template-filling logic as the combined export, just
  // grouped by sellerName first so each admin's own sheet is self-contained
  // (its own first-row sender info, not sharing one with everyone else's).
  const handleExportPostoneByAdmin = async () => {
    const exportOrders = getPostoneEligibleOrders();
    if (exportOrders.length === 0) {
      alert("ไม่มีออเดอร์ให้ส่งออก");
      return;
    }
    if (!confirmBoxBreakdownComplete(exportOrders)) return;

    const bySeller = new Map<string, Order[]>();
    for (const order of exportOrders) {
      const key = order.sellerName || "ไม่ระบุแอดมิน";
      if (!bySeller.has(key)) bySeller.set(key, []);
      bySeller.get(key)!.push(order);
    }

    try {
      const zip = new JSZip();
      for (const [sellerName, sellerOrders] of bySeller) {
        const buffer = await fillPostoneTemplate(buildPostoneRows(sellerOrders));
        // Slashes in a name would otherwise be read as a subfolder inside the zip.
        const safeName = sellerName.replace(/[\\/]/g, "-");
        zip.file(`Postone_${safeName}_${selectedDate}.xlsx`, buffer);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      saveAs(zipBlob, `Postone_ByAdmin_${selectedDate}.zip`);
    } catch (error) {
      console.error("Error exporting per-admin excel zip:", error);
      alert("ส่งออกไฟล์ Excel ไม่สำเร็จ");
    }
  };

  // NIM Express ships via a printable customer-address label sheet instead
  // of Postone — two labels per row, repeating down the sheet. Column
  // widths, merge shape, font (Tahoma 10), row heights, and every label's
  // exact wording are copied from a real, never-manually-edited blank slot
  // in the reference file the shop actually uses, not approximated —
  // column G/N (unused by the template's own fields) is where the courier
  // marker (NIM/NIM COD) goes, matching where staff already handwrite it.
  const handleExportNim = async () => {
    const nimOrders = sortOrders(orders.filter(o => matchesStatusFilter(o) && o.shippingMethod === "NIM Express"));
    if (nimOrders.length === 0) {
      alert("ไม่มีออเดอร์ NIM Express ให้ส่งออก");
      return;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const dateLabel = formatDateDDMMYY_BE(selectedDate);
      const worksheet = workbook.addWorksheet(dateLabel);

      const LABEL_FONT = { name: "Tahoma", size: 10 } as const;
      const CHECKBOX_TEXT = "☐ LINE                   ☐ FB";
      const PACKER_NAME = "นัยปพร";
      const BLOCK_HEIGHT = 15; // 14 content rows + 1 blank spacer row before the next pair

      worksheet.columns = [
        { width: 6.75 }, { width: 14.5 }, { width: 5.125 }, { width: 6.125 }, { width: 8.625 }, { width: 8.875 }, { width: 10.875 },
        { width: 6.75 }, { width: 14.5 }, { width: 5.125 }, { width: 6.125 }, { width: 8.625 }, { width: 8.875 }, { width: 10.875 },
      ];

      // Matches the reference file's own print setup exactly — without this,
      // the sheet prints using Excel's own defaults (portrait, wide margins),
      // not the landscape A4 label layout it's actually meant for.
      worksheet.pageSetup = {
        paperSize: 9, // A4
        orientation: "landscape",
        margins: { left: 0.3229166666666667, right: 0, top: 0.1968503937007874, bottom: 0.03937007874015748, header: 0.31496062992125984, footer: 0.31496062992125984 },
        pageOrder: "downThenOver",
        scale: 100,
        fitToPage: false,
      };

      const writeLabel = (startRow: number, colOffset: number, order: (typeof nimOrders)[number]) => {
        const { phone, address } = getShippingContact(order);
        const boxCount = computeBoxCount(Number(order.crispyPorkWeight) || 0);
        const courierLabel = (Number(order.codAmount) > 0 ? "NIM COD" : "NIM") + (boxCount > 1 ? ` 📦x${boxCount}` : "");
        const c = (n: number) => colOffset + n; // 0-based offset into this label's own 7 columns (A-G / H-N)

        const setCell = (r: number, col: number, value: string | number, align?: Partial<ExcelJS.Alignment>) => {
          const cell = worksheet.getRow(r).getCell(col);
          cell.value = value;
          cell.font = LABEL_FONT;
          cell.alignment = { horizontal: "left", vertical: "middle", ...align };
        };

        setCell(startRow, c(0), "ชื่อลูกค้า");
        setCell(startRow, c(1), order.customerName);
        worksheet.mergeCells(startRow, c(1), startRow, c(4));
        worksheet.getRow(startRow).height = 18;

        setCell(startRow + 1, c(0), "โทรศัพท์");
        setCell(startRow + 1, c(1), phone);
        worksheet.mergeCells(startRow + 1, c(1), startRow + 1, c(4));
        worksheet.getRow(startRow + 1).height = 18;

        setCell(startRow + 2, c(0), "ที่อยู่");
        setCell(startRow + 2, c(1), address, { wrapText: true, vertical: "top" });
        worksheet.mergeCells(startRow + 2, c(1), startRow + 6, c(4)); // 5 rows tall, like the source
        for (let r = startRow + 2; r <= startRow + 6; r++) worksheet.getRow(r).height = 18;

        setCell(startRow + 7, c(0), "สินค้า");
        setCell(startRow + 7, c(1), getOrderProductLabel(order));
        worksheet.getRow(startRow + 7).height = 18;

        setCell(startRow + 8, c(0), "น้ำหนัก:");
        setCell(startRow + 8, c(1), order.crispyPorkWeight ? Number(order.crispyPorkWeight) : "");
        setCell(startRow + 8, c(2), "กก.");
        setCell(startRow + 8, c(3), "จำนวน :");
        setCell(startRow + 8, c(4), order.crispyPorkPiece ? Number(order.crispyPorkPiece) : "");
        setCell(startRow + 8, c(5), "แผ่น");
        setCell(startRow + 8, c(6), courierLabel);
        worksheet.getRow(startRow + 8).height = 18;

        worksheet.getRow(startRow + 9).height = 18; // blank, matches the source

        setCell(startRow + 10, c(0), "ช่องทางขาย");
        worksheet.getRow(startRow + 10).height = 18;

        // One merged cell, not the same text repeated into every unmerged
        // column — writing it into each column separately (matching the
        // reference file's own layout) meant every narrow column truncated
        // its own copy to fit, so "LINE" visibly repeated across the row.
        setCell(startRow + 11, c(0), CHECKBOX_TEXT);
        worksheet.mergeCells(startRow + 11, c(0), startRow + 11, c(4));
        worksheet.getRow(startRow + 11).height = 18;

        worksheet.getRow(startRow + 12).height = 18; // blank, matches the source

        setCell(startRow + 13, c(0), "ผู้แพ็ค:");
        setCell(startRow + 13, c(1), PACKER_NAME);
        setCell(startRow + 13, c(3), "วันที่:");
        setCell(startRow + 13, c(4), dateLabel);
        worksheet.getRow(startRow + 13).height = 18;

        // Thin box around the whole label (A-G here, H-N for the second
        // label) — a cutting guide, since the reference file relies on
        // Excel's own on-screen gridlines for that, which don't print.
        const thin = { style: "thin" as const };
        const topRow = startRow, bottomRow = startRow + 13, leftCol = c(0), rightCol = c(6);
        for (let r = topRow; r <= bottomRow; r++) {
          for (let col = leftCol; col <= rightCol; col++) {
            const cell = worksheet.getRow(r).getCell(col);
            cell.border = {
              top: r === topRow ? thin : undefined,
              bottom: r === bottomRow ? thin : undefined,
              left: col === leftCol ? thin : undefined,
              right: col === rightCol ? thin : undefined,
            };
          }
        }
      };

      for (let i = 0; i < nimOrders.length; i += 2) {
        const rowStart = 1 + (i / 2) * BLOCK_HEIGHT;
        writeLabel(rowStart, 1, nimOrders[i]);
        if (nimOrders[i + 1]) {
          writeLabel(rowStart, 8, nimOrders[i + 1]);
        }
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, `NIM_Export_${selectedDate}.xlsx`);
    } catch (error) {
      console.error("Error exporting NIM excel:", error);
      alert("ส่งออกไฟล์ Excel ไม่สำเร็จ");
    }
  };

  const handleImportTracking = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet);

      // The file's own "กำหนดส่ง" (scheduled ship date) column is the only
      // way to know which day a courier export is actually for — the match
      // itself is scoped to whatever date is selected below, so importing a
      // stale/old file while viewing a different day could otherwise
      // silently hand a same-named customer someone else's tracking number.
      // Only warns when the file is OLDER than the selected date — Packing
      // legitimately ships some orders a day (or more) ahead of schedule, so
      // a file for today or later while viewing an earlier date is normal,
      // not a mistake; only a stale file lagging behind is worth a prompt.
      // Skips the check entirely (no prompt at all) when the column's
      // missing or unparseable, since that's not something this can verify.
      const fileShipDate = findShipDateInRows(rows as Record<string, unknown>[]);
      if (fileShipDate && fileShipDate < selectedDate) {
        const proceed = confirm(
          `ไฟล์นี้เป็นของวันที่ส่ง ${fileShipDate} ซึ่งเก่ากว่าวันที่ ${selectedDate} ที่กำลังดูอยู่ — ` +
          `เผลอหยิบไฟล์เก่ามาใส่หรือเปล่า? กด "ยกเลิก" ถ้าไม่แน่ใจ\n\n` +
          `ดำเนินการนำเข้าต่อเลยไหม?`
        );
        if (!proceed) return;
      }

      const rawRows: TrackingRow[] = [];
      let cancelledSkippedCount = 0;

      rows.forEach((row: any) => {
        // The column names might vary slightly, but according to user it's "ชื่อผู้รับ" and "Tracking"
        const name = row["ชื่อผู้รับ"] || row["ชื่อ-สกุล"] || row["Customer Name"];
        const tracking = row["Tracking"] || row["tracking"] || row["Tracking Number"];

        if (!name || !tracking) return;

        // The courier's export includes cancelled shipments alongside real
        // ones — their tracking number was never actually used, so
        // importing it would comma-join a dead number onto (or even
        // overwrite) the customer's real one. Skip the row entirely rather
        // than let it reach the name-matcher at all.
        const status = String(row["สถานะล่าสุด"] || "").trim();
        if (status.includes("ยกเลิก")) {
          cancelledSkippedCount++;
          return;
        }

        rawRows.push({
          customerName: String(name).trim(),
          trackingNumber: String(tracking).trim(),
          rowDate: extractCellDateStr(row["กำหนดส่ง"]),
        });
      });

      if (rawRows.length === 0) {
        alert("ไม่พบข้อมูลชื่อผู้รับหรือ Tracking ในไฟล์ที่อัปโหลด กรุณาตรวจสอบหัวคอลัมน์");
        return;
      }

      // A cumulative courier export can carry a repeat customer's rows from
      // several earlier ship dates alongside today's — without this, a
      // stale row gets comma-joined onto today's tracking number right
      // alongside the real one (see lib/trackingImport.ts). Keep only the
      // row(s) closest to the date actually being packed. rowDate is kept
      // (not stripped) so the server can still flag a lone, unmatched row
      // whose date doesn't line up with shipDate — see bulk-tracking route.
      const updates = filterTrackingRowsToClosestDate(rawRows, selectedDate);

      const res = await fetch(`${BASE_PATH}/api/orders/bulk-tracking`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Scope matching to only the orders shown for the currently-viewed
        // Packing date — same entryDate shift fetchOrders() itself uses —
        // so a same-named customer on a different (still-open) day never
        // gets matched by mistake.
        body: JSON.stringify({ updates, entryDate: previousDayStr(selectedDate), shipDate: selectedDate })
      });

      const result = await res.json();
      if (res.ok) {
        const freshOrders = await fetchOrders();
        // Flags any EMS order still sitting without a tracking number after
        // the import — whether it just wasn't in the file at all, or its
        // customer name didn't match closely enough to the courier's sheet.
        const missingEms = (freshOrders || []).filter((o) => o.shippingMethod === "EMS" && !o.trackingNumber);
        let message = `อัปเดต Tracking สำเร็จ ${result.successCount} รายการ`;
        if (cancelledSkippedCount > 0) {
          message += `\n\n🚫 ข้ามแถวที่ยกเลิกรายการ ${cancelledSkippedCount} รายการ (ไม่นำเลข Tracking มาใส่)`;
        }
        if (result.ambiguousCount > 0) {
          message += `\n\n⚠️ ชื่อกำกวม ตรงกับหลายออเดอร์พร้อมกัน — ต้องกรอกเลข Tracking เองให้ (${result.ambiguousCount} รายการ):\n${(result.ambiguousNames || []).map((n: string) => `- ${n}`).join("\n")}`;
        }
        if (missingEms.length > 0) {
          message += `\n\n⚠️ ออเดอร์ EMS ที่ยังไม่ได้เลข Tracking (${missingEms.length} รายการ):\n${missingEms.map((o) => `- ${o.orderNo || "?"} ${o.customerName}`).join("\n")}`;
        }
        alert(message);
      } else {
        alert("เกิดข้อผิดพลาดในการอัปเดต Tracking");
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะอ่านไฟล์");
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Reads every non-empty cell in the courier's file (not tied to a specific
  // column name, since every courier formats their report differently) and
  // lets the backend match whichever values happen to be real tracking
  // numbers on unconfirmed COD orders.
  const handleConfirmCod = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

      const candidates = new Set<string>();
      rows.forEach((row) => {
        row.forEach((cell) => {
          if (cell === undefined || cell === null || cell === "") return;
          const str = String(cell).trim();
          if (str.length >= 4) candidates.add(str);
        });
      });

      if (candidates.size === 0) {
        alert("ไม่พบข้อมูลในไฟล์ที่อัปโหลด");
        return;
      }

      const res = await fetch(`${BASE_PATH}/api/orders/confirm-cod`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingNumbers: Array.from(candidates) }),
      });

      const result = await res.json();
      if (res.ok && result.success) {
        const names = result.confirmed.map((o: any) => `${o.customerName} (${o.trackingNumber})`).join("\n");
        alert(
          `ยืนยันรับ COD สำเร็จ ${result.confirmed.length} ออเดอร์:\n${names || "-"}\n\n` +
          `(ยอด COD รวมที่ปลดล็อกเข้ายอดขาย: ฿${formatMoney(result.confirmed.reduce((s: number, o: any) => s + (Number(o.actualReceivedAmount) || 0), 0))})`
        );
        fetchOrders();
      } else {
        alert(result.error || "เกิดข้อผิดพลาดขณะยืนยันรับ COD");
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะอ่านไฟล์");
    } finally {
      setIsLoading(false);
      if (codFileInputRef.current) codFileInputRef.current.value = "";
    }
  };

  const handleToggleReturned = async (order: Order) => {
    const nextValue = !order.isReturned;
    if (nextValue && !confirm(`ยืนยันว่าออเดอร์ "${order.customerName}" ถูกตีกลับใช่ไหม? ค่าคอมของแอดมินจะโดนหัก 50 บาทสำหรับออเดอร์นี้`)) {
      return;
    }
    try {
      const res = await fetch(`${BASE_PATH}/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isReturned: nextValue, editedBy: currentUser?.name }),
      });
      if (res.ok) {
        setOrders(orders.map(o => o.id === order.id ? { ...o, isReturned: nextValue } : o));
      } else {
        alert("อัปเดตสถานะตีกลับไม่สำเร็จ");
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะอัปเดต");
    }
  };

  // Opened by the 🗑️ button below — the actual delete only fires once the
  // popup's "กรอกข้อมูลผิด" / "ยกเลิกจริง คืนเงิน" choice is made, since that
  // choice decides whether Dashboard's cancelled-sales banner counts this
  // (see the `reason` comment on DELETE /api/orders/[id]).
  const [deleteChoiceOrder, setDeleteChoiceOrder] = useState<Order | null>(null);

  const confirmDeleteOrder = async (order: Order, reason: "mistake" | "cancelled") => {
    setDeleteChoiceOrder(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/orders/${order.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (res.ok) {
        setOrders(orders.filter(o => o.id !== order.id));
      } else {
        alert(data.error || "ลบออเดอร์ไม่สำเร็จ");
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะลบออเดอร์");
    }
  };

  if (currentUser && !isSuperAdminRole(currentUser.role) && currentUser.role !== "PACKING") return null;

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', color: 'var(--text-primary)' }}>
      <div className={styles.header} style={{ textAlign: 'left', marginBottom: '24px' }}>
        <h1 className={styles.title} style={{ fontSize: '2rem' }}>แพ็คของและส่งออกไฟล์</h1>
        <p className={styles.subtitle}>ดูรายการออเดอร์ที่ต้องแพ็ค อัปเดตสถานะ และส่งออกไฟล์สำหรับขนส่ง</p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>วันที่</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{ padding: '10px 16px', borderRadius: '8px', background: 'rgba(var(--surface-rgb),0.1)', border: '1px solid rgba(var(--surface-rgb),0.2)', color: 'var(--text-primary)', fontSize: '14px' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>สถานะ</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: '10px 16px', borderRadius: '8px', background: 'rgba(var(--surface-rgb),0.1)', border: '1px solid rgba(var(--surface-rgb),0.2)', color: 'var(--text-primary)', fontSize: '14px' }}
            >
              <option value="All" style={{ color: '#000' }}>ทั้งหมด</option>
              <option value="Pending" style={{ color: '#000' }}>รอดำเนินการ</option>
              <option value="Packed" style={{ color: '#000' }}>แพ็คแล้ว</option>
              <option value="Shipped" style={{ color: '#000' }}>จัดส่งแล้ว</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>วิธีจัดส่ง</label>
            <select
              value={filterShipping}
              onChange={(e) => setFilterShipping(e.target.value)}
              style={{ padding: '10px 16px', borderRadius: '8px', background: 'rgba(var(--surface-rgb),0.1)', border: '1px solid rgba(var(--surface-rgb),0.2)', color: 'var(--text-primary)', fontSize: '14px' }}
            >
              <option value="All" style={{ color: '#000' }}>ทั้งหมด</option>
              <option value="EMS" style={{ color: '#000' }}>EMS</option>
              <option value="NIM Express" style={{ color: '#000' }}>NIM Express</option>
              <option value="ส่งในพื้นที่" style={{ color: '#000' }}>ส่งในพื้นที่</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>เรียงตาม</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "date" | "admin")}
              style={{ padding: '10px 16px', borderRadius: '8px', background: 'rgba(var(--surface-rgb),0.1)', border: '1px solid rgba(var(--surface-rgb),0.2)', color: 'var(--text-primary)', fontSize: '14px' }}
            >
              <option value="date" style={{ color: '#000' }}>วันที่ล่าสุด</option>
              <option value="admin" style={{ color: '#000' }}>แอดมิน</option>
            </select>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={handlePreview}
            className={styles.toolbarBtn}
            style={{ background: 'rgba(var(--surface-rgb),0.1)', border: '1px solid rgba(var(--surface-rgb),0.2)', color: 'var(--text-primary)' }}
          >
            👀 ดูตัวอย่างไฟล์
          </button>

          <button
            onClick={() => window.open(`${BASE_PATH}/packing/print?date=${selectedDate}`, '_blank')}
            className={styles.toolbarBtn}
            style={{ background: 'var(--accent-blue, #4a90e2)', color: '#fff' }}
          >
            🖨️ ปริ้นใบเบิกหมู
          </button>

          <button
            onClick={handleExportPostone}
            className={styles.toolbarBtn}
            style={{ background: 'var(--accent-green)', color: '#000' }}
          >
            📊 แปลงเป็น Excel (Postone)
          </button>

          <button
            onClick={handleExportPostoneByAdmin}
            className={styles.toolbarBtn}
            style={{ background: 'rgba(63,185,80,0.2)', border: '1px solid var(--accent-green)', color: 'var(--accent-green)' }}
            title="แยกไฟล์ Postone ทีละแอดมิน รวมเป็น ZIP ไฟล์เดียว"
          >
            📁 Postone แยกแอดมิน (ZIP)
          </button>

          <button
            onClick={handleExportMissingTracking}
            className={styles.toolbarBtn}
            style={{ background: 'rgba(255,107,107,0.15)', border: '1px solid #ff6b6b', color: '#ff6b6b' }}
            title="Export เฉพาะออเดอร์ EMS ที่ยังไม่มีเลข Tracking (เทมเพลต Postone เดิม)"
          >
            📋 Export ที่ยังไม่มี Track
          </button>

          <button
            onClick={resetMissingEmsToPending}
            className={styles.toolbarBtn}
            style={{ background: 'rgba(255,172,51,0.15)', border: '1px solid #ffac33', color: '#ffac33' }}
            title="ตั้งสถานะ 'รอดำเนินการ' ให้ออเดอร์ EMS ที่ยังไม่มีเลข Tracking ของวันที่กำลังดูอยู่ (แก้เคสสถานะเพี้ยนจากการ import track ที่ยกเลิกรายการ)"
          >
            🔄 EMS ไม่มี Track → รอดำเนินการ
          </button>

          <button
            onClick={handleExportNim}
            className={styles.toolbarBtn}
            style={{ background: '#f39c12', color: '#000' }}
          >
            📇 แปลงเป็น Excel (NIM)
          </button>

          <input
            type="file"
            accept=".xlsx, .xls, .csv"
            ref={fileInputRef}
            onChange={handleImportTracking}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className={styles.toolbarBtn}
            style={{ background: '#f39c12', color: '#fff' }}
          >
            📤 นำเข้าเลขพัสดุ
          </button>

          <input
            type="file"
            accept=".xlsx, .xls, .csv"
            ref={codFileInputRef}
            onChange={handleConfirmCod}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => codFileInputRef.current?.click()}
            className={styles.toolbarBtn}
            style={{ background: 'rgba(63,185,80,0.2)', border: '1px solid rgba(63,185,80,0.4)', color: 'var(--accent-green)' }}
            title="อัปโหลดไฟล์ Excel ที่มีเลขพัสดุ COD ที่ลูกค้าจ่ายเงินแล้ว เพื่อปลดล็อกยอดเข้า Dashboard"
          >
            🔓 ยืนยันรับ COD
          </button>

          <button
            onClick={() => router.push("/packing/cod-status")}
            className={styles.toolbarBtn}
            style={{ background: 'rgba(88,166,255,0.15)', border: '1px solid rgba(88,166,255,0.4)', color: 'var(--accent-blue)' }}
            title="ดูว่าออเดอร์ COD วันไหนยืนยันรับแล้ว วันไหนยังไม่ยืนยัน"
          >
            📊 สถานะ COD
          </button>

          {(isSuperAdminRole(currentUser?.role) || currentUser?.role === "PACKING") && (
            <button
              onClick={async () => {
                if (confirm("ต้องการเปลี่ยนสถานะออเดอร์ของวันนี้ทั้งหมดเป็น 'จัดส่งแล้ว' และเริ่มหน้าจอวันใหม่ใช่หรือไม่?\n\nออเดอร์ที่แอดมินเพิ่มเข้ามาหลังจากนี้ (แม้ยังเป็นวันเดิม) จะถูกนับเลขออเดอร์เป็นของวันถัดไปแทน")) {
                  setIsLoading(true);
                  try {
                    const res = await fetch(`${BASE_PATH}/api/orders/bulk`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ date: selectedDate, status: 'Shipped' })
                    });
                    if (res.ok) {
                      setSelectedDate(nextDayStr(selectedDate));
                    } else {
                      alert("เกิดข้อผิดพลาดในการเปลี่ยนสถานะ");
                      setIsLoading(false);
                    }
                  } catch(e) {
                    console.error(e);
                    alert("เกิดข้อผิดพลาด");
                    setIsLoading(false);
                  }
                }
              }}
              className={styles.toolbarBtn}
              style={{ background: '#4facfe', color: '#fff' }}
            >
              ✅ จบงานวันนี้ (เริ่มวันใหม่)
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>กำลังโหลด...</div>
      ) : (
        <div style={{ background: 'var(--input-bg)', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'rgba(var(--surface-rgb),0.05)', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
              <tr>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>ลูกค้า</th>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>รายการสินค้า</th>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>สถานะ</th>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>เลขพัสดุ</th>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {sortOrders(orders.filter(o => matchesStatusFilter(o) && matchesShippingFilter(o))).map(order => {
                // Packing was mixing up NIM Express and EMS rows in the
                // combined view — outline (not border, so it never fights
                // with the box-split cell's own red border above) every
                // cell in a NIM row so it reads as one blue-framed row at a
                // glance, regardless of sort/filter order.
                const isNim = order.shippingMethod === "NIM Express";
                const nimCellStyle: React.CSSProperties = isNim
                  ? { outline: '2px solid #4facfe', outlineOffset: '-2px' }
                  : {};
                return (
                <tr key={order.id} style={{ borderBottom: '1px solid var(--border-color)', background: order.isReturned ? 'rgba(255,107,107,0.06)' : undefined, opacity: order.isReturned ? 0.75 : 1 }}>
                  <td style={{ padding: '16px', verticalAlign: 'top', ...nimCellStyle }}>
                    <div style={{ fontWeight: 'bold' }}>{order.orderNo || "?"} - {order.customerName}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', maxWidth: '250px' }}>{order.customerAddress}</div>
                    {(() => {
                      const { phone, zip } = getShippingContact(order);
                      if (!phone && !zip) return null;
                      return (
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          {phone && <span>📞 {phone}</span>}
                          {phone && zip && <span> · </span>}
                          {zip && <span>📮 {zip}</span>}
                        </div>
                      );
                    })()}
                  </td>
                  <td style={{
                    padding: '16px', verticalAlign: 'top',
                    ...nimCellStyle,
                    ...(computeBoxCount(Number(order.crispyPorkWeight) || 0) > 1
                      ? { background: 'rgba(255,0,0,0.18)', border: '2px solid #ff3b3b', borderRadius: '6px' }
                      : {}),
                  }}>
                    {(() => {
                      const orderItems = getEffectiveItems(order);
                      // Only one product on this order (the vast majority) —
                      // keep showing the exact combined total as before, no
                      // need for a per-line breakdown of one line.
                      if (orderItems.length <= 1) {
                        return <div>{order.crispyPorkPiece ? `${order.crispyPorkPiece} ชิ้น` : '-'} / {order.crispyPorkWeight ? `${order.crispyPorkWeight} กก.` : '-'}</div>;
                      }
                      // Multiple products — a packer needs to know exactly
                      // which ones and how much of each to pull, not just a
                      // combined count that hides the mix.
                      return (
                        <div>
                          {orderItems.map((it, i) => (
                            <div key={i}>
                              {PRODUCT_TYPES[it.productType]?.label || it.productType}: {it.pieceCount ?? '-'} ชิ้น / {it.weight} กก.
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    {computeBoxCount(Number(order.crispyPorkWeight) || 0) > 1 && (
                      <div style={{ marginTop: '4px' }}>
                        <div style={{ fontSize: '12px', color: '#ff3b3b', fontWeight: 'bold' }}>
                          📦 เกิน {MAX_WEIGHT_PER_BOX_KG} กก. — แบ่ง {computeBoxCount(Number(order.crispyPorkWeight) || 0)} กล่อง
                        </div>

                        {getExtraBoxes(order).length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '6px' }}>
                            {(() => {
                              const box1Indices = getBox1Indices(order);
                              return (
                                <div style={{ fontSize: '12px', color: box1Indices.length > 0 ? '#fff' : '#ff8080' }}>
                                  📦 กล่อง 1: {box1Indices.length} ชิ้น (≈{getBoxWeight(order, box1Indices)} กก.) <span style={{ color: 'var(--text-secondary)' }}>(เหลืออัตโนมัติ)</span>
                                  {box1Indices.length <= 0 && ' ⚠️ ติดลบ/หมด — ลบกล่องอื่นออกบ้าง'}
                                </div>
                              );
                            })()}
                            {getExtraBoxes(order).map((indices, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-primary)' }}>
                                <span>📦 กล่อง {i + 2}: {indices.length} ชิ้น (≈{getBoxWeight(order, indices)} กก.)</span>
                                <button
                                  onClick={() => removeBox(order, i)}
                                  title="ลบกล่องนี้"
                                  style={{ background: 'none', border: 'none', color: '#ff8080', cursor: 'pointer', fontSize: '11px', padding: 0 }}
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        <button
                          onClick={() => openBoxPicker(order)}
                          style={{ marginTop: '6px', background: 'rgba(var(--surface-rgb),0.1)', border: '1px solid rgba(var(--surface-rgb),0.2)', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px 10px', borderRadius: '4px', fontSize: '12px' }}
                        >
                          + เพิ่มกล่อง
                        </button>
                      </div>
                    )}
                    <div style={{ fontSize: '12px', marginTop: '6px', color: '#a0a0a0', background: 'rgba(var(--surface-rgb),0.05)', padding: '4px 8px', borderRadius: '4px', display: 'inline-block' }}>
                      หมู: ฿{formatMoney(order.price)} | ส่ง: ฿{formatMoney(order.additionalShippingCost)} | COD: {order.codAmount > 0 ? `฿${formatMoney(order.codAmount)}` : '-'} | <strong style={{ color: 'var(--text-primary)' }}>รวม: ฿{
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
                    {order.codAmount > 0 && (
                      <div style={{ fontSize: '11px', marginTop: '4px' }}>
                        {order.codConfirmed ? (
                          <span style={{ color: 'var(--accent-green)' }}>✅ ยืนยันรับ COD แล้ว</span>
                        ) : (
                          <span style={{ color: '#ffac33' }}>🔒 รอยืนยันรับ COD</span>
                        )}
                      </div>
                    )}
                    {order.adminNote && <div style={{ fontSize: '12px', color: '#ffac33', marginTop: '4px' }}>หมายเหตุ: {order.adminNote}</div>}
                    {order.sellerName && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>โดย: {nicknameByName[order.sellerName] || order.sellerName}</div>}
                  </td>
                  <td style={{ padding: '16px', verticalAlign: 'top', ...nimCellStyle }}>
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
                        background: (order.orderStatus || "Pending") === "Pending" ? "rgba(255,172,51,0.2)" :
                                   order.orderStatus === "Packed" ? "rgba(79,172,254,0.2)" :
                                   "rgba(0,242,254,0.2)",
                        color: (order.orderStatus || "Pending") === "Pending" ? "#ffac33" :
                               order.orderStatus === "Packed" ? "#4facfe" :
                               "var(--accent-green)"
                      }}
                    >
                      <option value="Pending" style={{ color: '#000' }}>รอดำเนินการ</option>
                      <option value="Packed" style={{ color: '#000' }}>แพ็คแล้ว</option>
                      <option value="Shipped" style={{ color: '#000' }}>จัดส่งแล้ว</option>
                    </select>
                  </td>
                  <td style={{ padding: '16px', verticalAlign: 'top', ...nimCellStyle }}>
                    {(() => {
                      const trackingBoxCount = computeBoxCount(Number(order.crispyPorkWeight) || 0);
                      if (trackingBoxCount <= 1) {
                        return (
                          <input
                            type="text"
                            defaultValue={order.trackingNumber || ""}
                            onBlur={(e) => updateTracking(order.id, e.target.value)}
                            placeholder="เลขพัสดุ..."
                            style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', width: '120px' }}
                          />
                        );
                      }
                      // One field per box (from computeBoxCount), instead of
                      // one field the admin has to comma-separate by hand —
                      // matches the box-split warning shown in this row's
                      // product-details column. Deliberately no key tied to
                      // order.trackingNumber here — that would remount this
                      // group (wiping whatever's mid-typed in the other
                      // fields) every time any single field's own blur saves
                      // and changes that same value.
                      const existingParts = (order.trackingNumber || '').split(',').map(s => s.trim()).filter(Boolean);
                      const saveTrackingGroup = (e: React.FocusEvent<HTMLInputElement>) => {
                        const container = e.currentTarget.parentElement;
                        if (!container) return;
                        const inputs = Array.from(container.querySelectorAll('input'));
                        const joined = inputs.map((el) => (el as HTMLInputElement).value.trim()).filter(Boolean).join(',');
                        updateTracking(order.id, joined);
                      };
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {Array.from({ length: trackingBoxCount }).map((_, i) => (
                            <input
                              key={i}
                              type="text"
                              defaultValue={existingParts[i] || ''}
                              onBlur={saveTrackingGroup}
                              placeholder={`เลขพัสดุ กล่อง ${i + 1}`}
                              style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', width: '120px' }}
                            />
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                  <td style={{ padding: '16px', verticalAlign: 'top', ...nimCellStyle }}>
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
                      {order.codAmount > 0 && (
                        <button
                          onClick={() => handleToggleReturned(order)}
                          title="ติ๊กถ้าออเดอร์นี้ถูกตีกลับ (ไม่นับยอดขาย + หักค่าคอม 50 บาท)"
                          style={{
                            background: order.isReturned ? '#ff6b6b' : 'rgba(255,107,107,0.15)',
                            color: order.isReturned ? '#fff' : '#ff6b6b',
                            border: '1px solid #ff6b6b',
                            padding: '6px 12px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: 'bold',
                          }}
                        >
                          {order.isReturned ? '🔙 ตีกลับแล้ว' : '🔙 ตีกลับ'}
                        </button>
                      )}
                      {isSuperAdminRole(currentUser?.role) && (
                        <button
                          onClick={() => setDeleteChoiceOrder(order)}
                          style={{ background: 'rgba(255,107,107,0.15)', color: '#ff6b6b', border: '1px solid #ff6b6b', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                        >
                          🗑️ ลบ
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
              {orders.filter(o => matchesStatusFilter(o) && matchesShippingFilter(o)).length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    ไม่พบออเดอร์
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ background: 'var(--modal-bg)', width: '100%', maxWidth: '1400px', maxHeight: '90vh', borderRadius: '8px', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>ตัวอย่างข้อมูล Excel</h2>
              <button onClick={() => setShowPreview(false)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '20px' }}>✕</button>
            </div>
            
            <div style={{ padding: '24px', overflow: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', background: '#fff', color: '#000' }}>
                <thead>
                  <tr>
                    <th colSpan={4} style={{ background: '#92cddc', border: '1px solid #000', padding: '8px', textAlign: 'center' }}>รายละเอียดผู้ฝากส่ง</th>
                    <th colSpan={5} style={{ background: '#92d050', border: '1px solid #000', padding: '8px', textAlign: 'center' }}>รายละเอียดการจัดส่ง</th>
                    <th colSpan={4} style={{ background: '#fabf8f', border: '1px solid #000', padding: '8px', textAlign: 'center' }}>รายละเอียดผู้รับปลายทาง</th>
                  </tr>
                  <tr style={{ background: '#dbeef3' }}>
                    {['ชื่อ-สกุล', 'เบอร์โทร', 'ที่อยู่', 'รหัสไปรษณีย์', 'บริการ', 'Barcode', 'COD Account', 'COD', 'รายการสินค้า/หมายเหตุ', 'ชื่อ-สกุล', 'เบอร์โทร', 'ที่อยู่', 'รหัสไปรษณีย์'].map((col, i) => (
                      <th key={i} style={{ border: '1px solid #000', padding: '4px 8px', fontWeight: 'normal' }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell: any, j: number) => (
                        <td key={j} style={{ border: '1px solid #ccc', padding: '4px 8px', whiteSpace: 'nowrap' }}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Edit Order Modal */}
      {editingOrder && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ background: 'var(--modal-bg)', width: '100%', maxWidth: '600px', borderRadius: '8px', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>แก้ไขรายละเอียดออเดอร์</h2>
              <button onClick={() => setEditingOrder(null)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '20px' }}>✕</button>
            </div>

            <form onSubmit={handleSaveEdit} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>ชื่อลูกค้า</label>
                <input type="text" value={editingOrder.customerName} onChange={e => setEditingOrder({...editingOrder, customerName: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)' }} required />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>ที่อยู่ลูกค้า</label>
                <textarea value={editingOrder.customerAddress} onChange={e => setEditingOrder({...editingOrder, customerAddress: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', minHeight: '80px' }} required />
              </div>

              <div className={styles.mobileStackGrid} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>เบอร์โทร</label>
                  <input type="text" value={editingOrder.customerPhone || ''} onChange={e => setEditingOrder({...editingOrder, customerPhone: e.target.value})} maxLength={10} placeholder="เช่น 0812345678" style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)' }} />
                  {!isValidPhone(editingOrder.customerPhone) && (
                    <div style={{ color: '#ff6b6b', fontSize: '12px', marginTop: '4px' }}>⚠️ เบอร์โทรต้องมี 10 หลัก</div>
                  )}
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>รหัสไปรษณีย์</label>
                  <input type="text" value={editingOrder.customerZip || ''} onChange={e => setEditingOrder({...editingOrder, customerZip: e.target.value})} maxLength={5} placeholder="เช่น 10110" style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)' }} />
                  {!isValidZip(editingOrder.customerZip) && (
                    <div style={{ color: '#ff6b6b', fontSize: '12px', marginTop: '4px' }}>⚠️ รหัสไปรษณีย์ต้องมี 5 หลัก</div>
                  )}
                </div>
              </div>

              <div className={styles.mobileStackGrid} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>จำนวนชิ้นหมู</label>
                  <input type="text" value={editingOrder.crispyPorkPiece || ''} onChange={e => setEditingOrder({...editingOrder, crispyPorkPiece: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>น้ำหนักหมู (กก.)</label>
                  <input type="text" value={editingOrder.crispyPorkWeight || ''} onChange={e => setEditingOrder({...editingOrder, crispyPorkWeight: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)' }} />
                </div>
              </div>

              <div className={styles.mobileStackGrid} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>ยอดเก็บปลายทาง (฿)</label>
                  <input type="number" value={editingOrder.codAmount || 0} onChange={e => setEditingOrder({...editingOrder, codAmount: Number(e.target.value)})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>หมายเหตุแอดมิน</label>
                  <input type="text" value={editingOrder.adminNote || ''} onChange={e => setEditingOrder({...editingOrder, adminNote: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)' }} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                <button type="button" onClick={() => setEditingOrder(null)} style={{ padding: '12px 24px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}>ยกเลิก</button>
                <button type="submit" style={{ padding: '12px 24px', borderRadius: '8px', border: 'none', background: 'var(--accent-green)', color: 'black', fontWeight: 'bold', cursor: 'pointer' }}>บันทึกการเปลี่ยนแปลง</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Racks Modal */}
      {viewingRacks && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ background: 'var(--modal-bg)', width: '100%', maxWidth: '400px', borderRadius: '8px', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>ถาดที่ใช้</h2>
              <button onClick={() => setViewingRacks(null)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '20px' }}>✕</button>
            </div>

            <div style={{ padding: '24px' }}>
              {(() => {
                if (!viewingRacks.rackDetails) return <div style={{ color: 'var(--text-secondary)' }}>ไม่พบข้อมูลถาด</div>;
                try {
                  const racks = JSON.parse(viewingRacks.rackDetails);
                  if (!Array.isArray(racks) || racks.length === 0) return <div style={{ color: 'var(--text-secondary)' }}>ไม่พบข้อมูลถาด</div>;

                  const aggregatedRacks = racks.reduce((acc: Record<string, string[]>, curr: any) => {
                    const baseRackNo = curr.rackNo ? getBaseRackKeyAuto(curr.rackNo) : 'ไม่ทราบถาด';
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
                        <li key={idx} style={{ background: 'rgba(var(--surface-rgb),0.05)', padding: '12px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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

            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', textAlign: 'right' }}>
              <button onClick={() => setViewingRacks(null)} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'rgba(var(--surface-rgb),0.1)', color: 'var(--text-primary)', cursor: 'pointer' }}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* Box Piece Picker Modal — tick which pork pieces from box 1's
          remaining pool go into a new box */}
      {boxPickerForId && (() => {
        const pickerOrder = orders.find(o => o.id === boxPickerForId);
        if (!pickerOrder) return null;
        const pieces = getOrderPieces(pickerOrder);
        const availableIndices = getBox1Indices(pickerOrder);
        const pickedWeight = getBoxWeight(pickerOrder, pickedIndices);
        return (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
            <div style={{ background: 'var(--modal-bg)', width: '100%', maxWidth: '420px', maxHeight: '80vh', borderRadius: '8px', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)' }}>
              <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>เลือกชิ้นหมูใส่กล่องใหม่</h2>
                <button onClick={() => { setBoxPickerForId(null); setPickedIndices([]); }} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '20px' }}>✕</button>
              </div>

              <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>
                {availableIndices.length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    {pieces.length === 0
                      ? 'ไม่มีข้อมูลชิ้นหมูของออเดอร์นี้ (อาจเป็นออเดอร์เก่าที่ไม่ได้ผูกกับถาด)'
                      : 'ไม่มีชิ้นเหลือในกล่อง 1 ให้ย้ายแล้ว'}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {availableIndices.map((i) => {
                      const piece = pieces[i];
                      const checked = pickedIndices.includes(i);
                      return (
                        <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: checked ? 'rgba(63,185,80,0.15)' : 'rgba(var(--surface-rgb),0.05)', border: checked ? '1px solid var(--accent-green)' : '1px solid transparent', padding: '10px 12px', borderRadius: '8px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={checked} onChange={() => togglePickedIndex(i)} />
                          <span style={{ fontWeight: 'bold' }}>{piece?.rackNo || 'ไม่ทราบถาด'}</span>
                          <span style={{ marginLeft: 'auto', color: 'var(--accent-green)' }}>{Number(piece?.weight || 0).toFixed(2)} กก.</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  เลือกแล้ว {pickedIndices.length} ชิ้น ({pickedWeight} กก.)
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => { setBoxPickerForId(null); setPickedIndices([]); }} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}>ยกเลิก</button>
                  <button
                    onClick={() => confirmBoxPicker(pickerOrder)}
                    disabled={pickedIndices.length === 0}
                    style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: pickedIndices.length === 0 ? '#444' : 'var(--accent-green)', color: pickedIndices.length === 0 ? '#888' : 'black', fontWeight: 'bold', cursor: pickedIndices.length === 0 ? 'not-allowed' : 'pointer' }}
                  >
                    ยืนยัน
                  </button>
                </div>
              </div>
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
              <button className={styles.btnCancel} onClick={() => setDeleteChoiceOrder(null)}>
                ยกเลิก
              </button>
              <button
                onClick={() => confirmDeleteOrder(deleteChoiceOrder, "mistake")}
                style={{ padding: "10px 18px", borderRadius: "8px", background: "rgba(var(--surface-rgb),0.08)", border: "1px solid rgba(var(--surface-rgb),0.2)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "13px", fontWeight: "bold" }}
              >
                ✏️ กรอกข้อมูลผิด
              </button>
              <button
                onClick={() => confirmDeleteOrder(deleteChoiceOrder, "cancelled")}
                style={{ padding: "10px 18px", borderRadius: "8px", background: "rgba(255,107,107,0.15)", border: "1px solid #ff6b6b", color: "#ff6b6b", cursor: "pointer", fontSize: "13px", fontWeight: "bold" }}
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
