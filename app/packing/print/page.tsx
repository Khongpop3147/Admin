"use client";

import { useEffect, useState, Suspense } from "react";
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
  paymentStatus?: string;
  sellerName?: string;
}

interface AdminGroup {
  sellerName: string;
  displayName: string;
  orders: Order[];
}

function PrintSlipContent() {
  const searchParams = useSearchParams();
  const dateStr = searchParams.get("date");
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (dateStr) {
      fetchOrders(dateStr);
    } else {
      setIsLoading(false);
    }
  }, [dateStr]);

  // Report grouping order within each admin's own section: NIM -ปลายทาง,
  // NIM -ส่งฟรี, EMS -ปลายทาง, EMS -ส่งฟรี — COD comes first within each
  // shipping method.
  const getShippingRank = (order: Order) => {
    const method = order.shippingMethod || "";
    const hasCod = !!order.codAmount;
    if (method === "NIM Express" && hasCod) return 0;
    if (method === "NIM Express") return 1;
    if (method === "EMS" && hasCod) return 2;
    if (method === "EMS") return 3;
    return 4;
  };

  const fetchOrders = async (date: string) => {
    try {
      const [ordersRes, usersRes] = await Promise.all([
        fetch(`/api/orders?date=${date}`),
        fetch(`/api/users`),
      ]);
      const ordersData = await ordersRes.json();
      const usersData = await usersRes.json();

      const nicknameByName: Record<string, string> = {};
      (usersData.users || []).forEach((u: any) => {
        if (u.nickname) nicknameByName[u.name] = u.nickname;
      });

      if (ordersData.orders) {
        // Filter out storefront (walk-in) orders — by platform AND by shipping
        // method, so a storefront-style order never sneaks into the report even
        // if its platform field wasn't tagged "Storefront".
        const filtered = ordersData.orders.filter((o: Order) =>
          o.platform !== 'Storefront' &&
          o.shippingMethod !== 'รับหน้าร้าน' &&
          o.shippingMethod !== 'ส่งเอง'
        );

        const bySeller: Record<string, Order[]> = {};
        filtered.forEach((o: Order) => {
          const key = o.sellerName || "ไม่ระบุแอดมิน";
          if (!bySeller[key]) bySeller[key] = [];
          bySeller[key].push(o);
        });

        const groups: AdminGroup[] = Object.entries(bySeller).map(([sellerName, groupOrders]) => {
          groupOrders.sort((a, b) => {
            const rankDiff = getShippingRank(a) - getShippingRank(b);
            if (rankDiff !== 0) return rankDiff;
            return (a.orderNo || 0) - (b.orderNo || 0);
          });
          return {
            sellerName,
            displayName: nicknameByName[sellerName] || sellerName,
            orders: groupOrders,
          };
        });

        groups.sort((a, b) => a.displayName.localeCompare(b.displayName, "th"));

        setAdminGroups(groups);
      }
    } catch (error) {
      console.error("Failed to fetch orders for print", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoading && adminGroups.length > 0) {
      // Small delay to allow images/fonts to load before printing
      setTimeout(() => {
        window.print();
      }, 500);
    }
  }, [isLoading, adminGroups]);

  const getRackDisplay = (rackDetailsStr: string) => {
    if (!rackDetailsStr || rackDetailsStr === '[]') return { details: "-", totalWeight: 0, pieceCount: 0 };
    try {
      const racks = JSON.parse(rackDetailsStr);
      const groups: Record<string, number[]> = {};
      let totalWeight = 0;
      let pieceCount = 0;

      racks.forEach((r: any) => {
        if (!r.rackNo) return;
        pieceCount += 1;
        const base = r.rackNo.split('-')[0];
        if (!groups[base]) groups[base] = [];
        const w = parseFloat(r.weight) || 0;
        groups[base].push(w);
        totalWeight += w;
      });

      const detailsArray = Object.entries(groups).map(([base, weights]) => {
        return `${base} = ${weights.join(' / ')} kg`;
      });

      return { detailsArray, totalWeight, pieceCount };
    } catch(e) {
      return { detailsArray: ["-"], totalWeight: 0, pieceCount: 0 };
    }
  };

  // Every order ships either COD or prepaid — there's no bare "NIM Express"/
  // "EMS" label, always one of these two suffixes, for either method.
  const getShippingLabel = (order: Order) => {
    const method = order.shippingMethod || "-";
    return order.codAmount ? `${method} -ปลายทาง` : `${method} -ส่งฟรี`;
  };

  if (isLoading) return <div style={{ padding: 20 }}>Loading...</div>;
  if (!dateStr) return <div style={{ padding: 20 }}>No date specified.</div>;
  if (adminGroups.length === 0) return <div style={{ padding: 20 }}>No orders found for this date.</div>;

  return (
    <div style={{ padding: '20px', backgroundColor: '#fff', color: '#000', fontFamily: 'sans-serif' }}>
      {adminGroups.map((group, groupIdx) => (
        <div key={group.sellerName} className={groupIdx > 0 ? "admin-section-break" : undefined}>
          <h1 style={{ textAlign: 'center', marginBottom: '4px', fontSize: '24px', fontWeight: 'bold', color: '#000' }}>
            ใบเบิกหมูประจำวันที่ {dateStr}
          </h1>
          <h2 style={{ textAlign: 'center', marginBottom: '4px', fontSize: '18px', fontWeight: 'bold', color: '#333' }}>
            แอดมิน: {group.displayName}
          </h2>
          <div style={{ textAlign: 'center', marginBottom: '20px', fontSize: '13px', color: '#666' }}>
            หน้า {groupIdx + 1} จาก {adminGroups.length}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #000', padding: '10px', textAlign: 'left', width: '6%' }}>Order #</th>
                <th style={{ border: '1px solid #000', padding: '10px', textAlign: 'left', width: '26%' }}>ชื่อลูกค้า / ที่อยู่</th>
                <th style={{ border: '1px solid #000', padding: '10px', textAlign: 'left', width: '17%' }}>วิธีจัดส่ง</th>
                <th style={{ border: '1px solid #000', padding: '10px', textAlign: 'left', width: '24%' }}>รหัสถาด (Rack)</th>
                <th style={{ border: '1px solid #000', padding: '10px', textAlign: 'center', width: '10%' }}>จำนวนแผ่น</th>
                <th style={{ border: '1px solid #000', padding: '10px', textAlign: 'center', width: '17%' }}>น้ำหนักรวม</th>
              </tr>
            </thead>
            <tbody>
              {group.orders.map((order) => {
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
                      {getShippingLabel(order)}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px', fontSize: '18px' }}>
                      {rackData.detailsArray?.map((line, idx) => (
                        <div key={idx}>{line}</div>
                      ))}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px', textAlign: 'center', fontSize: '18px', fontWeight: 'bold' }}>
                      {rackData.pieceCount > 0 ? rackData.pieceCount : "-"}
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
      ))}

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
          .admin-section-break { break-before: page; page-break-before: always; }
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
