"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { BASE_PATH } from "../../../lib/basePath";
import { groupOrdersForPrint, getShippingLabel, getRackDisplay, extractShortageNote, AdminGroup as AdminGroupType, PrintableOrder } from "../../../lib/porkSlip";
import { previousDayStr } from "../../../lib/packingCutoff";

interface Order extends PrintableOrder {
  id: string;
  customerName: string;
  customerAddress?: string;
  rackDetails: string;
  orderStatus: string;
  paymentStatus?: string;
  adminNote?: string;
}

type AdminGroup = AdminGroupType<Order>;

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

  const fetchOrders = async (date: string) => {
    try {
      // `date` is "the day Packing is working" (same meaning as selectedDate
      // on /packing) — the orders themselves were entered under the day
      // before that, so filter by that entryDate, matching what the Packing
      // list page shows for the same `date` value.
      const orderDate = previousDayStr(date);
      const [ordersRes, usersRes] = await Promise.all([
        fetch(`${BASE_PATH}/api/orders?entryDate=${orderDate}`),
        fetch(`${BASE_PATH}/api/users`),
      ]);
      const ordersData = await ordersRes.json();
      const usersData = await usersRes.json();

      const nicknameByName: Record<string, string> = {};
      (usersData.users || []).forEach((u: any) => {
        if (u.nickname) nicknameByName[u.name] = u.nickname;
      });

      if (ordersData.orders) {
        setAdminGroups(groupOrdersForPrint<Order>(ordersData.orders, nicknameByName));
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
                    <td style={{
                      border: '1px solid #000', padding: '10px', fontSize: '18px',
                      ...(order.shippingMethod === 'NIM Express' ? { backgroundColor: '#cfe8ff', color: '#004a99', fontWeight: 'bold' } : {}),
                    }}>
                      {getShippingLabel(order)}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px', fontSize: '18px' }}>
                      {rackData.detailsArray?.map((line, idx) => (
                        <div key={idx}>{line}</div>
                      ))}
                      {extractShortageNote(order.adminNote) && (
                        <div style={{ fontSize: '14px', color: '#a00', marginTop: '4px' }}>{extractShortageNote(order.adminNote)}</div>
                      )}
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
