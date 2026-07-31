"use client";

import { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import { useUser } from "../../components/UserProvider";
import { isSuperAdminRole } from "../../lib/roles";
import styles from "../page.module.css";

interface DraftRack {
  rackNo: string;
  weight: number;
  selected?: boolean;
}

function ActionCard({ icon, title, subtitle, accent, onClick }: { icon: string; title: string; subtitle: string; accent: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`glass-panel ${styles.ordersButton}`}
    >
      <div className={styles.ordersIcon} style={{ background: accent }}>{icon}</div>
      <div className={styles.ordersInfo}>
        <div className={styles.ordersTitle}>{title}</div>
        <div className={styles.ordersSubtitle}>{subtitle}</div>
      </div>
      <span className={styles.ordersChevron}>›</span>
    </button>
  );
}

function incrementPrefix(prefix: string): string {
  if (!prefix) return "A";
  const match = prefix.match(/([a-zA-Z]+)$/);
  if (!match) return prefix + "A";
  
  const letters = match[1];
  let newLetters = "";
  let carry = true;
  
  for (let i = letters.length - 1; i >= 0; i--) {
      if (!carry) {
          newLetters = letters[i] + newLetters;
          continue;
      }
      const charCode = letters.charCodeAt(i);
      if (charCode === 90) { // 'Z'
          newLetters = 'A' + newLetters;
          carry = true;
      } else if (charCode === 122) { // 'z'
          newLetters = 'a' + newLetters;
          carry = true;
      } else {
          newLetters = String.fromCharCode(charCode + 1) + newLetters;
          carry = false;
      }
  }
  if (carry) {
      const isUpper = letters[0] === letters[0].toUpperCase();
      newLetters = (isUpper ? 'A' : 'a') + newLetters;
  }
  return prefix.slice(0, prefix.length - letters.length) + newLetters;
}

function decrementPrefix(prefix: string): string {
  if (!prefix) return "A";
  const match = prefix.match(/([a-zA-Z]+)$/);
  if (!match) return prefix;
  
  const letters = match[1];
  let newLetters = "";
  let borrow = true;
  
  for (let i = letters.length - 1; i >= 0; i--) {
      if (!borrow) {
          newLetters = letters[i] + newLetters;
          continue;
      }
      const charCode = letters.charCodeAt(i);
      if (charCode === 65) { // 'A'
          newLetters = 'Z' + newLetters;
          borrow = true;
      } else if (charCode === 97) { // 'a'
          newLetters = 'z' + newLetters;
          borrow = true;
      } else {
          newLetters = String.fromCharCode(charCode - 1) + newLetters;
          borrow = false;
      }
  }
  if (borrow && letters.length > 1) {
      newLetters = newLetters.slice(1);
  }
  return prefix.slice(0, prefix.length - letters.length) + newLetters;
}

function getRackSequence(basePrefix: string, baseStartNum: number, rackOffset: number): { prefix: string, num: number } {
  let num = baseStartNum + rackOffset;
  let pfx = basePrefix;
  
  while (num > 999) {
      num -= 999;
      pfx = incrementPrefix(pfx);
  }
  while (num <= 0 && baseStartNum > 0) {
      // There's no prefix before "A" — clamp here instead of letting
      // decrementPrefix wrap it around to "Z" (that produced racks like
      // Z999 out of nowhere when someone dialed the start number too low).
      if (pfx === "A" || pfx === "a") {
        num = 1;
        break;
      }
      num += 999;
      pfx = decrementPrefix(pfx);
  }
  return { prefix: pfx, num: Math.max(num, 0) };
}

