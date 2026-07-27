"use client";

import { useState, useEffect } from "react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { useUser } from "../../components/UserProvider";

interface Order {
  id: string;
  orderNo: number;
  customerName: string;
  customerAddress: string;
  shippingMethod: string;
  isCod: boolean;
  codAmount: number;
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

export default function StorefrontPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState("Completed");
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [viewingRacks, setViewingRacks] = useState<Order | null>(null);
  const { currentUser } = useUser();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/orders");
      const data = await res.json();
      if (res.ok) {
        setOrders(data.orders);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const updateOrderStatus = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderStatus: newStatus })
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
      const res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingNumber: tracking })
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
      const res = await fetch(`/api/orders/${editingOrder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: editingOrder.customerName,
          customerAddress: editingOrder.customerAddress,
          codAmount: editingOrder.codAmount,
          crispyPorkPiece: editingOrder.crispyPorkPiece,
          crispyPorkWeight: editingOrder.crispyPorkWeight,
          adminNote: editingOrder.adminNote
        })
      });
      
      if (res.ok) {
        setOrders(orders.map(o => o.id === editingOrder.id ? editingOrder : o));
        setEditingOrder(null);
      } else {
        alert("Failed to update order");
      }
    } catch (error) {
      console.error(error);
      alert("Error updating order");
    }
  };

  const generateExportData = () => {
    const exportOrders = orders.filter(o => !filterStatus || filterStatus === "All" || o.orderStatus === filterStatus || (!o.orderStatus && filterStatus === "Pending"));
    if (exportOrders.length === 0) return null;

    return exportOrders.map(order => {
      let phone = "";
      let zip = "";
      let address = order.customerAddress || "";

      // Smart extraction for Phone
      // Matches 10 digits starting with 0, allowing spaces or dashes in between
      const phoneMatch = address.match(/(0[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d)/);
      if (phoneMatch) {
        phone = phoneMatch[0].replace(/[\s\-]/g, ""); // Keep only digits
        address = address.replace(phoneMatch[0], "").trim();
      }

      // Smart extraction for Zip code
      const zipMatch = address.match(/(\d{5})/);
      if (zipMatch) {
        zip = zipMatch[0];
        address = address.replace(zipMatch[0], "").trim();
      }

      // Remove "ที่อยู่ :" or similar prefixes at the start
      address = address.replace(/^ที่อยู่\s*:\s*/, "").replace(/^ที่อยู่\s*/, "");
      
      // Remove "เบอร์โทร :" or similar text anywhere
      address = address.replace(/เบอร์โทร\s*:\s*/g, "")
                       .replace(/เบอร์โทร\s*/g, "")
                       .replace(/เบอร์\s*:\s*/g, "")
                       .replace(/เบอร์\s*/g, "")
                       .replace(/โทร\s*:\s*/g, "")
                       .replace(/โทร\s*/g, "");
      
      // Clean up stray characters at the end (like trailing colons or dashes)
      address = address.replace(/[\s:,.-]+$/, "").trim();

      let cleanNote = order.adminNote || "";
      cleanNote = cleanNote.replace(/หมูในคลังไม่พอดี ขาดอีก \d+(\.\d+)? kg/g, "").trim();
      cleanNote = cleanNote.replace(/หมูในคลังไม่พอดี เกินมา \d+(\.\d+)? kg/g, "").trim();
      cleanNote = cleanNote.replace(/^- /, "").trim();

      const note = `ชิ้น: ${order.crispyPorkPiece || '-'} น้ำหนัก: ${order.crispyPorkWeight || '-'}kg ${cleanNote ? `(${cleanNote})` : ''}`;

      return [
        "", "", "", "", "E", "", "",
        order.codAmount || "", note,
        order.customerName, phone, address, zip
      ];
    });
  };

  const handlePreview = () => {
    const data = generateExportData();
    if (!data) {
      alert("No orders to preview!");
      return;
    }
    setPreviewData(data);
    setShowPreview(true);
  };

  const handleExportPostone = async () => {
    const dataRows = generateExportData();
    if (!dataRows) {
      alert("No orders to export!");
      return;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Sheet1');

      // Add Headers Row 1
      worksheet.getRow(1).values = [
        "รายละเอียดผู้ฝากส่ง", "", "", "",
        "รายละเอียดการจัดส่ง", "", "", "", "",
        "รายละเอียดผู้รับปลายทาง", "", "", ""
      ];

      // Add Headers Row 2
      worksheet.getRow(2).values = [
        "ชื่อ-สกุล", "เบอร์โทร", "ที่อยู่", "รหัสไปรษณีย์",
        "บริการ", "Barcode", "COD Account", "COD", "รายการสินค้า/หมายเหตุ",
        "ชื่อ-สกุล", "เบอร์โทร", "ที่อยู่", "รหัสไปรษณีย์"
      ];

      // Merge cells for Row 1
      worksheet.mergeCells('A1:D1');
      worksheet.mergeCells('E1:I1');
      worksheet.mergeCells('J1:M1');

      // Style Row 1
      const titleFont = { bold: true };
      const centerAlign: Partial<ExcelJS.Alignment> = { vertical: 'middle', horizontal: 'center' };
      const borderStyle: Partial<ExcelJS.Borders> = { 
        top: { style: 'thin' }, left: { style: 'thin' }, 
        bottom: { style: 'thin' }, right: { style: 'thin' } 
      };

      const styleHeaderCell = (cellName: string, argbColor: string) => {
        const cell = worksheet.getCell(cellName);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argbColor } };
        cell.font = titleFont;
        cell.alignment = centerAlign;
        cell.border = borderStyle;
      };

      styleHeaderCell('A1', 'FF92CDDC'); // Light Blue
      styleHeaderCell('E1', 'FF92D050'); // Light Green
      styleHeaderCell('J1', 'FFFABF8F'); // Light Orange

      // Style Row 2
      const row2 = worksheet.getRow(2);
      row2.eachCell((cell, colNumber) => {
        if (colNumber <= 13) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEEF3' } };
          cell.border = borderStyle;
        }
      });

      // Add Data Rows
      dataRows.forEach(row => {
        const newRow = worksheet.addRow(row);
        // Optional: add borders to data cells
        newRow.eachCell((cell, colNumber) => {
          if (colNumber <= 13) cell.border = borderStyle;
        });
      });

      // Set column widths roughly based on content
      worksheet.columns = [
        { width: 20 }, { width: 15 }, { width: 40 }, { width: 12 }, // Sender
        { width: 10 }, { width: 15 }, { width: 15 }, { width: 10 }, { width: 30 }, // Delivery
        { width: 20 }, { width: 15 }, { width: 40 }, { width: 12 } // Recipient
      ];

      // Add Instructions Box to the right (O2 to Q10)
      worksheet.mergeCells('O2:Q2');
      const insTitle = worksheet.getCell('O2');
      insTitle.value = 'คำแนะนำการใช้งาน';
      insTitle.alignment = centerAlign;
      insTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEEF3' } };
      insTitle.border = borderStyle;

      const insData = [
        ['กรณีผู้ฝากส่งเป็นคนเดียวกันให้กรอกเพียง 1 roll เท่านั้น'],
        ['ทั้งนี้หากไม่กรอกระบบจะใช้ที่อยู่เริ่มต้นของร้าน'],
        [],
        ['ช่อง "บริการ" ให้กรอกตัวอักษรย่อ 1 ตัวดังนี้'],
        ['E = EMS'],
        ['O = eCo-Post'],
        ['R = ลงทะเบียน'],
        ['P = พัสดุไปรษณีย์ธรรมดา'],
        ['T = ขนส่งโดยร้านค้า']
      ];

      insData.forEach((row, i) => {
        const rIndex = i + 3;
        worksheet.mergeCells(`O${rIndex}:Q${rIndex}`);
        const c = worksheet.getCell(`O${rIndex}`);
        c.value = row[0] || "";
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4F8' } }; // Lighter cyan
      });

      // Export
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, `Postone_Export_${new Date().toISOString().split('T')[0]}.xlsx`);

    } catch (error) {
      console.error("Error exporting excel:", error);
      alert("Failed to export Excel.");
    }
  };

  if (!isMounted) return null;

  if (!currentUser || currentUser.role !== "SUPER_ADMIN") {
    return (
      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', color: '#fff' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold' }}>Access Denied</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Only Super Admins can access this page.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Storefront Orders</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0 0', fontSize: '14px' }}>View storefront and completed orders</p>
        </div>
        
        <div style={{ display: 'flex', gap: '16px' }}>


          <button 
            onClick={handlePreview}
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            👀 Preview
          </button>

          <button 
            onClick={handleExportPostone}
            style={{ background: 'var(--accent-green)', border: 'none', color: '#000', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            📊 Export to Postone
          </button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>Loading...</div>
      ) : (
        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'rgba(255,255,255,0.05)', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
              <tr>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>Customer</th>
                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>Items</th>

                <th style={{ padding: '16px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.filter(o => !filterStatus || filterStatus === "All" || o.orderStatus === filterStatus || (!o.orderStatus && filterStatus === "Pending")).map(order => (
                <tr key={order.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '16px', verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 'bold' }}>{order.customerName}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', maxWidth: '250px' }}>{order.customerAddress}</div>
                  </td>
                  <td style={{ padding: '16px', verticalAlign: 'top' }}>
                    <div>{order.crispyPorkPiece ? `${order.crispyPorkPiece} pcs` : '-'} / {order.crispyPorkWeight ? `${order.crispyPorkWeight} kg` : '-'}</div>
                    <div style={{ fontSize: '12px', marginTop: '6px', color: '#a0a0a0', background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px', display: 'inline-block' }}>
                      Pork: ฿{order.price || 0} | Ship: ฿{order.additionalShippingCost || 0} | COD: {order.codAmount > 0 ? `฿${order.codAmount}` : '-'} | <strong style={{ color: 'white' }}>Total: ฿{
                        (() => {
                          const p = Number(order.price) || 0;
                          const s = Number(order.additionalShippingCost) || 0;
                          const c = Number(order.codAmount) || 0;
                          const calculatedTotal = (p + s) * 1.07 + c;
                          
                          const actual = Number(order.actualReceivedAmount) || 0;
                          if (actual > 0 && actual >= (p + s) * 0.5) {
                            return actual;
                          }
                          return Number(calculatedTotal.toFixed(2));
                        })()
                      }</strong>
                    </div>
                    {order.adminNote && <div style={{ fontSize: '12px', color: '#ffac33', marginTop: '4px' }}>Note: {order.adminNote}</div>}
                    {order.sellerName && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>By: {order.sellerName}</div>}
                  </td>

                  <td style={{ padding: '16px', verticalAlign: 'top' }}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button 
                        onClick={() => setViewingRacks(order)}
                        style={{ background: 'rgba(79,172,254,0.2)', color: '#4facfe', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                      >
                        👁️ Racks
                      </button>
                      <button 
                        onClick={() => setEditingOrder({ ...order })}
                        style={{ background: 'rgba(255,172,51,0.2)', color: '#ffac33', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                      >
                        ✏️ Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {orders.filter(o => !filterStatus || filterStatus === "All" || o.orderStatus === filterStatus || (!o.orderStatus && filterStatus === "Pending")).length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    No orders found.
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
              <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>Excel Data Preview</h2>
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
              <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>Edit Order Details</h2>
              <button onClick={() => setEditingOrder(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px' }}>✕</button>
            </div>
            
            <form onSubmit={handleSaveEdit} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>Customer Name</label>
                <input type="text" value={editingOrder.customerName} onChange={e => setEditingOrder({...editingOrder, customerName: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', background: '#0a0a0a', color: 'white' }} required />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>Customer Address (Phone & Zip included)</label>
                <textarea value={editingOrder.customerAddress} onChange={e => setEditingOrder({...editingOrder, customerAddress: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', background: '#0a0a0a', color: 'white', minHeight: '80px' }} required />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>Pork Pieces (pcs)</label>
                  <input type="text" value={editingOrder.crispyPorkPiece || ''} onChange={e => setEditingOrder({...editingOrder, crispyPorkPiece: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', background: '#0a0a0a', color: 'white' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>Pork Weight (kg)</label>
                  <input type="text" value={editingOrder.crispyPorkWeight || ''} onChange={e => setEditingOrder({...editingOrder, crispyPorkWeight: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', background: '#0a0a0a', color: 'white' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>COD Amount (฿)</label>
                  <input type="number" value={editingOrder.codAmount || 0} onChange={e => setEditingOrder({...editingOrder, codAmount: Number(e.target.value)})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', background: '#0a0a0a', color: 'white' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>Admin Note</label>
                  <input type="text" value={editingOrder.adminNote || ''} onChange={e => setEditingOrder({...editingOrder, adminNote: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', background: '#0a0a0a', color: 'white' }} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                <button type="button" onClick={() => setEditingOrder(null)} style={{ padding: '12px 24px', borderRadius: '8px', border: '1px solid #333', background: 'transparent', color: 'white', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" style={{ padding: '12px 24px', borderRadius: '8px', border: 'none', background: 'var(--accent-green)', color: 'black', fontWeight: 'bold', cursor: 'pointer' }}>Save Changes</button>
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
              <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>Racks Used</h2>
              <button onClick={() => setViewingRacks(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px' }}>✕</button>
            </div>
            
            <div style={{ padding: '24px' }}>
              {(() => {
                if (!viewingRacks.rackDetails) return <div style={{ color: 'var(--text-secondary)' }}>No rack details found.</div>;
                try {
                  const racks = JSON.parse(viewingRacks.rackDetails);
                  if (!Array.isArray(racks) || racks.length === 0) return <div style={{ color: 'var(--text-secondary)' }}>No rack details found.</div>;
                  
                  const aggregatedRacks = racks.reduce((acc: Record<string, string[]>, curr: any) => {
                    const baseRackNo = (curr.rackNo || 'Unknown Rack').split('-')[0];
                    if (!acc[baseRackNo]) acc[baseRackNo] = [];
                    acc[baseRackNo].push(`${Number(curr.weight).toFixed(2)} kg`);
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
              <button onClick={() => setViewingRacks(null)} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.1)', color: 'white', cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
