"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";
import { useRef } from "react";
import { useUser } from "../../components/UserProvider";
import { isSuperAdminRole } from "../../lib/roles";
import { BASE_PATH } from "../../lib/basePath";
import { nextDayStr, previousDayStr } from "../../lib/packingCutoff";
import { parseAddressBlock } from "../../lib/addressParse";
import { formatDateDDMMYY_BE } from "../../lib/thaiDate";
import styles from "../page.module.css";

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

  const fetchOrders = async () => {
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
      if (latestRequestedDateRef.current !== requestedDate) return;
      if (res.ok) {
        const packingOrders = data.orders.filter((o: any) =>
          o.orderStatus !== "Completed" &&
          o.platform !== "Storefront" &&
          o.shippingMethod !== "รับหน้าร้าน" &&
          o.shippingMethod !== "ส่งเอง"
        );
        setOrders(packingOrders);
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (latestRequestedDateRef.current === requestedDate) setIsLoading(false);
    }
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
      }
    } catch (e) {
      console.error(e);
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
      }
    } catch (e) {
      console.error(e);
    }
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

  const generateExportData = () => {
    // NIM Express ships via its own separate export (see handleExportNim),
    // and "ส่งในพื้นที่" is delivered locally by the shop itself — neither
    // ever goes through Postone.
    const exportOrders = sortOrders(orders.filter(o => matchesStatusFilter(o) && o.shippingMethod !== "NIM Express" && o.shippingMethod !== "ส่งในพื้นที่"));
    if (exportOrders.length === 0) return null;

    // Postone only needs the shipper's own name/phone/address filled in once
    // per file — leaving it blank on every other row makes it fall back to
    // that first row's shipper automatically.
    const SENDER_NAME = "หมูกรอบอีซี่ l หมูกรอบ EASY";
    const SENDER_PHONE = "0971622755";
    const SENDER_ADDRESS = "153, ตำบล สมอแข อำเภอเมืองพิษณุโลก พิษณุโลก";
    const SENDER_ZIP = "65000";
    const COD_ACCOUNT = "0644177042";

    return exportOrders.map((order, index) => {
      const { phone, zip, address } = parseAddressBlock(order.customerAddress);

      // adminNote (internal packing/admin remarks) is deliberately left out of
      // this column — it's for staff, not something that should go out on the
      // shipping label.
      const note = `หมูกรอบ ชิ้น: ${order.crispyPorkPiece || '-'} น้ำหนัก: ${order.crispyPorkWeight || '-'}kg`;

      const isFirstRow = index === 0;

      // The COD column has to be the FULL amount the courier collects in
      // cash from the customer (product + shipping + COD fee) — not just
      // the small COD service fee alone, or Postone would only ever get
      // back a fraction of what's actually owed.
      const isCodOrder = Number(order.codAmount) > 0;
      const codTotal = isCodOrder ? (Number(order.actualReceivedAmount) || Number(order.codAmount)) : "";

      return [
        isFirstRow ? SENDER_NAME : "",
        isFirstRow ? SENDER_PHONE : "",
        isFirstRow ? SENDER_ADDRESS : "",
        isFirstRow ? SENDER_ZIP : "",
        "E", "", COD_ACCOUNT,
        codTotal, note,
        order.customerName, phone, address, zip
      ];
    });
  };

  const handlePreview = () => {
    const data = generateExportData();
    if (!data) {
      alert("ไม่มีออเดอร์ให้แสดงตัวอย่าง");
      return;
    }
    setPreviewData(data);
    setShowPreview(true);
  };

  const handleExportPostone = async () => {
    const dataRows = generateExportData();
    if (!dataRows) {
      alert("ไม่มีออเดอร์ให้ส่งออก");
      return;
    }

    try {
      // Rebuilding the file from scratch kept producing subtle structural
      // differences from Postone's own template (extra spacer column, missing
      // print area, different cell styles) that made their importer silently
      // reject every row. Loading their real template and only overwriting
      // the data cells guarantees the file stays byte-for-byte compatible.
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

      const buffer = await workbook.xlsx.writeBuffer();
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
      const CHECKBOX_TEXT = "☐ LINE                   ☐ FB                      ☐ ตัวแทนขาย";
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
        const { phone, address } = parseAddressBlock(order.customerAddress);
        const courierLabel = Number(order.codAmount) > 0 ? "NIM COD" : "NIM";
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
        setCell(startRow + 7, c(1), "หมูกรอบ");
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

        for (let col = c(0); col <= c(4); col++) setCell(startRow + 11, col, CHECKBOX_TEXT);
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
      const workbook = XLSX.read(data);
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet);

      const updates: { customerName: string; trackingNumber: string }[] = [];

      rows.forEach((row: any) => {
        // The column names might vary slightly, but according to user it's "ชื่อผู้รับ" and "Tracking"
        const name = row["ชื่อผู้รับ"] || row["ชื่อ-สกุล"] || row["Customer Name"];
        const tracking = row["Tracking"] || row["tracking"] || row["Tracking Number"];
        
        if (name && tracking) {
          updates.push({
            customerName: String(name).trim(),
            trackingNumber: String(tracking).trim()
          });
        }
      });

      if (updates.length === 0) {
        alert("ไม่พบข้อมูลชื่อผู้รับหรือ Tracking ในไฟล์ที่อัปโหลด กรุณาตรวจสอบหัวคอลัมน์");
        return;
      }

      const res = await fetch(`${BASE_PATH}/api/orders/bulk-tracking`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates })
      });

      const result = await res.json();
      if (res.ok) {
        alert(`อัปเดต Tracking สำเร็จ ${result.successCount} รายการ`);
        fetchOrders();
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

  const handleDeleteOrder = async (order: Order) => {
    if (!confirm(`ลบออเดอร์ "${order.customerName}" ใช่ไหม? การลบนี้ย้อนกลับไม่ได้ (น้ำหนักหมูที่ตัดไปจะถูกคืนเข้าคลังให้อัตโนมัติ)`)) {
      return;
    }
    try {
      const res = await fetch(`${BASE_PATH}/api/orders/${order.id}`, { method: "DELETE" });
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
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', color: '#fff' }}>
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
              style={{ padding: '10px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', fontSize: '14px' }}
            />
          </div>
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
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>วิธีจัดส่ง</label>
            <select
              value={filterShipping}
              onChange={(e) => setFilterShipping(e.target.value)}
              style={{ padding: '10px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', fontSize: '14px' }}
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
              style={{ padding: '10px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', fontSize: '14px' }}
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
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff' }}
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
        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'rgba(255,255,255,0.05)', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
              <tr>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>ลูกค้า</th>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>รายการสินค้า</th>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>สถานะ</th>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>เลขพัสดุ</th>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {sortOrders(orders.filter(o => matchesStatusFilter(o) && matchesShippingFilter(o))).map(order => (
                <tr key={order.id} style={{ borderBottom: '1px solid var(--border-color)', background: order.isReturned ? 'rgba(255,107,107,0.06)' : undefined, opacity: order.isReturned ? 0.75 : 1 }}>
                  <td style={{ padding: '16px', verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 'bold' }}>{order.orderNo || "?"} - {order.customerName}</div>
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
                  <td style={{ padding: '16px', verticalAlign: 'top' }}>
                    <input
                      type="text"
                      defaultValue={order.trackingNumber || ""}
                      onBlur={(e) => updateTracking(order.id, e.target.value)}
                      placeholder="เลขพัสดุ..."
                      style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.2)', color: 'white', width: '120px' }}
                    />
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
                          onClick={() => handleDeleteOrder(order)}
                          style={{ background: 'rgba(255,107,107,0.15)', color: '#ff6b6b', border: '1px solid #ff6b6b', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                        >
                          🗑️ ลบ
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
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
          <div style={{ background: '#1a1a1a', width: '100%', maxWidth: '1400px', maxHeight: '90vh', borderRadius: '8px', display: 'flex', flexDirection: 'column', border: '1px solid #333' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>ตัวอย่างข้อมูล Excel</h2>
              <button onClick={() => setShowPreview(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px' }}>✕</button>
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
