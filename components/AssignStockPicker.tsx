import { PRODUCT_TYPES, DEFAULT_PRODUCT_TYPE, getBaseRackKeyAuto } from "../lib/rackCode";
import { MAX_OVER_DEVIATION_KG, MIN_UNDER_DEVIATION_KG, MAX_UNDER_DEVIATION_KG } from "../lib/rackAllocate";

export interface RackPiece {
  assignmentId: string;
  rackNo: string;
  weight: number;
}

export interface RackOption {
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
export function shortageWarning(productLabel: string, targetWeight: number, selected: RackPiece[]): string | null {
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
// isn't the point here the way it is at order-allocation time. Shared
// between the "ลูกค้ารอหมู" waiting-list picker and Order Detail's own
// "add stock to an order that has none" flow — same UI either way, just a
// different save handler wired in by each caller.
export function AssignItemPicker({
  item,
  racks,
  selected,
  onToggle,
  onSave,
  isBusy,
}: {
  item: { productType: string; weightKg: number };
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
                  background: isSelected ? "rgba(88,166,255,0.16)" : "rgba(var(--surface-rgb),0.03)",
                  border: `1px solid ${isSelected ? "var(--accent-blue)" : "rgba(var(--surface-rgb),0.08)"}`,
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
