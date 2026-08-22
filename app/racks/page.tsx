"use client";

import { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import { useUser } from "../../components/UserProvider";
import { isSuperAdminRole } from "../../lib/roles";
import { BASE_PATH } from "../../lib/basePath";
import { findMissingRackCodes } from "../../lib/rackGaps";
import {
  incrementPrefix,
  decrementPrefix,
  getRackSequence,
  formatRackCode,
  parseRackCode,
  getBaseRackKey,
  getProductFormat,
  PRODUCT_TYPES,
  DEFAULT_PRODUCT_TYPE,
  PIECES_PER_RACK,
} from "../../lib/rackCode";
import styles from "../page.module.css";

interface DraftRack {
  rackNo: string;
  weight: number;
  selected?: boolean;
}

// A plain "YYYY-MM-DD" (no time component) — format directly from the
// string parts (Buddhist year, DD/MM/YY) rather than going through
// Date/toLocaleDateString, which would risk an off-by-one from timezone
// conversion. Same helper app/pending-stock/page.tsx's own
// formatShipDateOnly is, kept local since neither page exports it.
function formatShipDateOnly(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${String((y + 543) % 100).padStart(2, "0")}`;
}

function ActionCard({ icon, title, subtitle, accent, badge, onClick }: { icon: string; title: string; subtitle: string; accent: string; badge?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`glass-panel ${styles.ordersButton}`}
    >
      <div className={styles.ordersIcon} style={{ background: accent }}>{icon}</div>
      <div className={styles.ordersInfo}>
        <div className={styles.ordersTitle}>{title}</div>
        {/* Badge shares the subtitle's row (right-pinned via marginLeft:
            auto) rather than the title's — the title needs its full width
            to wrap normally; Thai text has no spaces to wrap at, so
            squeezing it collapses into one syllable per line. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div className={styles.ordersSubtitle} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{subtitle}</div>
          {badge && (
            <span style={{ flexShrink: 0, marginLeft: 'auto', fontSize: '11px', fontWeight: 'bold', color: '#ff9f43', background: 'rgba(255,159,67,0.15)', border: '1px solid rgba(255,159,67,0.4)', borderRadius: '999px', padding: '3px 8px', whiteSpace: 'nowrap' }}>
              {badge}
            </span>
          )}
        </div>
      </div>
      <span className={styles.ordersChevron}>›</span>
    </button>
  );
}

export default function RacksPage() {
  const { currentUser, users, fetchUsers } = useUser();
  const centralUser = users.find(u => u.role === "CENTRAL_INVENTORY");
  const centralRacks = centralUser?.racks || [];
  const [selectedUserId, setSelectedUserId] = useState("");
  // Which product this page is currently showing/operating on — every list,
  // summary, and code generator below is scoped to this so the two
  // products' rack codes (and weights) never get mixed together.
  const [selectedProduct, setSelectedProduct] = useState<string>(DEFAULT_PRODUCT_TYPE);
  const productRacksOf = (u: any) => (u?.racks || []).filter((r: any) => (r.productType || DEFAULT_PRODUCT_TYPE) === selectedProduct);
  const productCentralRacks = useMemo(
    () => centralRacks.filter((r: any) => (r.productType || DEFAULT_PRODUCT_TYPE) === selectedProduct),
    [centralRacks, selectedProduct]
  );
  // Batch generation state
  const [prefix, setPrefix] = useState("A");
  const [startNum, setStartNum] = useState<number>(1);
  
  const [draftRacks, setDraftRacks] = useState<DraftRack[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [editingRackId, setEditingRackId] = useState<string | null>(null);
  const [editingRackNo, setEditingRackNo] = useState<string>("");
  const [editingWeight, setEditingWeight] = useState<number>(0);
  const [bulkShiftTarget, setBulkShiftTarget] = useState("");
  const [isShifting, setIsShifting] = useState(false);

  // Central Inventory Distribute state
  const [selectedCentralRacks, setSelectedCentralRacks] = useState<Set<string>>(new Set());
  // Running total for whatever's currently checked in the "เลือกทีละชิ้น"
  // list below — shown before the distribute is actually confirmed, so the
  // admin can see how many kg they're about to hand over.
  const selectedCentralWeight = centralRacks.reduce(
    (sum: number, r: any) => sum + (selectedCentralRacks.has(r.id) ? Number(r.remainingWeight) || 0 : 0),
    0
  );
  const [distributeTargetUserId, setDistributeTargetUserId] = useState("");
  const [distributeStartRack, setDistributeStartRack] = useState("");
  const [distributeEndRack, setDistributeEndRack] = useState("");
  const [isDistributing, setIsDistributing] = useState(false);
  const [isDistributeModalOpen, setIsDistributeModalOpen] = useState(false);
  const [distributeSearch, setDistributeSearch] = useState("");
  const [isAssignmentsModalOpen, setIsAssignmentsModalOpen] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [isDeletedLogModalOpen, setIsDeletedLogModalOpen] = useState(false);
  const [assignmentsSearch, setAssignmentsSearch] = useState("");
  const [selectedAssignmentRacks, setSelectedAssignmentRacks] = useState<Set<string>>(new Set());
  const [moveTargetUserId, setMoveTargetUserId] = useState("");
  const [isMoving, setIsMoving] = useState(false);
  const [autoSelectMoveCount, setAutoSelectMoveCount] = useState("");
  const [manualAddRackNo, setManualAddRackNo] = useState("");
  const [manualAddWeight, setManualAddWeight] = useState<number | "">("");
  const [isAddingManual, setIsAddingManual] = useState(false);

  const [deletedLogs, setDeletedLogs] = useState<any[]>([]);

  const fetchDeletedLogs = async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/racks/deleted`);
      const data = await res.json();
      if (data.success) {
        setDeletedLogs(data.logs);
      }
    } catch (e) {
      console.error("Failed to fetch deleted logs", e);
    }
  };

  // Every still-waiting "ลูกค้ารอหมู" entry across every admin — this page
  // is Super Admin-only, so GET /api/pending-stock with no `admin` param
  // returns everyone's, not just the caller's own. Used below to surface
  // each admin's own pork shortage right where they're already checking
  // stock levels.
  const [pendingStockEntries, setPendingStockEntries] = useState<any[]>([]);
  const fetchPendingStockEntries = async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/pending-stock`);
      const data = await res.json();
      if (data.success) setPendingStockEntries(data.entries);
    } catch (e) {
      console.error("Failed to fetch pending stock entries", e);
    }
  };

  useEffect(() => {
    if (isSuperAdminRole(currentUser?.role)) {
      fetchDeletedLogs();
      fetchPendingStockEntries();
    }
  }, [currentUser]);

  const allRackNos = useMemo(() => {
    return Array.from(new Set([
      ...users.flatMap(u => u.racks?.map(r => r.rackNo) || []),
      ...(centralRacks.map((r: any) => r.rackNo) || [])
    ])).sort();
  }, [users, centralRacks]);

  // Same combined list as allRackNos but keeping each row's productType, so
  // the code-generation helpers below can scope themselves to whichever
  // product is currently selected instead of scanning across both formats.
  const allRacksFlat = useMemo(() => {
    return [
      ...users.flatMap(u => (u.racks || []).map((r: any) => ({ rackNo: r.rackNo, productType: r.productType || DEFAULT_PRODUCT_TYPE, owner: u.nickname || u.name }))),
      ...centralRacks.map((r: any) => ({ rackNo: r.rackNo, productType: r.productType || DEFAULT_PRODUCT_TYPE, owner: "คลังกลาง" })),
    ];
  }, [users, centralRacks]);

  // Where the batch generator should pick up — one past whatever rack number
  // is highest within the currently selected product, so the admin never has
  // to remember and retype where the last batch left off. Scoped per product
  // because the two products' rack codes are unrelated sequences.
  const nextRackStart = useMemo(() => {
    let maxPrefix = "A";
    let maxNum = 0;
    let found = false;

    allRacksFlat
      .filter((r) => r.productType === selectedProduct)
      .forEach((r) => {
        const parsed = parseRackCode(r.rackNo, selectedProduct);
        if (!parsed) return;
        const { prefix: pfx, num } = parsed;
        // Same base-26 ordering as the letter-prefix rollover (A, B, ... Z, AA, AB, ...):
        // shorter prefix always sorts before a longer one.
        const isHigher = !found
          || pfx.length > maxPrefix.length
          || (pfx.length === maxPrefix.length && pfx > maxPrefix)
          || (pfx === maxPrefix && num > maxNum);
        if (isHigher) {
          maxPrefix = pfx;
          maxNum = num;
          found = true;
        }
      });

    if (!found) return { prefix: "A", startNum: 1 };
    const next = getRackSequence(maxPrefix, maxNum, 1);
    return { prefix: next.prefix, startNum: next.num };
  }, [allRacksFlat, selectedProduct]);

  // The single highest individual piece (rack + piece number) within the
  // currently selected product — shown alongside the batch generator so
  // it's clear where the auto-filled prefix/start number is continuing from.
  const lastPiece = useMemo(() => {
    type Piece = { prefix: string; num: number; piece: number; rackNo: string; owner: string };
    const pieces: Piece[] = [];

    allRacksFlat
      .filter((r) => r.productType === selectedProduct)
      .forEach((r) => {
        const parsed = parseRackCode(r.rackNo, selectedProduct);
        if (!parsed || parsed.piece === null) return;
        pieces.push({ prefix: parsed.prefix, num: parsed.num, piece: parsed.piece, rackNo: r.rackNo, owner: r.owner });
      });

    if (pieces.length === 0) return null;

    // Same base-26 prefix ordering used elsewhere for the rollover sequence.
    return pieces.reduce((best, curr) => {
      const isHigher = curr.prefix.length > best.prefix.length
        || (curr.prefix.length === best.prefix.length && curr.prefix > best.prefix)
        || (curr.prefix === best.prefix && curr.num > best.num)
        || (curr.prefix === best.prefix && curr.num === best.num && curr.piece > best.piece);
      return isHigher ? curr : best;
    });
  }, [allRacksFlat, selectedProduct]);

  // Pre-fill the batch generator with wherever the last batch left off, every
  // time the modal is opened fresh (not while there's already a draft in progress).
  useEffect(() => {
    if (isBatchModalOpen && draftRacks.length === 0) {
      setPrefix(nextRackStart.prefix);
      setStartNum(nextRackStart.startNum);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBatchModalOpen]);

  const currentAdminPiecesWithGaps = useMemo(() => {
    if (!currentUser) return [];
    const rawSourceRacks = users.find(u => u.id === selectedUserId)?.racks || (selectedUserId === currentUser.id ? currentUser.racks : []);
    const sourceRacks = (rawSourceRacks || []).filter((r: any) => (r.productType || DEFAULT_PRODUCT_TYPE) === selectedProduct);
    const sorted = [...sourceRacks].sort((a: any, b: any) => {
      if (a.isUsedUp !== b.isUsedUp) return a.isUsedUp ? 1 : -1;
      const aM = parseRackCode(a.rackNo, selectedProduct);
      const bM = parseRackCode(b.rackNo, selectedProduct);
      if (aM && bM && aM.piece !== null && bM.piece !== null && aM.prefix === bM.prefix) {
        const aNum = aM.num * 10 + aM.piece;
        const bNum = bM.num * 10 + bM.piece;
        return aNum - bNum;
      }
      return a.rackNo.localeCompare(b.rackNo);
    });

    const displayList: any[] = [];
    for (let i = 0; i < sorted.length; i++) {
      displayList.push(sorted[i]);
      if (i < sorted.length - 1) {
        const a = sorted[i];
        const b = sorted[i+1];
        if (!a.isUsedUp && !b.isUsedUp) {
          const aM = parseRackCode(a.rackNo, selectedProduct);
          const bM = parseRackCode(b.rackNo, selectedProduct);
          if (aM && bM && aM.piece !== null && bM.piece !== null && aM.prefix === bM.prefix) {
            const p = aM.prefix;
            const anum = aM.num * PIECES_PER_RACK + aM.piece;
            const bnum = bM.num * PIECES_PER_RACK + bM.piece;
            if (bnum - anum > 1 && bnum - anum < PIECES_PER_RACK * 2) {
              for (let n = anum + 1; n < bnum; n++) {
                let pNum = n % PIECES_PER_RACK;
                let rNum = Math.floor(n / PIECES_PER_RACK);
                if (pNum === 0) { pNum = PIECES_PER_RACK; rNum--; }
                const missingName = formatRackCode({ prefix: p, num: rNum, piece: pNum }, selectedProduct);
                if (!allRackNos.includes(missingName)) {
                  displayList.push({ isMissingPlaceholder: true, rackNo: missingName, id: 'missing-' + missingName });
                }
              }
            }
          }
        }
      }
    }

    if (assignmentsSearch) {
      const s = assignmentsSearch.toLowerCase();
      return displayList.filter(rack =>
        rack.rackNo.toLowerCase().includes(s) ||
        (rack.remainingWeight !== undefined && String(rack.remainingWeight).includes(s))
      );
    }
    return displayList;
  }, [users, selectedUserId, currentUser, assignmentsSearch, allRackNos, selectedProduct]);

  const centralPiecesWithGaps = useMemo(() => {
    const sorted = [...productCentralRacks].sort((a: any, b: any) => {
      const matchA = parseRackCode(a.rackNo, selectedProduct);
      const matchB = parseRackCode(b.rackNo, selectedProduct);
      if (matchA && matchB) {
        if (matchA.prefix !== matchB.prefix) return matchA.prefix.localeCompare(matchB.prefix);
        if (matchA.num !== matchB.num) return matchA.num - matchB.num;
        if (matchA.piece !== null && matchB.piece !== null) return matchA.piece - matchB.piece;
      }
      return a.rackNo.localeCompare(b.rackNo, undefined, { numeric: true });
    });

    const displayList: any[] = [];
    for (let i = 0; i < sorted.length; i++) {
      displayList.push(sorted[i]);
      if (i < sorted.length - 1) {
        const a = sorted[i];
        const b = sorted[i+1];
        if (!a.isUsedUp && !b.isUsedUp) {
          const aM = parseRackCode(a.rackNo, selectedProduct);
          const bM = parseRackCode(b.rackNo, selectedProduct);
          if (aM && bM && aM.piece !== null && bM.piece !== null && aM.prefix === bM.prefix) {
            const p = aM.prefix;
            const anum = aM.num * PIECES_PER_RACK + aM.piece;
            const bnum = bM.num * PIECES_PER_RACK + bM.piece;
            if (bnum - anum > 1 && bnum - anum < PIECES_PER_RACK * 2) {
              for (let n = anum + 1; n < bnum; n++) {
                let pNum = n % PIECES_PER_RACK;
                let rNum = Math.floor(n / PIECES_PER_RACK);
                if (pNum === 0) { pNum = PIECES_PER_RACK; rNum--; }
                const missingName = formatRackCode({ prefix: p, num: rNum, piece: pNum }, selectedProduct);
                if (!allRackNos.includes(missingName)) {
                  displayList.push({ isMissingPlaceholder: true, rackNo: missingName, id: 'missing-' + missingName });
                }
              }
            }
          }
        }
      }
    }

    if (distributeSearch) {
      const s = distributeSearch.toLowerCase();
      return displayList.filter(rack =>
        rack.rackNo.toLowerCase().includes(s) ||
        (rack.remainingWeight !== undefined && String(rack.remainingWeight).includes(s))
      );
    }
    return displayList;
  }, [productCentralRacks, distributeSearch, allRackNos, selectedProduct]);

  const globalMissingPieces = useMemo(() => {
    const combined = [
      ...users.flatMap(u => u.racks || []),
      ...centralRacks,
    ].filter((r: any) => (r.productType || DEFAULT_PRODUCT_TYPE) === selectedProduct);
    return findMissingRackCodes(combined);
  }, [users, centralRacks, selectedProduct]);

  const inventorySummary = useMemo(() => {
    const perAdmin = users
      .filter((u) => u.role !== "CENTRAL_INVENTORY" && u.role !== "PACKING")
      .map((u) => {
        const racks = productRacksOf(u);
        const pieces = racks.filter((r: any) => !r.isUsedUp).length;
        const weight = racks.reduce((sum: number, r: any) => sum + (!r.isUsedUp ? (r.remainingWeight || 0) : 0), 0);
        // realName (not the nickname-if-set display name) is what
        // PendingStock.createdBy actually stores — kept alongside so
        // shortageByAdmin below can be looked up correctly.
        return { name: u.nickname || u.name, realName: u.name, pieces, weight };
      })
      .sort((a, b) => b.weight - a.weight);

    const centralPieces = productCentralRacks.filter((r: any) => !r.isUsedUp).length;
    const centralWeight = productCentralRacks.reduce((sum: number, r: any) => sum + (!r.isUsedUp ? (r.remainingWeight || 0) : 0), 0);

    const totalPieces = perAdmin.reduce((s, a) => s + a.pieces, 0) + centralPieces;
    const totalWeight = perAdmin.reduce((s, a) => s + a.weight, 0) + centralWeight;

    return { perAdmin, centralPieces, centralWeight, totalPieces, totalWeight };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, productCentralRacks, selectedProduct]);

  // How much of the currently-selected product each admin still owes their
  // own "ลูกค้ารอหมู" customers — a line item counts as still-owed once its
  // entry hasn't been sent to packing yet (fulfilledAt null) AND it has no
  // rackDetails assigned yet (an assigned-but-not-yet-sent line already has
  // real stock earmarked for it, so it's no longer a shortage). Keyed by
  // createdBy, same name inventorySummary.perAdmin uses.
  const shortageByAdmin = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of pendingStockEntries) {
      if (entry.fulfilledAt || !entry.createdBy) continue;
      const items = Array.isArray(entry.items) ? entry.items : [];
      for (const item of items) {
        if (item?.productType !== selectedProduct) continue;
        if (Array.isArray(item?.rackDetails) && item.rackDetails.length > 0) continue;
        map.set(entry.createdBy, (map.get(entry.createdBy) || 0) + (Number(item?.weightKg) || 0));
      }
    }
    return map;
  }, [pendingStockEntries, selectedProduct]);

  // Company-wide roll-up of shortageByAdmin — surfaced on the "แจกจ่ายจาก
  // คลังกลาง" action card so a Super Admin sees at a glance whether anyone
  // needs distributing to before they even open that panel.
  const totalShortage = useMemo(() => {
    const weight = Array.from(shortageByAdmin.values()).reduce((sum, w) => sum + w, 0);
    return { weight, adminCount: shortageByAdmin.size };
  }, [shortageByAdmin]);

  // Same shortageByAdmin data, resolved to each admin's nickname (not the
  // real name shortageByAdmin is keyed by) and sorted worst-off first — fed
  // into the distribute modal below so a Super Admin sees exactly who to
  // prioritize before picking which pieces to send out.
  const shortageList = useMemo(() => {
    return Array.from(shortageByAdmin.entries())
      .map(([realName, weight]) => {
        const u = users.find((usr) => usr.name === realName);
        return { name: u?.nickname || realName, weight };
      })
      .sort((a, b) => b.weight - a.weight);
  }, [shortageByAdmin, users]);

  // Every still-waiting "ลูกค้ารอหมู" entry (any admin) that has an expected
  // ship date set — grouped by admin + date, summed to kg of the currently-
  // selected product, same scoping shortageByAdmin above already uses.
  // Surfaced so a Super Admin can see at a glance who's on the hook to ship
  // how much on which day, without opening each admin's own waiting list.
  const expectedShipByAdminDate = useMemo(() => {
    // Nested by admin then date (rather than a joined string key) so a real
    // name/username containing a space can't corrupt the grouping.
    const map = new Map<string, Map<string, number>>();
    for (const entry of pendingStockEntries) {
      if (entry.fulfilledAt || !entry.createdBy || !entry.expectedShipDate) continue;
      const items = Array.isArray(entry.items) ? entry.items : [];
      let weight = 0;
      for (const item of items) {
        if (item?.productType !== selectedProduct) continue;
        weight += Number(item?.weightKg) || 0;
      }
      if (weight <= 0) continue;
      const byDate = map.get(entry.createdBy) || new Map<string, number>();
      byDate.set(entry.expectedShipDate, (byDate.get(entry.expectedShipDate) || 0) + weight);
      map.set(entry.createdBy, byDate);
    }
    const rows: { name: string; date: string; weight: number }[] = [];
    for (const [realName, byDate] of map.entries()) {
      const u = users.find((usr) => usr.name === realName);
      for (const [date, weight] of byDate.entries()) {
        rows.push({ name: u?.nickname || realName, date, weight });
      }
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date) || b.weight - a.weight);
  }, [pendingStockEntries, selectedProduct, users]);

  const handleSelectDistributeRange = () => {
    if (!productCentralRacks.length || !distributeStartRack || !distributeEndRack) return;
    const startIndex = productCentralRacks.findIndex((r: any) => r.rackNo === distributeStartRack);
    const endIndex = productCentralRacks.findIndex((r: any) => r.rackNo === distributeEndRack);

    if (startIndex === -1 || endIndex === -1) return;

    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);

    const newSet = new Set(selectedCentralRacks);
    for (let i = start; i <= end; i++) {
      if (!productCentralRacks[i].isUsedUp) {
        newSet.add(productCentralRacks[i].id);
      }
    }
    setSelectedCentralRacks(newSet);
  };

  if (!currentUser) return null;
  if (!isSuperAdminRole(currentUser.role)) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>ไม่มีสิทธิ์เข้าถึง</h1>
          <p className={styles.subtitle}>เฉพาะ Super Admin เท่านั้นที่เข้าหน้านี้ได้</p>
        </div>
      </div>
    );
  }

  const handlePrefixChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPrefix = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
    const oldPrefix = prefix;
    setPrefix(newPrefix);

    if (draftRacks.length > 0) {
      setDraftRacks(prev => prev.map(r => {
        const match = parseRackCode(r.rackNo, selectedProduct);
        // If it starts with the old prefix (or oldPrefix is empty), replace it
        if (match && match.piece !== null && (oldPrefix === "" || match.prefix === oldPrefix)) {
          return { ...r, rackNo: formatRackCode({ prefix: newPrefix, num: match.num, piece: match.piece }, selectedProduct) };
        }
        return r;
      }));
    }
  };

  const handleStartNumChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let newStart = parseInt(e.target.value, 10);
    if (isNaN(newStart)) newStart = 0;
    if (newStart > 999) newStart = 999;
    if (newStart < 0) newStart = 0;

    const diff = newStart - startNum;
    setStartNum(newStart);

    if (draftRacks.length > 0 && diff !== 0) {
      setDraftRacks(prev => prev.map(r => {
        const match = parseRackCode(r.rackNo, selectedProduct);
        // Only update items that match the current prefix
        if (match && match.piece !== null && match.prefix === prefix) {
          const { prefix: newPfx, num: newNum } = getRackSequence(match.prefix, match.num, diff);
          return { ...r, rackNo: formatRackCode({ prefix: newPfx, num: newNum, piece: match.piece }, selectedProduct) };
        }
        return r;
      }));
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const dataBuffer = evt.target?.result;
        const wb = XLSX.read(dataBuffer, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 }); // read as 2D array
        
        if (data.length === 0) {
          alert("ไฟล์ว่างเปล่า ไม่มีข้อมูลครับ");
          return;
        }

        let weightColIndex = -1;
        let headerRowIndex = -1;

        // Search through all rows to find the header row containing "weigh"
        for (let i = 0; i < data.length; i++) {
          const row = data[i] || [];
          const foundIndex = row.findIndex((h: any) => 
            typeof h === 'string' && (h.toLowerCase().includes('weigh') || h.includes('น้ำหนัก'))
          );
          if (foundIndex !== -1) {
            weightColIndex = foundIndex;
            headerRowIndex = i;
            break;
          }
        }

        // Fallback to first column if not found
        if (weightColIndex === -1) {
          weightColIndex = 0;
        }
        
        // Extract numbers from the identified column (start after the header row if found)
        const startIdx = headerRowIndex !== -1 ? headerRowIndex + 1 : 0;
        const weights = data
          .slice(startIdx)
          .map(row => Number(row[weightColIndex]))
          .filter(val => !isNaN(val) && val > 0);

        if (weights.length === 0) {
          alert("ไม่พบตัวเลขน้ำหนักในไฟล์เลยครับ รบกวนเช็กว่าตัวเลขอยู่ในคอลัมน์ที่มีหัวข้อ 'weight' หรือ 'น้ำหนัก' หรือถ้าไม่มีหัวข้อ ตัวเลขต้องอยู่ในคอลัมน์ซ้ายสุด (Column A) ครับ");
          return;
        }

        const newRacks: DraftRack[] = [];
        weights.forEach((weight, idx) => {
          const rackIncrement = Math.floor(idx / PIECES_PER_RACK);
          const pieceNumber = (idx % PIECES_PER_RACK) + 1;
          const { prefix: seqPfx, num: seqNum } = getRackSequence(prefix, startNum, rackIncrement);
          newRacks.push({
            rackNo: formatRackCode({ prefix: seqPfx, num: seqNum, piece: pieceNumber }, selectedProduct),
            weight: weight,
            selected: true
          });
        });
        setDraftRacks(prev => [...prev, ...newRacks]);
      } catch (err) {
        console.error("Error parsing Excel:", err);
        alert("เกิดข้อผิดพลาดในการอ่านไฟล์ครับ กรุณาตรวจสอบว่าเป็นไฟล์ Excel (.xlsx หรือ .xls) จริงๆ");
      }
    };
    reader.readAsArrayBuffer(file);
    // Reset file input
    e.target.value = '';
  };

  const handleDraftWeightChange = (index: number, weight: number) => {
    const updated = [...draftRacks];
    updated[index].weight = weight;
    setDraftRacks(updated);
  };

  const handleDraftNameChange = (index: number, rackNo: string) => {
    const updated = [...draftRacks];
    updated[index].rackNo = rackNo;
    setDraftRacks(updated);
  };

  const handleRemoveDraft = (index: number) => {
    const updated = [...draftRacks];
    const oldRackNos = updated.map(r => r.rackNo);
    updated.splice(index, 1);
    for (let i = index; i < updated.length; i++) {
      updated[i].rackNo = oldRackNos[i];
    }
    setDraftRacks(updated);
  };

  const handleRemoveSelectedDrafts = () => {
    const selectedCount = draftRacks.filter(r => r.selected).length;
    if (selectedCount === 0) return;
    if (!confirm(`ต้องการลบชิ้นที่ติ๊กเลือกไว้ทั้งหมด ${selectedCount} ชิ้นออกจากรายการใช่ไหมครับ?`)) return;

    const oldRackNos = draftRacks.map(r => r.rackNo);
    const remaining = draftRacks.filter(r => !r.selected);
    const renamed = remaining.map((r, i) => ({ ...r, rackNo: oldRackNos[i] ?? r.rackNo }));
    setDraftRacks(renamed);
  };

  const handleClearAllDrafts = () => {
    if (draftRacks.length === 0) return;
    if (!confirm(`ต้องการล้างรายการที่สร้างไว้ทั้งหมด ${draftRacks.length} ชิ้นใช่ไหมครับ? (ยังไม่ได้บันทึกเข้าคลัง จะหายไปทันที)`)) return;
    setDraftRacks([]);
  };

  const handleAddManualPiece = () => {
    let newName = "";
    if (draftRacks.length > 0) {
      const { prefix: pfx, num } = getRackSequence(prefix, startNum, Math.floor(draftRacks.length / PIECES_PER_RACK));
      newName = formatRackCode({ prefix: pfx, num, piece: (draftRacks.length % PIECES_PER_RACK) + 1 }, selectedProduct);
    } else {
      const { prefix: pfx, num } = getRackSequence(prefix, startNum, 0);
      newName = formatRackCode({ prefix: pfx, num, piece: 1 }, selectedProduct);
    }

    setDraftRacks(prev => [...prev, { rackNo: newName, weight: 0, selected: true }]);
  };

  const handleInsertGap = (index: number) => {
    const updated = [...draftRacks];
    if (updated.length === 0) return;

    const oldRackNos = updated.map(r => r.rackNo);

    // Generate next name for the item pushed to the bottom
    let nextName = "";
    const lastItem = updated[updated.length - 1];
    const match = parseRackCode(lastItem.rackNo, selectedProduct);
    if (match && match.piece !== null) {
      let rNum = match.num;
      let pNum = match.piece;
      pNum++;
      if (pNum > PIECES_PER_RACK) { pNum = 1; rNum++; }
      nextName = formatRackCode({ prefix: match.prefix, num: rNum, piece: pNum }, selectedProduct);
    } else {
      nextName = lastItem.rackNo + "-next";
    }

    updated.splice(index, 0, { rackNo: "", weight: 0 }); // Insert gap
    
    for (let i = index; i < updated.length - 1; i++) {
      updated[i].rackNo = oldRackNos[i];
    }
    updated[updated.length - 1].rackNo = nextName;
    
    setDraftRacks(updated);
  };

  const handleAssignBatch = async () => {
    if (!selectedUserId || draftRacks.length === 0) return;
    
    const racksToAssign = draftRacks.filter(r => r.selected && r.weight > 0);

    if (racksToAssign.length === 0) {
      alert("ยังไม่ได้เลือกชิ้นที่ถูกต้อง (ชิ้นที่ติ๊กเลือกน้ำหนักเป็น 0 หรือยังไม่ได้เลือกเลย)");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/users/racks/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId, racks: racksToAssign, productType: selectedProduct }),
      });
      if (res.ok) {
        const remainingRacks = draftRacks.filter(r => !r.selected || r.weight === 0);
        setDraftRacks(remainingRacks);
        await fetchUsers(); // Refresh the users list and racks
        alert(`มอบหมายสำเร็จ ${racksToAssign.length} ชิ้น!`);
      } else {
        const err = await res.json();
        alert(err.error || "มอบหมายไม่สำเร็จ");
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะมอบหมาย");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevoke = async (assignmentId: string) => {
    if (!confirm("ต้องการเพิกถอนถาดนี้ใช่ไหมครับ?")) return;

    try {
      const res = await fetch(`${BASE_PATH}/api/users/racks?id=${assignmentId}`, { method: "DELETE" });
      if (res.ok) {
        await fetchUsers();
        fetchDeletedLogs();
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะเพิกถอนชิ้น");
    }
  };

  const handleDistribute = async () => {
    if (!distributeTargetUserId || selectedCentralRacks.size === 0) return;
    setIsDistributing(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/users/racks/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          rackIds: Array.from(selectedCentralRacks), 
          newUserId: distributeTargetUserId 
        }),
      });
      if (res.ok) {
        setSelectedCentralRacks(new Set());
        setDistributeTargetUserId("");
        await fetchUsers();
        alert(`แจกจ่ายสำเร็จ ${selectedCentralRacks.size} ชิ้น!`);
      } else {
        const err = await res.json();
        alert(err.error || "แจกจ่ายไม่สำเร็จ");
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะแจกจ่าย");
    } finally {
      setIsDistributing(false);
    }
  };

  const handleDeleteSelectedCentralRacks = async () => {
    if (selectedCentralRacks.size === 0) return;
    if (!confirm(`ต้องการลบชิ้นหมูที่เลือกไว้ ${selectedCentralRacks.size} ชิ้นออกจากคลังกลางถาวรใช่ไหมครับ? (กู้คืนไม่ได้)`)) return;

    setIsDistributing(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/users/racks?ids=${Array.from(selectedCentralRacks).join(",")}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const deletedCount = selectedCentralRacks.size;
        setSelectedCentralRacks(new Set());
        await fetchUsers();
        fetchDeletedLogs();
        alert(`ลบสำเร็จ ${deletedCount} ชิ้น!`);
      } else {
        const err = await res.json();
        alert(err.error || "ลบไม่สำเร็จ");
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะลบ");
    } finally {
      setIsDistributing(false);
    }
  };

  // Same "type a count, pick the N lowest racks" shortcut already used for
  // distributing from central — grouped by base rack code (e.g. all of
  // A005-1..5 count as one "rack"), not by individual piece.
  const handleAutoSelectMoveRacks = () => {
    const count = parseInt(autoSelectMoveCount, 10);
    if (isNaN(count) || count <= 0) return;

    const available = currentAdminPiecesWithGaps.filter((r: any) => !r.isMissingPlaceholder && !r.isUsedUp);
    const grouped: Record<string, string[]> = {};
    for (const r of available) {
      const baseRack = getBaseRackKey(r.rackNo, selectedProduct);
      if (!grouped[baseRack]) grouped[baseRack] = [];
      grouped[baseRack].push(r.id);
    }

    const sortedBaseRacks = Object.keys(grouped).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const selectedBaseRacks = sortedBaseRacks.slice(0, count);

    const newSet = new Set<string>();
    selectedBaseRacks.forEach((baseRack) => {
      grouped[baseRack].forEach((id) => newSet.add(id));
    });
    setSelectedAssignmentRacks(newSet);
  };

  // Reuses the same reassign endpoint the "แจกจ่ายจากคลังกลาง" flow already
  // uses — that one only ever moves FROM central; this lets Super Admin move
  // selected pieces from whichever admin is currently being viewed in the
  // "รายการที่มอบหมายไปแล้ว" modal to anyone else, including back to central.
  const handleMoveSelected = async () => {
    if (!moveTargetUserId || selectedAssignmentRacks.size === 0) return;
    setIsMoving(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/users/racks/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rackIds: Array.from(selectedAssignmentRacks),
          newUserId: moveTargetUserId,
        }),
      });
      if (res.ok) {
        const movedCount = selectedAssignmentRacks.size;
        setSelectedAssignmentRacks(new Set());
        setMoveTargetUserId("");
        setAutoSelectMoveCount("");
        await fetchUsers();
        alert(`ย้ายสำเร็จ ${movedCount} ชิ้น!`);
      } else {
        const err = await res.json();
        alert(err.error || "ย้ายไม่สำเร็จ");
      }
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดขณะย้าย");
    } finally {
      setIsMoving(false);
    }
  };

  const handleSaveRackName = async (id: string) => {
    if (!editingRackNo.trim()) return;
    try {
      const res = await fetch(`${BASE_PATH}/api/users/racks`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, rackNo: editingRackNo, weight: editingWeight }),
      });
      if (res.ok) {
        setEditingRackId(null);
        await fetchUsers();
      } else {
        alert("แก้ไขรหัสไม่สำเร็จ");
      }
    } catch (err) {
      alert("เกิดข้อผิดพลาดขณะแก้ไขรหัส");
    }
  };

  const handleBulkShift = async (direction: 'up' | 'down') => {
    if (!bulkShiftTarget.trim()) return;
    if (!confirm(`ต้องการเลื่อนชิ้นทั้งหมดตั้งแต่ ${bulkShiftTarget} ${direction === 'up' ? 'ขึ้น' : 'ลง'} ใช่ไหมครับ? การกระทำนี้จะมีผลกับแอดมินทุกคน`)) return;

    setIsShifting(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/users/racks/shift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startRackNo: bulkShiftTarget.trim(), direction, productType: selectedProduct }),
      });
      const data = await res.json();
      if (res.ok) {
        const orderNote = data.ordersUpdated > 0 ? ` (อัปเดตรหัสถาดใน order เก่าไปด้วย ${data.ordersUpdated} ใบ)` : "";
        alert(`เลื่อนสำเร็จ ${data.count} ชิ้น${orderNote}`);
        setBulkShiftTarget("");
        await fetchUsers();
      } else {
        alert(data.error || "เลื่อนไม่สำเร็จ");
      }
    } catch (err) {
      alert("เกิดข้อผิดพลาดขณะเลื่อนชิ้น");
    } finally {
      setIsShifting(false);
    }
  };

  const handleAddMissingPiece = async () => {
    if (!manualAddRackNo.trim()) return;
    const targetUserId = selectedUserId || currentUser?.id;
    if (!targetUserId) return;

    setIsAddingManual(true);
    try {
      const payload: any = {
        userId: targetUserId,
        rackNo: manualAddRackNo.trim(),
        productType: selectedProduct,
      };
      if (manualAddWeight !== "") {
        payload.weight = Number(manualAddWeight);
      }

      const res = await fetch(`${BASE_PATH}/api/users/racks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        setManualAddRackNo("");
        setManualAddWeight("");
        await fetchUsers();
      } else {
        alert(data.error || "เพิ่มชิ้นไม่สำเร็จ");
      }
    } catch (err) {
      alert("เกิดข้อผิดพลาดขณะเพิ่มชิ้น");
    } finally {
      setIsAddingManual(false);
    }
  };

  const selectedUser = users.find(u => u.id === selectedUserId);
  const displayName = (u: any) => u?.nickname || u?.name;
  const exampleRackNo = formatRackCode({ prefix: "A", num: 5, piece: 3 }, selectedProduct);
  const productDeletedLogs = deletedLogs.filter((log: any) => (log.productType || DEFAULT_PRODUCT_TYPE) === selectedProduct);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>จัดการชิ้นหมู</h1>
        <p className={styles.subtitle}>จัดสรรชิ้นหมูให้แอดมินและดูแลคลังสินค้า</p>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {Object.values(PRODUCT_TYPES).map((p) => (
          <button
            key={p.code}
            type="button"
            onClick={() => setSelectedProduct(p.code)}
            style={{
              background: selectedProduct === p.code ? 'var(--accent-blue)' : 'rgba(var(--surface-rgb),0.06)',
              color: selectedProduct === p.code ? '#fff' : 'var(--text-secondary)',
              border: selectedProduct === p.code ? 'none' : '1px solid var(--border-color)',
              padding: '10px 20px',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="glass-panel" style={{ padding: '20px 24px', borderRadius: '16px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '15px', marginBottom: '16px', color: 'var(--text-secondary)' }}>📦 คลังหมูคงเหลือตอนนี้</h3>
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'space-around', textAlign: 'center', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--accent-blue)' }}>{inventorySummary.totalPieces}</div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>ชิ้นคงเหลือ</div>
          </div>
          <div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--accent-green)' }}>{inventorySummary.totalWeight.toFixed(2)}</div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>กก. คงเหลือ</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
          <div style={{ flex: '1 1 160px', background: 'rgba(255,172,51,0.08)', border: '1px solid rgba(255,172,51,0.2)', borderRadius: '10px', padding: '12px 16px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>🏭 คลังกลาง</div>
            <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{inventorySummary.centralPieces} ชิ้น · {inventorySummary.centralWeight.toFixed(2)} กก.</div>
          </div>
          {inventorySummary.perAdmin.map((a) => {
            const shortage = shortageByAdmin.get(a.realName) || 0;
            return (
              <div key={a.name} style={{ flex: '1 1 160px', background: 'rgba(var(--surface-rgb),0.04)', borderRadius: '10px', padding: '12px 16px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>👤 {a.name}</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{a.pieces} ชิ้น · {a.weight.toFixed(2)} กก.</div>
                {shortage > 0 && (
                  <div style={{ fontSize: '12px', color: '#ff9f43', fontWeight: 'bold', marginTop: '4px' }}>
                    🐷 ขาด {shortage.toFixed(2)} กก. (ลูกค้ารอหมู)
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        <ActionCard
          icon="📥"
          title="เพิ่มชิ้นหมูใหม่"
          subtitle={draftRacks.length > 0 ? `มีร่างค้างไว้ ${draftRacks.length} ชิ้น` : "อัปโหลด Excel แล้วมอบหมายให้แอดมิน"}
          accent="rgba(88,166,255,0.15)"
          onClick={() => setIsBatchModalOpen(true)}
        />
        <ActionCard
          icon="📤"
          title="แจกจ่ายจากคลังกลาง"
          subtitle="ส่งชิ้นหมูจากคลังกลางให้แอดมิน"
          accent="rgba(255,172,51,0.15)"
          badge={totalShortage.weight > 0 ? `🐷 ขาด ${totalShortage.weight.toFixed(2)} กก. (${totalShortage.adminCount} คน)` : undefined}
          onClick={() => setIsDistributeModalOpen(true)}
        />
        <ActionCard
          icon="📋"
          title="รายการที่มอบหมายแล้ว"
          subtitle="ดู แก้ไข หรือเพิกถอนชิ้นของแต่ละแอดมิน"
          accent="rgba(var(--surface-rgb),0.12)"
          onClick={() => setIsAssignmentsModalOpen(true)}
        />
        <ActionCard
          icon="🗑️"
          title="ประวัติการลบ"
          subtitle={productDeletedLogs.length > 0 ? `${productDeletedLogs.length} รายการ` : "ยังไม่มีรายการ"}
          accent="rgba(139,148,158,0.15)"
          onClick={() => setIsDeletedLogModalOpen(true)}
        />
      </div>

      {expectedShipByAdminDate.length > 0 && (
        <div className="glass-panel" style={{ padding: '20px 24px', borderRadius: '16px', marginTop: '16px' }}>
          <h3 style={{ fontSize: '15px', marginBottom: '4px', color: 'var(--text-secondary)' }}>🚚 คาดว่าจะส่ง (จากลูกค้ารอหมู)</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>แต่ละแอดมินมีหมูกรอบที่ลูกค้าคาดว่าจะได้รับวันไหน กี่โล</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {expectedShipByAdminDate.map((row, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: '8px', background: 'rgba(var(--surface-rgb),0.04)' }}>
                <span style={{ fontSize: '13px' }}>
                  <span style={{ color: 'var(--accent-blue)', fontWeight: 'bold' }}>{formatShipDateOnly(row.date)}</span>
                  {' · '}👤 {row.name}
                </span>
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--accent-green)' }}>{row.weight.toFixed(2)} กก.</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Batch Assign Modal */}
      {isBatchModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className={styles.rackModal} style={{ background: 'var(--modal-bg)', padding: '32px', borderRadius: '12px', width: '90%', maxWidth: '900px', border: '1px solid var(--border-color)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, color: 'var(--accent-blue)', fontSize: '24px' }}>เพิ่มชิ้นหมูใหม่</h2>
              <button
                onClick={() => { setIsBatchModalOpen(false); setShowAdvancedTools(false); }}
                style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '24px' }}
              >✕</button>
            </div>

            <div style={{ padding: '16px', background: 'rgba(var(--surface-rgb),0.05)', borderRadius: '8px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '14px', marginBottom: '12px' }}>สร้างลำดับชิ้นหมูจากไฟล์ Excel</h3>
              {lastPiece && (
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px', background: 'rgba(var(--surface-rgb),0.03)', borderRadius: '6px', padding: '8px 12px' }}>
                  📍 ถาดสุดท้ายในระบบตอนนี้: <strong style={{ color: 'var(--text-primary)' }}>{getBaseRackKey(lastPiece.rackNo, selectedProduct)} ชิ้นที่ {lastPiece.piece}</strong> ({lastPiece.owner}) — ระบบเริ่มให้ที่ {getBaseRackKey(formatRackCode({ prefix, num: startNum, piece: 1 }, selectedProduct), selectedProduct)} ต่ออัตโนมัติ
                </div>
              )}
              <div className={styles.mobileStackGrid} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: '12px', alignItems: 'end' }}>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>อักษรนำหน้า (Prefix)</label>
                      <input type="text" className={styles.input} value={prefix} onChange={handlePrefixChange} placeholder="เช่น A" style={{ textTransform: 'uppercase' }} />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>เริ่มถาดที่ #</label>
                      <input type="number" className={styles.input} value={startNum} min={0} max={999} onChange={handleStartNumChange} />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>อัปโหลดไฟล์ Excel (.xlsx)</label>
                      <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} className={styles.input} style={{ padding: '8px' }} />
                    </div>
                  </div>
                </div>

                <div>
                  <div className={styles.rackToolbarRow} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '12px' }}>
                    <h3 style={{ fontSize: '14px' }}>ชิ้นหมูที่สร้างไว้ ({draftRacks.length})</h3>
                    <div className={styles.rackToolbarRow} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input
                        type="text"
                        placeholder="ค้นหารหัสถาด..."
                        value={searchDraft}
                        onChange={(e) => setSearchDraft(e.target.value)}
                        className={styles.input}
                        style={{ padding: '6px 12px', width: '150px' }}
                      />
                      <button
                        onClick={() => {
                          const allSelected = draftRacks.every(r => r.selected);
                          setDraftRacks(draftRacks.map(r => ({ ...r, selected: !allSelected })));
                        }}
                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', cursor: 'pointer', padding: '6px 12px', borderRadius: '4px', fontSize: '12px' }}
                      >
                        {draftRacks.every(r => r.selected) ? "ยกเลิกเลือกทั้งหมด" : "เลือกทั้งหมด"}
                      </button>
                      <button
                        onClick={handleAddManualPiece}
                        style={{ background: 'var(--accent-blue)', border: 'none', color: '#fff', cursor: 'pointer', padding: '6px 12px', borderRadius: '4px', fontSize: '12px' }}
                      >
                        + เพิ่มชิ้นเอง
                      </button>
                      <button
                        onClick={handleRemoveSelectedDrafts}
                        disabled={!draftRacks.some(r => r.selected)}
                        style={{ background: 'rgba(255,107,107,0.15)', border: '1px solid rgba(255,107,107,0.4)', color: '#ff6b6b', cursor: draftRacks.some(r => r.selected) ? 'pointer' : 'not-allowed', opacity: draftRacks.some(r => r.selected) ? 1 : 0.5, padding: '6px 12px', borderRadius: '4px', fontSize: '12px' }}
                      >
                        🗑 ลบที่เลือก
                      </button>
                      <button
                        onClick={handleClearAllDrafts}
                        disabled={draftRacks.length === 0}
                        style={{ background: '#ff6b6b', border: 'none', color: '#fff', cursor: draftRacks.length > 0 ? 'pointer' : 'not-allowed', opacity: draftRacks.length > 0 ? 1 : 0.5, padding: '6px 12px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}
                      >
                        ล้างทั้งหมด
                      </button>
                    </div>
                  </div>

                  <div className={styles.draftPieceList} style={{ maxHeight: '300px', overflowY: 'auto', paddingRight: '8px', marginBottom: '16px' }}>
                      {draftRacks
                        .map((rack, idx) => ({ ...rack, originalIdx: idx }))
                        .filter(r => !searchDraft || r.rackNo.toLowerCase().includes(searchDraft.toLowerCase()))
                        .map((rack) => (
                        <div key={rack.originalIdx} className={styles.rackItemRow} style={{ display: 'grid', gridTemplateColumns: 'auto 2fr 1fr auto', gap: '12px', marginBottom: '8px', alignItems: 'center', background: rack.weight === 0 ? 'rgba(255,255,0,0.1)' : 'transparent', padding: rack.weight === 0 ? '4px' : '0' }}>
                          <input
                            className={styles.rackItemCheck}
                            type="checkbox"
                            checked={!!rack.selected}
                            onChange={(e) => {
                              const updated = [...draftRacks];
                              updated[rack.originalIdx].selected = e.target.checked;
                              setDraftRacks(updated);
                            }}
                            style={{ cursor: 'pointer' }}
                          />
                          <input
                            type="text"
                            className={`${styles.input} ${styles.rackItemName}`}
                            value={rack.rackNo}
                            onChange={e => handleDraftNameChange(rack.originalIdx, e.target.value)}
                            style={{ color: rack.weight === 0 ? '#aaa' : 'inherit' }}
                          />
                          <div className={styles.rackItemWeight} style={{ position: 'relative' }}>
                            <input
                              type="number"
                              className={styles.input}
                              value={rack.weight}
                              onChange={e => handleDraftWeightChange(rack.originalIdx, Number(e.target.value))}
                            />
                            <span style={{ position: 'absolute', right: '12px', top: '10px', color: '#666', fontSize: '12px' }}>กก.</span>
                          </div>
                          <div className={styles.rackItemActions} style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => handleInsertGap(rack.originalIdx)} title="แทรกช่องว่างตรงนี้" style={{ background: 'rgba(var(--surface-rgb),0.1)', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px' }}>+</button>
                            <button onClick={() => handleRemoveDraft(rack.originalIdx)} title="ลบรายการนี้" style={{ background: 'rgba(255,0,0,0.2)', border: 'none', color: '#ff6b6b', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px' }}>✕</button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{ padding: '16px', background: 'rgba(var(--accent-blue-rgb), 0.1)', borderRadius: '8px', marginTop: '16px', border: '1px solid rgba(var(--accent-blue-rgb), 0.3)' }}>
                      <h3 style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--accent-blue)' }}>มอบชิ้นที่เลือกให้แอดมิน</h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px', marginBottom: '16px' }}>
                        <div className={styles.formGroup}>
                          <label className={styles.label}>เลือกแอดมิน</label>
                          <select
                            className={styles.input}
                            value={selectedUserId}
                            onChange={(e) => setSelectedUserId(e.target.value)}
                          >
                            <option value="">-- เลือก --</option>
                            {centralUser && (
                              <option value={centralUser.id}>
                                คลังกลาง (เหลือ {productCentralRacks.reduce((sum: any, r: any) => sum + (!r.isUsedUp ? r.remainingWeight : 0), 0).toFixed(2) || '0.00'} กก.)
                              </option>
                            )}
                            {users.filter(u => u.role !== "CENTRAL_INVENTORY" && u.role !== "PACKING").map(u => (
                              <option key={u.id} value={u.id}>
                                {displayName(u)} (เหลือ {productRacksOf(u).reduce((sum: number, r: any) => sum + (!r.isUsedUp ? (r.remainingWeight || 0) : 0), 0).toFixed(2) || '0.00'} กก.)
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <button
                        onClick={handleAssignBatch}
                        className={styles.button}
                        disabled={isLoading || !selectedUserId}
                        style={{ width: '100%', background: 'var(--accent-blue)', color: 'var(--text-primary)' }}
                      >
                        {isLoading ? "กำลังมอบหมาย..." : `มอบให้ ${selectedUserId === currentUser.id ? "คลังกลาง" : (displayName(selectedUser) || "แอดมิน")}`}
                      </button>
                    </div>
                  </div>

                  <div style={{ textAlign: 'center', marginTop: '20px' }}>
                    <button
                      type="button"
                      onClick={() => setShowAdvancedTools(v => !v)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '13px', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      ⚙️ {showAdvancedTools ? 'ซ่อน' : ''}เครื่องมือขั้นสูง (สำหรับกรณีพิเศษ)
                    </button>
                  </div>

                  {showAdvancedTools && (
                    <div style={{ marginTop: '16px', paddingTop: '20px', borderTop: '1px solid var(--border-color)' }}>
                      <datalist id="all-racks-list">
                        {Array.from(new Set(
                          allRacksFlat.filter(r => r.productType === selectedProduct).map(r => r.rackNo)
                        )).sort().map(no => <option key={no} value={no} />)}
                      </datalist>
                      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                        เครื่องมือด้านล่างนี้ใช้เฉพาะกรณีพิเศษ/ฉุกเฉินเท่านั้น ใช้อย่างระมัดระวัง
                      </p>

                      <div className={styles.formGroup} style={{ marginBottom: '20px' }}>
                        <label className={styles.label}>เพิ่มให้แอดมิน</label>
                        <select
                          className={styles.input}
                          value={selectedUserId}
                          onChange={(e) => setSelectedUserId(e.target.value)}
                        >
                          <option value="">-- เลือก --</option>
                          {centralUser && (
                            <option value={centralUser.id}>
                              คลังกลาง
                            </option>
                          )}
                          {users.filter(u => u.role !== "CENTRAL_INVENTORY" && u.role !== "PACKING").map(u => (
                            <option key={u.id} value={u.id}>
                              {displayName(u)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={{ padding: '16px', background: 'rgba(255,107,107, 0.1)', borderRadius: '8px', marginBottom: '20px', border: '1px solid rgba(255,107,107, 0.3)' }}>
                        <h3 style={{ fontSize: '14px', marginBottom: '8px', color: '#ff6b6b' }}>เลื่อนลำดับฉุกเฉิน (ทั้งระบบ)</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                          ใช้แก้ไขเลขถาดที่เพี้ยนไป ให้ทั้งระบบพร้อมกัน
                        </p>
                        <div className={styles.mobileStackGrid} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '8px', alignItems: 'end' }}>
                          <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                            <input
                              type="text"
                              className={styles.input}
                              placeholder={`เริ่มจากชิ้น (เช่น ${exampleRackNo})`}
                              value={bulkShiftTarget}
                              onChange={e => setBulkShiftTarget(e.target.value)}
                              list="all-racks-list"
                            />
                          </div>
                          <button
                            onClick={() => handleBulkShift('down')}
                            disabled={isShifting || !bulkShiftTarget}
                            style={{ background: 'rgba(var(--surface-rgb),0.1)', border: '1px solid rgba(var(--surface-rgb),0.2)', color: 'var(--text-primary)', padding: '10px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                            title="เลื่อนลง (ใช้เมื่อของหายจริงจากถาด)"
                          >
                            + เลื่อนลง
                          </button>
                          <button
                            onClick={() => handleBulkShift('up')}
                            disabled={isShifting || !bulkShiftTarget}
                            style={{ background: 'rgba(255,107,107,0.2)', border: '1px solid rgba(255,107,107,0.4)', color: '#ff6b6b', padding: '10px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                            title="เลื่อนขึ้น (ใช้เมื่อสแกนซ้ำ/นับซ้ำ)"
                          >
                            ✕ เลื่อนขึ้น
                          </button>
                        </div>
                      </div>

                      <div style={{ padding: '16px', background: 'rgba(255,172,51,0.1)', borderRadius: '8px', border: '1px solid rgba(255,172,51,0.3)' }}>
                        <h3 style={{ fontSize: '14px', marginBottom: '8px', color: '#ffac33' }}>เพิ่มชิ้นที่ขาดหาย</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                          สร้างและมอบชิ้นที่ขาดหายให้แอดมินที่เลือกไว้ด้านบนอย่างรวดเร็ว
                        </p>
                        {globalMissingPieces.length > 0 && (
                          <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', alignSelf: 'center' }}>ชิ้นที่อาจขาดหาย:</span>
                            {globalMissingPieces.map(piece => (
                              <button
                                key={piece}
                                onClick={() => setManualAddRackNo(piece)}
                                style={{ background: 'rgba(255,107,107,0.1)', color: '#ff6b6b', border: '1px dashed #ff6b6b', borderRadius: '12px', padding: '4px 8px', fontSize: '12px', cursor: 'pointer' }}
                              >
                                + {piece}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className={styles.mobileStackGrid} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', alignItems: 'end' }}>
                          <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                            <input
                              type="text"
                              className={styles.input}
                              placeholder={`รหัสชิ้น (เช่น ${exampleRackNo})`}
                              value={manualAddRackNo}
                              onChange={e => setManualAddRackNo(e.target.value)}
                              list="all-racks-list"
                            />
                          </div>
                          <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                            <input
                              type="number"
                              step="0.01"
                              className={styles.input}
                              placeholder="น้ำหนัก (ไม่บังคับ)"
                              value={manualAddWeight}
                              onChange={e => setManualAddWeight(e.target.value === "" ? "" : Number(e.target.value))}
                            />
                          </div>
                          <button
                            onClick={handleAddMissingPiece}
                            disabled={isAddingManual || !manualAddRackNo.trim()}
                            style={{ background: '#ffac33', border: 'none', color: '#111', padding: '10px 16px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                          >
                            {isAddingManual ? "กำลังเพิ่ม..." : "เพิ่มชิ้น"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
          </div>
        </div>
      )}

      {/* Distribution Modal */}
      {isDistributeModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className={styles.rackModal} style={{ background: 'var(--modal-bg)', padding: '32px', borderRadius: '12px', width: '90%', maxWidth: '900px', border: '1px solid var(--border-color)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, color: '#ffac33', fontSize: '24px' }}>แจกจ่ายจากคลังกลาง</h2>
              <button
                onClick={() => setIsDistributeModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '24px' }}
              >✕</button>
            </div>

            {shortageList.length > 0 && (
              <div style={{ background: 'rgba(255,159,67,0.08)', border: '1px solid rgba(255,159,67,0.3)', borderRadius: '8px', padding: '14px 16px', marginBottom: '20px' }}>
                <h3 style={{ fontSize: '14px', color: '#ff9f43', marginBottom: '10px' }}>🐷 คนที่ขาดหมู (ลูกค้ารอหมู)</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {shortageList.map((s) => (
                    <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                      <span>👤 {s.name}</span>
                      <span style={{ fontWeight: 'bold', color: '#ff9f43' }}>ขาด {s.weight.toFixed(2)} กก.</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.mobileStackGrid} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '16px', marginBottom: '24px', alignItems: 'end' }}>
              <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                <label className={styles.label}>ตั้งแต่ชิ้น</label>
                <input
                  type="text"
                  list="rack-datalist"
                  className={styles.input}
                  style={{ fontSize: '16px', padding: '12px' }}
                  placeholder={`เช่น ${exampleRackNo}`}
                  value={distributeStartRack}
                  onChange={(e) => setDistributeStartRack(e.target.value)}
                />
              </div>
              <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                <label className={styles.label}>ถึงชิ้น</label>
                <input
                  type="text"
                  list="rack-datalist"
                  className={styles.input}
                  style={{ fontSize: '16px', padding: '12px' }}
                  placeholder={`เช่น ${exampleRackNo}`}
                  value={distributeEndRack}
                  onChange={(e) => setDistributeEndRack(e.target.value)}
                />
              </div>
              <button
                onClick={handleSelectDistributeRange}
                disabled={!distributeStartRack || !distributeEndRack}
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', cursor: 'pointer', padding: '12px 24px', borderRadius: '8px', fontSize: '14px', height: '100%', fontWeight: 'bold' }}
              >
                เลือกช่วง
              </button>
            </div>

            <datalist id="rack-datalist">
              {[...productCentralRacks].sort((a: any, b: any) => {
                const matchA = parseRackCode(a.rackNo, selectedProduct);
                const matchB = parseRackCode(b.rackNo, selectedProduct);
                if (matchA && matchB) {
                  if (matchA.prefix !== matchB.prefix) return matchA.prefix.localeCompare(matchB.prefix);
                  if (matchA.num !== matchB.num) return matchA.num - matchB.num;
                  if (matchA.piece !== null && matchB.piece !== null) return matchA.piece - matchB.piece;
                }
                return a.rackNo.localeCompare(b.rackNo, undefined, { numeric: true });
              }).map((r: any) => (
                <option key={`dl-${r.id}`} value={r.rackNo} />
              ))}
            </datalist>

            <div style={{ background: 'rgba(var(--surface-rgb),0.05)', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '14px', marginBottom: '12px' }}>เลือกถาดอัตโนมัติตามลำดับ</h3>
              <div className={styles.rackToolbarRow} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <input
                  type="number"
                  placeholder="จำนวนถาด (เช่น 10)"
                  id="auto-select-racks-count"
                  className={styles.input}
                  style={{ width: '150px', padding: '8px 12px' }}
                />
                <button 
                  onClick={() => {
                    const input = document.getElementById('auto-select-racks-count') as HTMLInputElement;
                    const count = parseInt(input.value, 10);
                    if (isNaN(count) || count <= 0) return;
                    
                    const available = [...productCentralRacks].filter((r: any) => !r.isUsedUp).sort((a: any, b: any) => {
                      const matchA = parseRackCode(a.rackNo, selectedProduct);
                      const matchB = parseRackCode(b.rackNo, selectedProduct);
                      if (matchA && matchB) {
                        if (matchA.prefix !== matchB.prefix) return matchA.prefix.localeCompare(matchB.prefix);
                        if (matchA.num !== matchB.num) return matchA.num - matchB.num;
                        if (matchA.piece !== null && matchB.piece !== null) return matchA.piece - matchB.piece;
                      }
                      return a.rackNo.localeCompare(b.rackNo, undefined, { numeric: true });
                    });

                    const grouped = available.reduce((acc: any, curr: any) => {
                      const baseRack = getBaseRackKey(curr.rackNo, selectedProduct);
                      if (!acc[baseRack]) acc[baseRack] = [];
                      acc[baseRack].push(curr.id);
                      return acc;
                    }, {});

                    const sortedBaseRacks = Object.keys(grouped);
                    const selectedBaseRacks = sortedBaseRacks.slice(0, count);

                    const newSet = new Set<string>();
                    selectedBaseRacks.forEach(baseRack => {
                      grouped[baseRack].forEach((id: string) => newSet.add(id));
                    });
                    setSelectedCentralRacks(newSet);
                  }}
                  style={{ background: 'var(--accent-blue)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}
                >
                  เลือก ถาดน้อยไปมาก
                </button>
              </div>
            </div>

            <div className={styles.rackToolbarRow} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '12px' }}>
              <div className={styles.rackToolbarRow} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <h3 style={{ fontSize: '16px', margin: 0 }}>เลือกทีละชิ้น</h3>
                <input
                  type="text"
                  placeholder="ค้นหารหัสถาดหรือน้ำหนัก..."
                  value={distributeSearch}
                  onChange={(e) => setDistributeSearch(e.target.value)}
                  className={styles.input}
                  style={{ padding: '6px 12px', width: '200px', fontSize: '14px' }}
                />
              </div>
              <button
                onClick={() => {
                  const filteredRacks = productCentralRacks.filter((r: any) => {
                    if (!distributeSearch) return true;
                    const s = distributeSearch.toLowerCase();
                    return r.rackNo.toLowerCase().includes(s) || String(r.remainingWeight).includes(s);
                  });

                  if (filteredRacks.length === 0) return;

                  const allVisibleSelected = filteredRacks.every((r: any) => selectedCentralRacks.has(r.id));
                  const newSet = new Set(selectedCentralRacks);

                  if (allVisibleSelected) {
                    filteredRacks.forEach((r: any) => newSet.delete(r.id));
                  } else {
                    filteredRacks.forEach((r: any) => newSet.add(r.id));
                  }
                  setSelectedCentralRacks(newSet);
                }}
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', cursor: 'pointer', padding: '6px 12px', borderRadius: '4px', fontSize: '12px' }}
              >
                เลือก / ยกเลิกเลือกทั้งหมดที่เห็น
              </button>
            </div>

            <div className={styles.rackScrollInner} style={{ flex: 1, overflowY: 'auto', marginBottom: '24px', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', alignContent: 'start' }}>
              {productCentralRacks.length === 0 ? (
                <div className={styles.emptyState} style={{ gridColumn: '1 / -1' }}>ไม่มีชิ้นหมูในคลังกลาง</div>
              ) : (
                centralPiecesWithGaps.map((rack: any) => (
                  rack.isMissingPlaceholder ? (
                    <div key={rack.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px', background: 'rgba(255,107,107,0.1)', borderRadius: '6px', border: '1px dashed #ff6b6b' }}>
                      <span style={{ color: '#ff6b6b', fontWeight: 'bold', fontSize: '15px' }}>⚠️ ขาดหาย: {rack.rackNo}</span>
                    </div>
                  ) : (
                  <label key={rack.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(var(--surface-rgb),0.02)', borderRadius: '6px', opacity: rack.isUsedUp ? 0.5 : 1, cursor: 'pointer', border: selectedCentralRacks.has(rack.id) ? '1px solid #ffac33' : '1px solid transparent' }}>
                    <input
                      type="checkbox"
                      checked={selectedCentralRacks.has(rack.id)}
                      disabled={rack.isUsedUp}
                      onChange={(e) => {
                        const newSet = new Set(selectedCentralRacks);
                        if (e.target.checked) newSet.add(rack.id);
                        else newSet.delete(rack.id);
                        setSelectedCentralRacks(newSet);
                      }}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '15px' }}>{rack.rackNo} <span style={{ color: 'var(--text-secondary)' }}>({rack.remainingWeight} กก.)</span></span>
                  </label>
                  )
                ))
              )}
            </div>

            <div className={styles.mobileStackGrid} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', alignItems: 'end', background: 'rgba(255,172,51,0.05)', padding: '24px', borderRadius: '8px', border: '1px solid rgba(255,172,51,0.2)' }}>
              <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                <label className={styles.label}>เลือกแอดมินที่จะรับ {selectedCentralRacks.size} ชิ้น ({selectedCentralWeight.toFixed(2)} กก.)</label>
                <select
                  className={styles.input}
                  style={{ fontSize: '16px', padding: '12px' }}
                  value={distributeTargetUserId}
                  onChange={(e) => setDistributeTargetUserId(e.target.value)}
                >
                  <option value="">-- เลือกแอดมินปลายทาง --</option>
                  {users.filter(u => u.role !== "CENTRAL_INVENTORY" && u.role !== "PACKING").map(u => (
                    <option key={u.id} value={u.id}>
                      {displayName(u)}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.rackButtonRow} style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={handleDeleteSelectedCentralRacks}
                  disabled={isDistributing || selectedCentralRacks.size === 0}
                  title="ลบชิ้นหมูที่เลือกออกจากคลังกลางถาวร (กู้คืนไม่ได้)"
                  style={{ background: 'rgba(255,107,107,0.15)', border: '1px solid rgba(255,107,107,0.4)', color: '#ff6b6b', padding: '12px 20px', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', height: '100%' }}
                >
                  🗑️ ลบชิ้นที่เลือก
                </button>
                <button
                  onClick={() => {
                    handleDistribute().then(() => {
                      setIsDistributeModalOpen(false);
                    });
                  }}
                  disabled={isDistributing || !distributeTargetUserId || selectedCentralRacks.size === 0}
                  style={{ background: '#ffac33', border: 'none', color: '#111', padding: '12px 32px', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', height: '100%' }}
                >
                  {isDistributing ? "กำลังแจกจ่าย..." : "แจกจ่ายชิ้นที่เลือก"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Current Assignments Modal */}
      {isAssignmentsModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className={styles.rackModal} style={{ background: 'var(--modal-bg)', padding: '32px', borderRadius: '12px', width: '90%', maxWidth: '1000px', border: '1px solid var(--border-color)', boxShadow: '0 8px 32px rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, color: 'var(--text-heading)', fontSize: '24px' }}>รายการที่มอบหมายไปแล้ว</h2>
              <button
                onClick={() => { setIsAssignmentsModalOpen(false); setSelectedAssignmentRacks(new Set()); setMoveTargetUserId(""); setAutoSelectMoveCount(""); }}
                style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '24px' }}
              >✕</button>
            </div>
            
            <div className={styles.rackToolbarRow} style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
                <label className={styles.label} style={{ margin: 0 }}>เลือกแอดมิน:</label>
                <select
                  className={styles.input}
                  value={selectedUserId}
                  onChange={(e) => { setSelectedUserId(e.target.value); setSelectedAssignmentRacks(new Set()); setMoveTargetUserId(""); setAutoSelectMoveCount(""); }}
                  style={{ width: '300px' }}
                >
                  <option value="">-- เลือก --</option>
                  {centralUser && (
                    <option value={centralUser.id}>
                      คลังกลาง
                    </option>
                  )}
                  {users.filter(u => u.role !== "CENTRAL_INVENTORY" && u.role !== "PACKING").map(u => (
                    <option key={u.id} value={u.id}>
                      {displayName(u)}
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  placeholder="ค้นหารหัสถาดหรือน้ำหนัก..."
                  value={assignmentsSearch}
                  onChange={(e) => setAssignmentsSearch(e.target.value)}
                  className={styles.input}
                  style={{ padding: '8px 12px', width: '250px', fontSize: '14px', marginLeft: 'auto' }}
                />
            </div>

            {selectedUserId && (
              <div className={styles.rackToolbarRow} style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', background: 'rgba(88,166,255,0.06)', border: '1px solid rgba(88,166,255,0.2)', borderRadius: '8px', padding: '12px 16px' }}>
                <input
                  type="number"
                  placeholder="จำนวน rack"
                  value={autoSelectMoveCount}
                  onChange={(e) => setAutoSelectMoveCount(e.target.value)}
                  className={styles.input}
                  style={{ width: '110px', padding: '8px 12px', fontSize: '14px' }}
                />
                <button
                  onClick={handleAutoSelectMoveRacks}
                  style={{ background: 'rgba(var(--surface-rgb),0.1)', color: 'var(--text-primary)', border: 'none', borderRadius: '6px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px' }}
                >
                  เลือก rack น้อยไปมาก
                </button>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  เลือกแล้ว {selectedAssignmentRacks.size} ชิ้น ({currentAdminPiecesWithGaps
                    .filter((r: any) => selectedAssignmentRacks.has(r.id))
                    .reduce((sum: number, r: any) => sum + (r.remainingWeight || 0), 0)
                    .toFixed(2)} กก.)
                </span>
                <select
                  className={styles.input}
                  value={moveTargetUserId}
                  onChange={(e) => setMoveTargetUserId(e.target.value)}
                  style={{ width: '260px', padding: '8px 12px', fontSize: '14px' }}
                >
                  <option value="">-- ย้ายไปให้ --</option>
                  {centralUser && centralUser.id !== selectedUserId && (
                    <option value={centralUser.id}>คลังกลาง</option>
                  )}
                  {users.filter(u => u.role !== "CENTRAL_INVENTORY" && u.role !== "PACKING" && u.id !== selectedUserId).map(u => (
                    <option key={u.id} value={u.id}>{displayName(u)}</option>
                  ))}
                </select>
                <button
                  onClick={handleMoveSelected}
                  disabled={isMoving || !moveTargetUserId || selectedAssignmentRacks.size === 0}
                  style={{ background: 'var(--accent-blue)', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', opacity: (!moveTargetUserId || selectedAssignmentRacks.size === 0) ? 0.5 : 1 }}
                >
                  {isMoving ? "กำลังย้าย..." : "ย้ายที่เลือก"}
                </button>
              </div>
            )}

            <div className={styles.rackScrollInner} style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', alignContent: 'start', background: 'var(--input-bg)' }}>
              {!users.find(u => u.id === selectedUserId) && selectedUserId !== currentUser.id ? (
                <div className={styles.emptyState} style={{ gridColumn: '1 / -1', padding: '40px' }}>เลือกแอดมินเพื่อดูชิ้นหมูของเขา</div>
              ) : currentAdminPiecesWithGaps.length === 0 ? (
                <div className={styles.emptyState} style={{ gridColumn: '1 / -1', padding: '40px' }}>ยังไม่มีชิ้นหมูที่มอบหมาย</div>
              ) : (
                currentAdminPiecesWithGaps.map((rack: any) => (
                    <div key={rack.id} style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', background: rack.isMissingPlaceholder ? 'rgba(255,107,107,0.1)' : 'rgba(var(--surface-rgb),0.03)', borderRadius: '8px', border: rack.isMissingPlaceholder ? '1px dashed #ff6b6b' : '1px solid rgba(var(--surface-rgb),0.1)', opacity: rack.isUsedUp ? 0.5 : 1 }}>
                      {rack.isMissingPlaceholder ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                          <span style={{ color: '#ff6b6b', fontWeight: 'bold', fontSize: '16px' }}>⚠️ ขาดหาย: {rack.rackNo}</span>
                        </div>
                      ) : editingRackId === rack.id ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <input
                            type="text"
                            className={styles.input}
                            value={editingRackNo}
                            onChange={(e) => setEditingRackNo(e.target.value)}
                            style={{ padding: '8px', fontSize: '14px' }}
                            placeholder="รหัสถาด"
                          />
                          <input
                            type="number"
                            step="0.01"
                            className={styles.input}
                            value={editingWeight}
                            onChange={(e) => setEditingWeight(Number(e.target.value))}
                            style={{ padding: '8px', fontSize: '14px' }}
                            title="น้ำหนัก (กก.)"
                            placeholder="น้ำหนัก (กก.)"
                          />
                          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                            <button
                              onClick={() => handleSaveRackName(rack.id)}
                              style={{ background: 'var(--accent-green)', border: 'none', color: '#000', padding: '8px', borderRadius: '4px', cursor: 'pointer', flex: 1, fontWeight: 'bold' }}
                            >
                              บันทึก
                            </button>
                            <button
                              onClick={() => setEditingRackId(null)}
                              style={{ background: 'rgba(var(--surface-rgb),0.1)', border: 'none', color: 'var(--text-primary)', padding: '8px', borderRadius: '4px', cursor: 'pointer', flex: 1 }}
                            >
                              ยกเลิก
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div className={styles.itemName} style={{ textDecoration: rack.isUsedUp ? 'line-through' : 'none', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px' }}>
                                {!rack.isUsedUp && (
                                  <input
                                    type="checkbox"
                                    checked={selectedAssignmentRacks.has(rack.id)}
                                    onChange={(e) => {
                                      const newSet = new Set(selectedAssignmentRacks);
                                      if (e.target.checked) newSet.add(rack.id); else newSet.delete(rack.id);
                                      setSelectedAssignmentRacks(newSet);
                                    }}
                                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                  />
                                )}
                                {rack.rackNo}
                                <button
                                  onClick={() => {
                                    setEditingRackId(rack.id);
                                    setEditingRackNo(rack.rackNo);
                                    setEditingWeight(rack.remainingWeight);
                                  }}
                                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
                                  title="แก้ไขรหัสและน้ำหนัก"
                                >
                                  ✏️
                                </button>
                              </div>
                              <div style={{ fontSize: '14px', color: rack.remainingWeight === 0 ? '#ff6b6b' : 'var(--accent-green)', marginTop: '4px' }}>
                                {rack.remainingWeight === 0
                                  ? `ขายหมดแล้ว (เดิมมี ${Number(rack.initialWeight).toFixed(2)} กก.)`
                                  : `เหลือ ${Number(rack.remainingWeight).toFixed(2)} กก.`}
                              </div>
                            </div>

                            <button
                              onClick={() => handleRevoke(rack.id)}
                              style={{ background: 'rgba(255,0,0,0.2)', border: 'none', color: '#ff6b6b', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                            >
                              เพิกถอน
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Advanced Tools Modal */}

      {/* Deleted Log Modal */}
      {isDeletedLogModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className={styles.rackModal} style={{ background: 'var(--modal-bg)', padding: '32px', borderRadius: '12px', width: '90%', maxWidth: '900px', border: '1px solid var(--border-color)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, color: '#ffac33', fontSize: '24px' }}>ประวัติชิ้นหมูที่ถูกลบ / ขาดหาย</h2>
              <button
                onClick={() => setIsDeletedLogModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '24px' }}
              >✕</button>
            </div>
            {productDeletedLogs.length === 0 ? (
              <div className={styles.emptyState} style={{ padding: '40px' }}>ยังไม่มีประวัติการลบ</div>
            ) : (
              <>
                <div className={styles.desktopOnly} style={{ overflow: 'auto', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                    <thead>
                      <tr style={{ background: 'rgba(var(--surface-rgb),0.05)', textAlign: 'left' }}>
                        <th style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>วันที่ลบ</th>
                        <th style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>รหัสชิ้น</th>
                        <th style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>น้ำหนักก่อนลบ</th>
                        <th style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>ลบโดย / จากแอดมิน</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productDeletedLogs.map((log) => (
                        <tr key={log.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '12px 16px', color: 'var(--text-primary)' }}>
                            {new Date(log.deletedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
                          </td>
                          <td style={{ padding: '12px 16px', color: '#ffac33', fontWeight: 'bold' }}>{log.rackNo}</td>
                          <td style={{ padding: '12px 16px', color: 'var(--text-primary)' }}>{Number(log.weight).toFixed(2)} กก.</td>
                          <td style={{ padding: '12px 16px', color: 'var(--text-primary)' }}>{log.userName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile: stacked cards — a 4-column table is unreadable on a
                    phone, so each deletion gets its own full-width card. */}
                <div className={`${styles.mobileCardList} ${styles.rackScrollInner}`} style={{ overflowY: 'auto' }}>
                  {productDeletedLogs.map((log) => (
                    <div key={log.id} className={styles.mobileCard}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#ffac33', fontWeight: 'bold', fontSize: '15px' }}>{log.rackNo}</span>
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                          {new Date(log.deletedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
                        </span>
                      </div>
                      <div style={{ fontSize: '14px' }}>น้ำหนักก่อนลบ: {Number(log.weight).toFixed(2)} กก.</div>
                      <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>ลบโดย: {log.userName}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
