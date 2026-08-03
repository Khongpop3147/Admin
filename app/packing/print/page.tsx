"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

interface Order {
  id: string;
  orderNo: number;
  customerName: string;
  customerAddress?: string;
  rackDetails: string;
  platform: string;
  shippingMethod: string;
  orderStatus: string;
  codAmount?: number | null;
}

function PrintSlipContent() {
  const searchParams = useSearchParams();
  const dateStr = searchParams.get("date");
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  // Natural (unscaled) content height, measured once the table has fully
  // rendered — used to shrink everything down to fit a single printed page
  // instead of letting the order table spill onto a second page.
  const [printFit, setPrintFit] = useState<{ scale: number; height: number | null }>({ scale: 1, height: null });

  useEffect(() => {
    if (dateStr) {
      fetchOrders(dateStr);
    } else {
      setIsLoading(false);
    }
  }, [dateStr]);

  // Report grouping order: NIM Express, then EMS, then EMS (COD) last.
  const getShippingRank = (order: Order) => {
    const method = order.shippingMethod || "";
    const hasCod = !!order.codAmount;
    if (method === "NIM Express") return 0;
    if (method === "EMS" && !hasCod) return 1;
    if (method === "EMS" && hasCod) return 2;
    return 3;
  };

  const fetchOrders = async (date: string) => {
    try {
      const res = await fetch(`/api/orders?date=${date}`);
      const data = await res.json();
      if (data.orders) {
        // Filter out storefront (walk-in) orders — by platform AND by shipping
        // method, so a storefront-style order never sneaks into the report even
        // if its platform field wasn't tagged "Storefront".
        const filtered = data.orders.filter((o: Order) =>
          o.platform !== 'Storefront' &&
          o.shippingMethod !== 'รับหน้าร้าน' &&
          o.shippingMethod !== 'ส่งเอง'
        );

        // Group by shipping method (NIM Express, EMS, EMS (COD)); within each
        // group keep orders sorted lowest orderNo to highest.
        filtered.sort((a: Order, b: Order) => {
          const rankDiff = getShippingRank(a) - getShippingRank(b);
          if (rankDiff !== 0) return rankDiff;
          return (a.orderNo || 0) - (b.orderNo || 0);
        });

        setOrders(filtered);
      }
    } catch (error) {
      console.error("Failed to fetch orders for print", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoading && orders.length > 0 && contentRef.current) {
      // A4 landscape usable height at the @page's 1cm margins, in CSS px —
      // the CSS spec fixes 1in = 96px for both screen and print, so this
      // conversion holds regardless of the printer's actual DPI:
      // (210mm - 2*10mm) / 25.4 * 96 ≈ 718px; 710 leaves a small safety margin.
      // (also accounts for this page's own 20px top+bottom padding, below)
      const AVAILABLE_HEIGHT_PX = 670;
      const measuredHeight = contentRef.current.scrollHeight;
      const rawScale = measuredHeight > AVAILABLE_HEIGHT_PX ? AVAILABLE_HEIGHT_PX / measuredHeight : 1;
      // On an unusually busy day, shrinking far enough to force everything
      // onto one page would make the text illegible. A CSS transform only
      // affects paint, not the layout box a parent reserves for it — so
      // clamping the scale but still forcing the single-page height here
      // would leave most of that reserved space blank AND still spill onto
      // extra (mostly empty) pages. Simpler and correct: below the
      // legibility floor, skip shrinking/clamping entirely and let it print
      // at full size across as many normal, legible pages as it needs.
      const MIN_SCALE = 0.45;
      const fitsLegibly = rawScale >= MIN_SCALE;
      setPrintFit(fitsLegibly ? { scale: rawScale, height: measuredHeight } : { scale: 1, height: null });

      // Small delay to allow images/fonts to load and the scale above to
      // repaint before printing
      const timer = setTimeout(() => {
        window.print();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isLoading, orders]);

  const getRackDisplay = (rackDetailsStr: string) => {
    if (!rackDetailsStr || rackDetailsStr === '[]') return { details: "-", totalWeight: 0 };
    try {
      const racks = JSON.parse(rackDetailsStr);
      const groups: Record<string, number[]> = {};
      let totalWeight = 0;
      
      racks.forEach((r: any) => {
        if (!r.rackNo) return;
        const base = r.rackNo.split('-')[0];
        if (!groups[base]) groups[base] = [];
        const w = parseFloat(r.weight) || 0;
        groups[base].push(w);
        totalWeight += w;
      });

      const detailsArray = Object.entries(groups).map(([base, weights]) => {
        return `${base} = ${weights.join(' / ')} kg`;
      });
      
      return { detailsArray, totalWeight };
    } catch(e) {
      return { detailsArray: ["-"], totalWeight: 0 };
    }
  };

  if (isLoading) return <div style={{ padding: 20 }}>Loading...</div>;
  if (!dateStr) return <div style={{ padding: 20 }}>No date specified.</div>;
  if (orders.length === 0) return <div style={{ padding: 20 }}>No orders found for this date.</div>;

  return (
    <div style={{ padding: '20px', backgroundColor: '#fff', color: '#000', fontFamily: 'sans-serif' }}>
      {/* Outer box is clamped to the post-scale height so the leftover space
          from shrinking doesn't still reserve a full second page; the inner
          box carries the actual scale transform (transform doesn't affect
          layout size, only paint, hence the two-layer split). */}
      <div style={{ height: printFit.height != null ? printFit.height * printFit.scale : undefined, overflow: 'hidden' }}>
        <div ref={contentRef} style={{ transform: `scale(${printFit.scale})`, transformOrigin: 'top left' }}>
          <h1 style={{ textAlign: 'center', marginBottom: '20px', fontSize: '24px', fontWeight: 'bold', color: '#000' }}>
            ใบเบิกหมูประจำวันที่ {dateStr}
          </h1>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #000', padding: '10px', textAlign: 'left', width: '7%' }}>Order #</th>
                <th style={{ border: '1px solid #000', padding: '10px', textAlign: 'left', width: '28%' }}>ชื่อลูกค้า / ที่อยู่</th>
                <th style={{ border: '1px solid #000', padding: '10px', textAlign: 'left', width: '30%' }}>รหัสถาด (Rack)</th>
                <th style={{ border: '1px solid #000', padding: '10px', textAlign: 'left', width: '20%' }}>วิธีจัดส่ง</th>
                <th style={{ border: '1px solid #000', padding: '10px', textAlign: 'center', width: '15%' }}>น้ำหนักรวม</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const rackData = getRackDisplay(order.rackDetails);
                return (
                  <tr key={order.id}>
                    <td style={{ border: '1px solid #000', padding: '10px', fontSize: '18px' }}>{order.orderNo || "?"}</td>
                    <td style={{ border: '1px solid #000', padding: '10px', fontWeight: 'bold', fontSize: '18px' }}>
                      {order.customerName}
                      {order.customerAddress && (
                        <div style={{ fontWeight: 'normal', fontSize: '13px', marginTop: '4px', color: '#333' }}>{order.customerAddress}</div>
                      )}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px', fontSize: '18px' }}>
                      {rackData.detailsArray?.map((line, idx) => (
                        <div key={idx}>{line}</div>
                      ))}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px', fontSize: '18px' }}>
                      {order.shippingMethod || "-"}{order.codAmount ? " (COD)" : ""}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px', textAlign: 'center', fontSize: '18px', fontWeight: 'bold' }}>
                      {rackData.totalWeight > 0 ? `${rackData.totalWeight.toFixed(2)} kg` : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @page {
          size: 297mm 210mm;
          margin: 1cm;
        }
        @media print {
          /* Overrides globals.css's app-wide "body { min-height: 100vh }" —
             unscoped to screen, it survives into print and makes the body's
             own box taller than the printable content area (page minus
             margins), spilling an otherwise-empty second page. */
          body { min-height: 0 !important; background: white !important; }
          button { display: none !important; }
          tr { break-inside: avoid; page-break-inside: avoid; }
          thead { display: table-header-group; }
        }
      `}} />
    </div>
  );
}

export default function PrintSlipPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PrintSlipContent />
    </Suspense>
  );
}