export default function RacksPage() {
  const { currentUser, users, fetchUsers } = useUser();
  const centralUser = users.find(u => u.role === "CENTRAL_INVENTORY");
  const centralRacks = centralUser?.racks || [];
  const [selectedUserId, setSelectedUserId] = useState("");
  // Batch generation state
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
  const [manualAddRackNo, setManualAddRackNo] = useState("");
  const [manualAddWeight, setManualAddWeight] = useState<number | "">("");
  const [isAddingManual, setIsAddingManual] = useState(false);

  const [deletedLogs, setDeletedLogs] = useState<any[]>([]);

  const fetchDeletedLogs = async () => {
    try {
      const res = await fetch("/api/racks/deleted");
      const data = await res.json();
      if (data.success) {
        setDeletedLogs(data.logs);
      }
    } catch (e) {
      console.error("Failed to fetch deleted logs", e);
    }
  };

  useEffect(() => {
    if (isSuperAdminRole(currentUser?.role)) {
      fetchDeletedLogs();
    }
  }, [currentUser]);

  const allRackNos = useMemo(() => {
    return Array.from(new Set([
      ...users.flatMap(u => u.racks?.map(r => r.rackNo) || []),
      ...(centralRacks.map((r: any) => r.rackNo) || [])
    ])).sort();
  }, [users, centralRacks]);

  // Where the batch generator should pick up — one past whatever rack number
  // is highest across the whole system, so the admin never has to remember
  // and retype where the last batch left off.
  const nextRackStart = useMemo(() => {
    let maxPrefix = "A";
    let maxNum = 0;
    let found = false;

    allRackNos.forEach((rackNo) => {
      const match = rackNo.match(/^([A-Z]+)(\d+)(?:-\d+)?$/);
      if (!match) return;
      const [, pfx, numStr] = match;
      const num = parseInt(numStr, 10);
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
  }, [allRackNos]);

  // The single highest individual piece (rack + piece number) across the
  // whole system — shown alongside the batch generator so it's clear where
  // the auto-filled prefix/start number is continuing from.
  const lastPiece = useMemo(() => {
    type Piece = { prefix: string; num: number; piece: number; rackNo: string; owner: string };
    const pieces: Piece[] = [];

    const collect = (rackNo: string, owner: string) => {
      const match = rackNo.match(/^([A-Z]+)(\d+)-(\d+)$/);
      if (!match) return;
      pieces.push({ prefix: match[1], num: parseInt(match[2], 10), piece: parseInt(match[3], 10), rackNo, owner });
    };

    users.forEach((u) => (u.racks || []).forEach((r: any) => collect(r.rackNo, u.name)));
    centralRacks.forEach((r: any) => collect(r.rackNo, "คลังกลาง"));

    if (pieces.length === 0) return null;

    // Same base-26 prefix ordering used elsewhere for the rollover sequence.
    return pieces.reduce((best, curr) => {
      const isHigher = curr.prefix.length > best.prefix.length
        || (curr.prefix.length === best.prefix.length && curr.prefix > best.prefix)
        || (curr.prefix === best.prefix && curr.num > best.num)
        || (curr.prefix === best.prefix && curr.num === best.num && curr.piece > best.piece);
      return isHigher ? curr : best;
    });
  }, [users, centralRacks]);

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
    const sourceRacks = users.find(u => u.id === selectedUserId)?.racks || (selectedUserId === currentUser.id ? currentUser.racks : []);
    const sorted = [...sourceRacks].sort((a: any, b: any) => {
      if (a.isUsedUp !== b.isUsedUp) return a.isUsedUp ? 1 : -1;
      const aM = a.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
      const bM = b.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
      if (aM && bM && aM[1] === bM[1]) {
        const aNum = parseInt(aM[2], 10) * 10 + parseInt(aM[3], 10);
        const bNum = parseInt(bM[2], 10) * 10 + parseInt(bM[3], 10);
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
          const aM = a.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
          const bM = b.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
          if (aM && bM && aM[1] === bM[1]) {
            const p = aM[1];
            const anum = parseInt(aM[2], 10) * 5 + parseInt(aM[3], 10);
            const bnum = parseInt(bM[2], 10) * 5 + parseInt(bM[3], 10);
            if (bnum - anum > 1 && bnum - anum < 10) {
              for (let n = anum + 1; n < bnum; n++) {
                let pNum = n % 5;
                let rNum = Math.floor(n / 5);
                if (pNum === 0) { pNum = 5; rNum--; }
                const missingName = `${p}${String(rNum).padStart(aM[2].length, '0')}-${pNum}`;
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
  }, [users, selectedUserId, currentUser, assignmentsSearch, allRackNos]);

  const centralPiecesWithGaps = useMemo(() => {
    const sorted = [...centralRacks].sort((a: any, b: any) => {
      const matchA = a.rackNo.match(/([A-Z]+)(\d+)(?:-(\d+))?/);
      const matchB = b.rackNo.match(/([A-Z]+)(\d+)(?:-(\d+))?/);
      if (matchA && matchB) {
        if (matchA[1] !== matchB[1]) return matchA[1].localeCompare(matchB[1]);
        if (parseInt(matchA[2]) !== parseInt(matchB[2])) return parseInt(matchA[2]) - parseInt(matchB[2]);
        if (matchA[3] && matchB[3]) return parseInt(matchA[3]) - parseInt(matchB[3]);
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
          const aM = a.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
          const bM = b.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
          if (aM && bM && aM[1] === bM[1]) {
            const p = aM[1];
            const anum = parseInt(aM[2], 10) * 5 + parseInt(aM[3], 10);
            const bnum = parseInt(bM[2], 10) * 5 + parseInt(bM[3], 10);
            if (bnum - anum > 1 && bnum - anum < 10) {
              for (let n = anum + 1; n < bnum; n++) {
                let pNum = n % 5;
                let rNum = Math.floor(n / 5);
                if (pNum === 0) { pNum = 5; rNum--; }
                const missingName = `${p}${String(rNum).padStart(aM[2].length, '0')}-${pNum}`;
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
  }, [centralRacks, distributeSearch, allRackNos]);

  const globalMissingPieces = useMemo(() => {
    const missing = new Set<string>();
    
    const findGaps = (rackList: any[]) => {
      const sorted = [...rackList].sort((a: any, b: any) => {
        const matchA = a.rackNo.match(/([A-Z]+)(\d+)(?:-(\d+))?/);
        const matchB = b.rackNo.match(/([A-Z]+)(\d+)(?:-(\d+))?/);
        if (matchA && matchB) {
          if (matchA[1] !== matchB[1]) return matchA[1].localeCompare(matchB[1]);
          if (parseInt(matchA[2]) !== parseInt(matchB[2])) return parseInt(matchA[2]) - parseInt(matchB[2]);
          if (matchA[3] && matchB[3]) return parseInt(matchA[3]) - parseInt(matchB[3]);
        }
        return a.rackNo.localeCompare(b.rackNo, undefined, { numeric: true });
      });

      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i+1];
        if (!a.isUsedUp && !b.isUsedUp) {
          const aM = a.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
          const bM = b.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
          if (aM && bM && aM[1] === bM[1]) {
            const p = aM[1];
            const anum = parseInt(aM[2], 10) * 5 + parseInt(aM[3], 10);
            const bnum = parseInt(bM[2], 10) * 5 + parseInt(bM[3], 10);
            if (bnum - anum > 1 && bnum - anum < 10) {
              for (let n = anum + 1; n < bnum; n++) {
                let pNum = n % 5;
                let rNum = Math.floor(n / 5);
                if (pNum === 0) { pNum = 5; rNum--; }
                const missingName = `${p}${String(rNum).padStart(aM[2].length, '0')}-${pNum}`;
                if (!allRackNos.includes(missingName)) {
                  missing.add(missingName);
                }
              }
            }
          }
        }
      }
    };

    users.forEach(u => findGaps(u.racks || []));
    findGaps(centralRacks);
    
    return Array.from(missing).sort();
  }, [users, centralRacks, allRackNos]);

  const inventorySummary = useMemo(() => {
    const perAdmin = users
      .filter((u) => u.role !== "CENTRAL_INVENTORY" && u.role !== "PACKING")
      .map((u) => {
        const racks = u.racks || [];
        const pieces = racks.filter((r) => !r.isUsedUp).length;
        const weight = racks.reduce((sum, r) => sum + (!r.isUsedUp ? (r.remainingWeight || 0) : 0), 0);
        return { name: u.name, pieces, weight };
      })
      .sort((a, b) => b.weight - a.weight);

    const centralPieces = centralRacks.filter((r: any) => !r.isUsedUp).length;
    const centralWeight = centralRacks.reduce((sum: number, r: any) => sum + (!r.isUsedUp ? (r.remainingWeight || 0) : 0), 0);

    const totalPieces = perAdmin.reduce((s, a) => s + a.pieces, 0) + centralPieces;
    const totalWeight = perAdmin.reduce((s, a) => s + a.weight, 0) + centralWeight;

    return { perAdmin, centralPieces, centralWeight, totalPieces, totalWeight };
  }, [users, centralRacks]);

  const handleSelectDistributeRange = () => {
    if (!centralRacks.length || !distributeStartRack || !distributeEndRack) return;
    const startIndex = centralRacks.findIndex((r: any) => r.rackNo === distributeStartRack);
    const endIndex = centralRacks.findIndex((r: any) => r.rackNo === distributeEndRack);
    
    if (startIndex === -1 || endIndex === -1) return;
    
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    
    const newSet = new Set(selectedCentralRacks);
    for (let i = start; i <= end; i++) {
      if (!centralRacks[i].isUsedUp) {
        newSet.add(centralRacks[i].id);
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
        const match = r.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
        // If it starts with the old prefix (or oldPrefix is empty), replace it
        if (match && (oldPrefix === "" || match[1] === oldPrefix)) {
          return { ...r, rackNo: `${newPrefix}${match[2]}-${match[3]}` };
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
        const match = r.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
        // Only update items that match the current prefix
        if (match && match[1] === prefix) {
          const currentNum = parseInt(match[2], 10);
          const { prefix: newPfx, num: newNum } = getRackSequence(match[1], currentNum, diff);
          return { ...r, rackNo: `${newPfx}${String(newNum).padStart(3, '0')}-${match[3]}` };
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
          const rackIncrement = Math.floor(idx / 5);
          const pieceNumber = (idx % 5) + 1;
          const { prefix: seqPfx, num: seqNum } = getRackSequence(prefix, startNum, rackIncrement);
          const formattedNum = String(seqNum).padStart(3, '0');
          newRacks.push({
            rackNo: `${seqPfx}${formattedNum}-${pieceNumber}`,
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
      const { prefix: pfx, num } = getRackSequence(prefix, startNum, Math.floor(draftRacks.length / 5));
      newName = `${pfx}${String(num).padStart(3, '0')}-${(draftRacks.length % 5) + 1}`;
    } else {
      const { prefix: pfx, num } = getRackSequence(prefix, startNum, 0);
      newName = `${pfx}${String(num).padStart(3, '0')}-1`;
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
    const match = lastItem.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
    if (match) {
      const p = match[1];
      let rNum = parseInt(match[2], 10);
      let pNum = parseInt(match[3], 10);
      pNum++;
      if (pNum > 5) { pNum = 1; rNum++; }
      nextName = `${p}${String(rNum).padStart(match[2].length, '0')}-${pNum}`;
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
      const res = await fetch("/api/users/racks/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId, racks: racksToAssign }),
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
      const res = await fetch(`/api/users/racks?id=${assignmentId}`, { method: "DELETE" });
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
      const res = await fetch("/api/users/racks/reassign", {
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

  const handleSaveRackName = async (id: string) => {
    if (!editingRackNo.trim()) return;
    try {
      const res = await fetch("/api/users/racks", {
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
      const res = await fetch("/api/users/racks/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startRackNo: bulkShiftTarget.trim(), direction }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`เลื่อนสำเร็จ ${data.count} ชิ้น`);
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
      };
      if (manualAddWeight !== "") {
        payload.weight = Number(manualAddWeight);
      }

      const res = await fetch("/api/users/racks", {
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

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>จัดการชิ้นหมู</h1>
        <p className={styles.subtitle}>จัดสรรชิ้นหมูให้แอดมินและดูแลคลังสินค้า</p>
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
          {inventorySummary.perAdmin.map((a) => (
            <div key={a.name} style={{ flex: '1 1 160px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '12px 16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>👤 {a.name}</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{a.pieces} ชิ้น · {a.weight.toFixed(2)} กก.</div>
            </div>
          ))}
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
          onClick={() => setIsDistributeModalOpen(true)}
        />
        <ActionCard
          icon="📋"
          title="รายการที่มอบหมายแล้ว"
          subtitle="ดู แก้ไข หรือเพิกถอนชิ้นของแต่ละแอดมิน"
          accent="rgba(255,255,255,0.12)"
          onClick={() => setIsAssignmentsModalOpen(true)}
        />
        <ActionCard
          icon="🗑️"
          title="ประวัติการลบ"
          subtitle={deletedLogs.length > 0 ? `${deletedLogs.length} รายการ` : "ยังไม่มีรายการ"}
          accent="rgba(139,148,158,0.15)"
          onClick={() => setIsDeletedLogModalOpen(true)}
        />
      </div>

      {/* Batch Assign Modal */}
      {isBatchModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#1a1a1a', padding: '32px', borderRadius: '12px', width: '90%', maxWidth: '900px', border: '1px solid var(--border-color)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, color: 'var(--accent-blue)', fontSize: '24px' }}>เพิ่มชิ้นหมูใหม่</h2>
              <button
                onClick={() => { setIsBatchModalOpen(false); setShowAdvancedTools(false); }}
                style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '24px' }}
              >✕</button>
            </div>

            <div style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '14px', marginBottom: '12px' }}>สร้างลำดับชิ้นหมูจากไฟล์ Excel</h3>
              {lastPiece && (
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', padding: '8px 12px' }}>
                  📍 ถาดสุดท้ายในระบบตอนนี้: <strong style={{ color: 'var(--text-primary)' }}>{lastPiece.prefix}{String(lastPiece.num).padStart(3, '0')} ชิ้นที่ {lastPiece.piece}</strong> ({lastPiece.owner}) — ระบบเริ่มให้ที่ {prefix}{String(startNum).padStart(3, '0')} ต่ออัตโนมัติ
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: '12px', alignItems: 'end' }}>
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ fontSize: '14px' }}>ชิ้นหมูที่สร้างไว้ ({draftRacks.length})</h3>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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

                  <div style={{ maxHeight: '300px', overflowY: 'auto', paddingRight: '8px', marginBottom: '16px' }}>
                      {draftRacks
                        .map((rack, idx) => ({ ...rack, originalIdx: idx }))
                        .filter(r => !searchDraft || r.rackNo.toLowerCase().includes(searchDraft.toLowerCase()))
                        .map((rack) => (
                        <div key={rack.originalIdx} style={{ display: 'grid', gridTemplateColumns: 'auto 2fr 1fr auto', gap: '12px', marginBottom: '8px', alignItems: 'center', background: rack.weight === 0 ? 'rgba(255,255,0,0.1)' : 'transparent', padding: rack.weight === 0 ? '4px' : '0' }}>
                          <input
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
                            className={styles.input}
                            value={rack.rackNo}
                            onChange={e => handleDraftNameChange(rack.originalIdx, e.target.value)}
                            style={{ color: rack.weight === 0 ? '#aaa' : 'inherit' }}
                          />
                          <div style={{ position: 'relative' }}>
                            <input
                              type="number"
                              className={styles.input}
                              value={rack.weight}
                              onChange={e => handleDraftWeightChange(rack.originalIdx, Number(e.target.value))}
                            />
                            <span style={{ position: 'absolute', right: '12px', top: '10px', color: '#666', fontSize: '12px' }}>กก.</span>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => handleInsertGap(rack.originalIdx)} title="แทรกช่องว่างตรงนี้" style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px' }}>+</button>
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
                                คลังกลาง (เหลือ {centralRacks.reduce((sum: any, r: any) => sum + (!r.isUsedUp ? r.remainingWeight : 0), 0).toFixed(2) || '0.00'} กก.)
                              </option>
                            )}
                            {users.filter(u => u.role !== "CENTRAL_INVENTORY" && u.role !== "PACKING").map(u => (
                              <option key={u.id} value={u.id}>
                                {u.name} (เหลือ {u.racks?.reduce((sum, r) => sum + (!r.isUsedUp ? (r.remainingWeight || 0) : 0), 0).toFixed(2) || '0.00'} กก.)
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <button
                        onClick={handleAssignBatch}
                        className={styles.button}
                        disabled={isLoading || !selectedUserId}
                        style={{ width: '100%', background: 'var(--accent-blue)', color: 'white' }}
                      >
                        {isLoading ? "กำลังมอบหมาย..." : `มอบให้ ${selectedUserId === currentUser.id ? "คลังกลาง" : (selectedUser?.name || "แอดมิน")}`}
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
                        {Array.from(new Set([
                          ...users.flatMap(u => u.racks?.map(r => r.rackNo) || []),
                          ...(centralRacks.map((r: any) => r.rackNo) || [])
                        ])).sort().map(no => <option key={no} value={no} />)}
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
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={{ padding: '16px', background: 'rgba(255,107,107, 0.1)', borderRadius: '8px', marginBottom: '20px', border: '1px solid rgba(255,107,107, 0.3)' }}>
                        <h3 style={{ fontSize: '14px', marginBottom: '8px', color: '#ff6b6b' }}>เลื่อนลำดับฉุกเฉิน (ทั้งระบบ)</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                          ใช้แก้ไขเลขถาดที่เพี้ยนไป ให้ทั้งระบบพร้อมกัน
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '8px', alignItems: 'end' }}>
                          <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                            <input
                              type="text"
                              className={styles.input}
                              placeholder="เริ่มจากชิ้น (เช่น A005-3)"
                              value={bulkShiftTarget}
                              onChange={e => setBulkShiftTarget(e.target.value)}
                              list="all-racks-list"
                            />
                          </div>
                          <button
                            onClick={() => handleBulkShift('down')}
                            disabled={isShifting || !bulkShiftTarget}
                            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '10px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
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
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', alignItems: 'end' }}>
                          <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                            <input
                              type="text"
                              className={styles.input}
                              placeholder="รหัสชิ้น (เช่น A005-3)"
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
          <div style={{ background: '#1a1a1a', padding: '32px', borderRadius: '12px', width: '90%', maxWidth: '900px', border: '1px solid var(--border-color)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, color: '#ffac33', fontSize: '24px' }}>แจกจ่ายจากคลังกลาง</h2>
              <button 
                onClick={() => setIsDistributeModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '24px' }}
              >✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '16px', marginBottom: '24px', alignItems: 'end' }}>
              <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                <label className={styles.label}>ตั้งแต่ชิ้น</label>
                <input
                  type="text"
                  list="rack-datalist"
                  className={styles.input}
                  style={{ fontSize: '16px', padding: '12px' }}
                  placeholder="เช่น C001-1"
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
                  placeholder="เช่น C050-5"
                  value={distributeEndRack}
                  onChange={(e) => setDistributeEndRack(e.target.value)}
                />
              </div>
              <button
                onClick={handleSelectDistributeRange}
                disabled={!distributeStartRack || !distributeEndRack}
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'white', cursor: 'pointer', padding: '12px 24px', borderRadius: '8px', fontSize: '14px', height: '100%', fontWeight: 'bold' }}
              >
                เลือกช่วง
              </button>
            </div>

            <datalist id="rack-datalist">
              {[...centralRacks].sort((a: any, b: any) => {
                const matchA = a.rackNo.match(/([A-Z]+)(\d+)(?:-(\d+))?/);
                const matchB = b.rackNo.match(/([A-Z]+)(\d+)(?:-(\d+))?/);
                if (matchA && matchB) {
                  if (matchA[1] !== matchB[1]) return matchA[1].localeCompare(matchB[1]);
                  if (parseInt(matchA[2]) !== parseInt(matchB[2])) return parseInt(matchA[2]) - parseInt(matchB[2]);
                  if (matchA[3] && matchB[3]) return parseInt(matchA[3]) - parseInt(matchB[3]);
                }
                return a.rackNo.localeCompare(b.rackNo, undefined, { numeric: true });
              }).map((r: any) => (
                <option key={`dl-${r.id}`} value={r.rackNo} />
              ))}
            </datalist>

            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '14px', marginBottom: '12px' }}>เลือกถาดอัตโนมัติตามลำดับ</h3>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
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
                    
                    const available = [...centralRacks].filter((r: any) => !r.isUsedUp).sort((a: any, b: any) => {
                      const matchA = a.rackNo.match(/([A-Z]+)(\d+)(?:-(\d+))?/);
                      const matchB = b.rackNo.match(/([A-Z]+)(\d+)(?:-(\d+))?/);
                      if (matchA && matchB) {
                        if (matchA[1] !== matchB[1]) return matchA[1].localeCompare(matchB[1]);
                        if (parseInt(matchA[2]) !== parseInt(matchB[2])) return parseInt(matchA[2]) - parseInt(matchB[2]);
                        if (matchA[3] && matchB[3]) return parseInt(matchA[3]) - parseInt(matchB[3]);
                      }
                      return a.rackNo.localeCompare(b.rackNo, undefined, { numeric: true });
                    });

                    const grouped = available.reduce((acc: any, curr: any) => {
                      const baseRack = curr.rackNo.split('-')[0];
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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
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
                  const filteredRacks = centralRacks.filter((r: any) => {
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

            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '24px', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', alignContent: 'start' }}>
              {centralRacks.length === 0 ? (
                <div className={styles.emptyState} style={{ gridColumn: '1 / -1' }}>ไม่มีชิ้นหมูในคลังกลาง</div>
              ) : (
                centralPiecesWithGaps.map((rack: any) => (
                  rack.isMissingPlaceholder ? (
                    <div key={rack.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px', background: 'rgba(255,107,107,0.1)', borderRadius: '6px', border: '1px dashed #ff6b6b' }}>
                      <span style={{ color: '#ff6b6b', fontWeight: 'bold', fontSize: '15px' }}>⚠️ ขาดหาย: {rack.rackNo}</span>
                    </div>
                  ) : (
                  <label key={rack.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', opacity: rack.isUsedUp ? 0.5 : 1, cursor: 'pointer', border: selectedCentralRacks.has(rack.id) ? '1px solid #ffac33' : '1px solid transparent' }}>
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', alignItems: 'end', background: 'rgba(255,172,51,0.05)', padding: '24px', borderRadius: '8px', border: '1px solid rgba(255,172,51,0.2)' }}>
              <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                <label className={styles.label}>เลือกแอดมินที่จะรับ {selectedCentralRacks.size} ชิ้น</label>
                <select
                  className={styles.input}
                  style={{ fontSize: '16px', padding: '12px' }}
                  value={distributeTargetUserId}
                  onChange={(e) => setDistributeTargetUserId(e.target.value)}
                >
                  <option value="">-- เลือกแอดมินปลายทาง --</option>
                  {users.filter(u => u.role !== "CENTRAL_INVENTORY" && u.role !== "PACKING").map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
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
      )}

      {/* Current Assignments Modal */}
      {isAssignmentsModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#1a1a1a', padding: '32px', borderRadius: '12px', width: '90%', maxWidth: '1000px', border: '1px solid var(--border-color)', boxShadow: '0 8px 32px rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, color: '#fff', fontSize: '24px' }}>รายการที่มอบหมายไปแล้ว</h2>
              <button
                onClick={() => setIsAssignmentsModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '24px' }}
              >✕</button>
            </div>
            
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
                <label className={styles.label} style={{ margin: 0 }}>เลือกแอดมิน:</label>
                <select
                  className={styles.input}
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
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
                      {u.name}
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

            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', alignContent: 'start', background: 'rgba(0,0,0,0.2)' }}>
              {!users.find(u => u.id === selectedUserId) && selectedUserId !== currentUser.id ? (
                <div className={styles.emptyState} style={{ gridColumn: '1 / -1', padding: '40px' }}>เลือกแอดมินเพื่อดูชิ้นหมูของเขา</div>
              ) : (users.find(u => u.id === selectedUserId)?.racks || (selectedUserId === currentUser.id ? currentUser.racks : [])).length === 0 ? (
                <div className={styles.emptyState} style={{ gridColumn: '1 / -1', padding: '40px' }}>ยังไม่มีชิ้นหมูที่มอบหมาย</div>
              ) : (
                currentAdminPiecesWithGaps.map((rack: any) => (
                    <div key={rack.id} style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', background: rack.isMissingPlaceholder ? 'rgba(255,107,107,0.1)' : 'rgba(255,255,255,0.03)', borderRadius: '8px', border: rack.isMissingPlaceholder ? '1px dashed #ff6b6b' : '1px solid rgba(255,255,255,0.1)', opacity: rack.isUsedUp ? 0.5 : 1 }}>
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
                              style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: '8px', borderRadius: '4px', cursor: 'pointer', flex: 1 }}
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
          <div style={{ background: '#1a1a1a', padding: '32px', borderRadius: '12px', width: '90%', maxWidth: '900px', border: '1px solid var(--border-color)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, color: '#ffac33', fontSize: '24px' }}>ประวัติชิ้นหมูที่ถูกลบ / ขาดหาย</h2>
              <button
                onClick={() => setIsDeletedLogModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '24px' }}
              >✕</button>
            </div>
            {deletedLogs.length === 0 ? (
              <div className={styles.emptyState} style={{ padding: '40px' }}>ยังไม่มีประวัติการลบ</div>
            ) : (
              <div style={{ overflow: 'auto', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.05)', textAlign: 'left' }}>
                      <th style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>วันที่ลบ</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>รหัสชิ้น</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>น้ำหนักก่อนลบ</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>ลบโดย / จากแอดมิน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deletedLogs.map((log) => (
                      <tr key={log.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '12px 16px', color: '#fff' }}>
                          {new Date(log.deletedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
                        </td>
                        <td style={{ padding: '12px 16px', color: '#ffac33', fontWeight: 'bold' }}>{log.rackNo}</td>
                        <td style={{ padding: '12px 16px', color: '#fff' }}>{Number(log.weight).toFixed(2)} กก.</td>
                        <td style={{ padding: '12px 16px', color: '#fff' }}>{log.userName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
