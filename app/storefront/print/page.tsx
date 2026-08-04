"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { BASE_PATH } from "../../../lib/basePath";
import { getRackDisplay } from "../../../lib/porkSlip";

interface Order {
  id: string;
  orderNo: number;
  createdAt: string;
  rackDetails: string;
}

function PrintRackContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!orderId) {
      setIsLoading(false);
      return;
    }
    fetch(`${BASE_PATH}/api/orders?id=${orderId}`)
      .then((res) => res.json())
      .then((data) => setOrder(data.orders?.[0] || null))
      .catch((err) => console.error("Failed to fetch order for print", err))
      .finally(() => setIsLoading(false));
  }, [orderId]);

  useEffect(() => {
    if (!isLoading && order) {
      // Small delay so the page has actually painted before printing.
      setTimeout(() => window.print(), 500);
    }
  }, [isLoading, order]);

  if (isLoading) return <div style={{ padding: 20 }}>Loading...</div>;
  if (!orderId) return <div style={{ padding: 20 }}>No order specified.</div>;
  if (!order) return <div style={{ padding: 20 }}>Order not found.</div>;

  const rackData = getRackDisplay(order.rackDetails);
  const dateStr = new Date(order.createdAt).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div style={{ padding: "20px", backgroundColor: "#fff", color: "#000", fontFamily: "sans-serif" }}>
      <h1 style={{ textAlign: "center", marginBottom: "4px", fontSize: "22px", fontWeight: "bold", color: "#000" }}>
        ใบรายการถาดหมู — ขายหน้าร้าน
      </h1>
      <div style={{ textAlign: "center", marginBottom: "24px", fontSize: "14px", color: "#333" }}>
        ออเดอร์ #{order.orderNo || "?"} · {dateStr}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ border: "1px solid #000", padding: "10px", textAlign: "left", width: "70%" }}>รหัสถาด (Rack)</th>
            <th style={{ border: "1px solid #000", padding: "10px", textAlign: "center", width: "30%" }}>น้ำหนัก</th>
          </tr>
        </thead>
        <tbody>
          {rackData.detailsArray.map((line, idx) => (
            <tr key={idx}>
              <td style={{ border: "1px solid #000", padding: "10px", fontSize: "18px" }}>{line.split(" = ")[0]}</td>
              <td style={{ border: "1px solid #000", padding: "10px", textAlign: "center", fontSize: "18px" }}>
                {line.split(" = ")[1] || "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: "20px", fontSize: "16px", fontWeight: "bold", textAlign: "right" }}>
        รวม {rackData.pieceCount} ชิ้น · {rackData.totalWeight.toFixed(2)} กก.
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

export default function PrintRackPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PrintRackContent />
    </Suspense>
  );
}
