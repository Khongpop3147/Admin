"use client";

import { useEffect, useState } from "react";

interface Piece {
  rackNo: string;
  isUsedUp?: boolean;
}

interface RackCount {
  baseRack: string;
  count: number;
}

export default function PrintInventoryPage() {
  const [rackCounts, setRackCounts] = useState<RackCount[] | null>(null);

  useEffect(() => {
    // Read the exact piece list the opener page already had on screen,
    // handed off via sessionStorage right before window.open — a fresh
    // server fetch here would resolve to the real logged-in session, not
    // whichever user a DEV is currently impersonating via the sidebar
    // switcher, and would show the wrong (often empty) inventory.
    let pieces: Piece[] = [];
    try {
      const raw = sessionStorage.getItem("storefront-print-inventory");
      pieces = raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error("Failed to read inventory for print", err);
    }
    pieces = pieces.filter((r) => !r.isUsedUp);
    const grouped = pieces.reduce((acc: Record<string, number>, p) => {
      const baseRack = (p.rackNo || "ไม่ทราบถาด").split("-")[0];
      acc[baseRack] = (acc[baseRack] || 0) + 1;
      return acc;
    }, {});
    const counts = Object.entries(grouped)
      .map(([baseRack, count]) => ({ baseRack, count }))
      .sort((a, b) => a.baseRack.localeCompare(b.baseRack, undefined, { numeric: true }));
    setRackCounts(counts);
  }, []);

  useEffect(() => {
    if (rackCounts !== null) {
      setTimeout(() => window.print(), 500);
    }
  }, [rackCounts]);

  if (rackCounts === null) return <div style={{ padding: 20 }}>Loading...</div>;

  const totalPieces = rackCounts.reduce((sum, r) => sum + r.count, 0);
  const dateStr = new Date().toLocaleDateString("th-TH", { dateStyle: "medium" });

  return (
    <div style={{ padding: "20px", backgroundColor: "#fff", color: "#000", fontFamily: "sans-serif" }}>
      <h1 style={{ textAlign: "center", marginBottom: "4px", fontSize: "22px", fontWeight: "bold", color: "#000" }}>
        หมูคงเหลือในคลัง — หน้าร้าน
      </h1>
      <div style={{ textAlign: "center", marginBottom: "24px", fontSize: "14px", color: "#333" }}>
        ณ วันที่ {dateStr}
      </div>

      {rackCounts.length === 0 ? (
        <div style={{ textAlign: "center", padding: "20px", color: "#666" }}>ไม่มีหมูคงเหลือในคลัง</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #000", padding: "10px", textAlign: "left", width: "70%" }}>รหัสถาด (Rack)</th>
              <th style={{ border: "1px solid #000", padding: "10px", textAlign: "center", width: "30%" }}>จำนวนชิ้น</th>
            </tr>
          </thead>
          <tbody>
            {rackCounts.map((r) => (
              <tr key={r.baseRack}>
                <td style={{ border: "1px solid #000", padding: "10px", fontSize: "18px" }}>{r.baseRack}</td>
                <td style={{ border: "1px solid #000", padding: "10px", textAlign: "center", fontSize: "18px", fontWeight: "bold" }}>
                  {r.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: "20px", fontSize: "16px", fontWeight: "bold", textAlign: "right" }}>
        รวม {totalPieces} ชิ้น
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        @page {
          size: 148mm 210mm;
          margin: 1cm;
        }
        @media print {
          body { min-height: 0 !important; background: white !important; }
          button { display: none !important; }
          tr { break-inside: avoid; page-break-inside: avoid; }
          thead { display: table-header-group; }
        }
      `,
        }}
      />
    </div>
  );
}
