"use client";

import { useState, useEffect } from "react";
import styles from "./page.module.css";
import { useUser } from "../components/UserProvider";

interface Order {
  id: string;
  customerName: string;
  platform?: string;
  orderStatus?: string;
  createdAt: string;
}

interface RackDetail {
  rackNo: string;
  weight: number;
  assignmentId: string;
}

export default function Home() {
  const initialForm = {
    customerName: "",
    platform: "",
    crispyPorkPiece: "",
    crispyPorkWeight: "",
    packedPork: "",
    promotion: "",
    price: "",
    shippingMethod: "",
    additionalShippingCost: "",
    additionalFoamBoxCost: "",
    actualReceivedAmount: "",
    transferSlip: "",
    paymentStatus: "",
    customerAddress: "",
    orderStatus: "",
    sellerName: "",
    trackingNumber: "",
  };

  const [formData, setFormData] = useState(initialForm);
  const [rackDetails, setRackDetails] = useState<RackDetail[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [alertData, setAlertData] = useState({
    show: false,
    message: "",
    customerName: "",
  });

  const [filterAdminName, setFilterAdminName] = useState("");

  const { currentUser, users, fetchUsers } = useUser();

  useEffect(() => {
    fetchOrders(filterAdminName);
  }, [filterAdminName]);

  useEffect(() => {
    if (currentUser && currentUser.role !== "SUPER_ADMIN" && !formData.sellerName) {
      setFormData(prev => ({ ...prev, sellerName: currentUser.name }));
    }
  }, [currentUser]);

  useEffect(() => {
    const p = parseFloat(formData.price) || 0;
    const s = parseFloat(formData.additionalShippingCost) || 0;
    const f = parseFloat(formData.additionalFoamBoxCost) || 0;
    
    if (formData.price !== "" || formData.additionalShippingCost !== "" || formData.additionalFoamBoxCost !== "") {
      const total = p + s + f;
      setFormData(prev => ({ ...prev, actualReceivedAmount: total.toString() }));
    }
  }, [formData.price, formData.additionalShippingCost, formData.additionalFoamBoxCost]);

  useEffect(() => {
    if (currentUser?.role !== "SUPER_ADMIN") {
      setFormData(prev => ({ ...prev, crispyPorkPiece: rackDetails.length.toString() }));
    }
  }, [rackDetails, currentUser?.role]);

  const fetchOrders = async (adminName?: string) => {
    try {
      const url = adminName ? `/api/orders?sellerName=${encodeURIComponent(adminName)}` : "/api/orders";
      const res = await fetch(url);
      const data = await res.json();
      if (data.orders) {
        setRecentOrders(data.orders);
      }
    } catch (err) {
      console.error("Failed to fetch orders", err);
    }
  };

  const autoAllocateRacks = (targetWeight: number) => {
    if (!currentUser || !currentUser.racks) return;
    
    // Filter available racks and sort by creation (FIFO)
    const availableRacks = currentUser.racks
      .filter((r: any) => !r.isUsedUp && r.remainingWeight > 0)
      .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    let remainingNeeded = targetWeight;
    const newAllocation: RackDetail[] = [];

    for (const rack of availableRacks) {
      if (remainingNeeded <= 0) break;

      const takeAmount = Math.min(remainingNeeded, rack.remainingWeight);
      newAllocation.push({
        assignmentId: rack.id,
        rackNo: rack.rackNo,
        weight: takeAmount
      });
      remainingNeeded -= takeAmount;
    }

    setRackDetails(newAllocation);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));

    if (name === "crispyPorkWeight") {
      const parsedWeight = parseFloat(value);
      if (!isNaN(parsedWeight) && parsedWeight > 0) {
        autoAllocateRacks(parsedWeight);
      } else {
        setRackDetails([]);
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (data.url) {
        setFormData(prev => ({ ...prev, transferSlip: data.url }));
      } else {
        alert("Upload failed.");
      }
    } catch (err) {
      console.error(err);
      alert("Error uploading file.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddManualRack = () => {
    setRackDetails(prev => [...prev, { assignmentId: "", rackNo: "", weight: 0 }]);
  };

  const handleManualRackChange = (index: number, field: keyof RackDetail, value: string | number) => {
    const updated = [...rackDetails];
    if (field === "assignmentId") {
      const selected = currentUser?.racks?.find((r: any) => r.id === value);
      if (selected) {
        updated[index].assignmentId = selected.id;
        updated[index].rackNo = selected.rackNo;
      }
    } else if (field === "weight") {
      updated[index].weight = Number(value);
    }
    setRackDetails(updated);
  };

  const handleRemoveRack = (index: number) => {
    setRackDetails(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent, bypassDuplicateCheck = false) => {
    e.preventDefault();
    if (!formData.customerName.trim()) return;

    // Validation
    const requestedWeight = parseFloat(formData.crispyPorkWeight);
    if (!isNaN(requestedWeight) && requestedWeight > 0) {
      const allocatedWeight = rackDetails.reduce((sum, r) => sum + r.weight, 0);
      if (allocatedWeight < requestedWeight) {
        const proceed = confirm(`Warning: You requested ${requestedWeight}kg but only allocated ${allocatedWeight}kg from racks.\nDo you want to proceed anyway?`);
        if (!proceed) return;
      }
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          rackDetails: JSON.stringify(rackDetails),
          bypassDuplicateCheck,
        }),
      });

      const data = await res.json();

      if (data.duplicate) {
        setAlertData({
          show: true,
          message: data.message,
          customerName: formData.customerName.trim(),
        });
      } else if (data.success) {
        setFormData(initialForm);
        setRackDetails([]);
        setAlertData({ show: false, message: "", customerName: "" });
        fetchOrders(filterAdminName);
        await fetchUsers(); // Refresh inventory
      } else {
        alert(data.error || "Something went wrong.");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to submit order.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmDuplicate = () => {
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
    handleSubmit(fakeEvent, true);
  };

  const totalAllocated = rackDetails.reduce((sum, r) => sum + r.weight, 0);
  const targetWeight = parseFloat(formData.crispyPorkWeight) || 0;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>New Order Entry</h1>
        <p className={styles.subtitle}>Enter order details and prevent duplicate shipments</p>
      </div>

      <div className={styles.layout}>
        <div className={`${styles.mainContent} glass-panel`}>
          <h2 className={styles.cardTitle}>Order Details</h2>
          <form onSubmit={(e) => handleSubmit(e, false)} className={styles.formGrid}>
            
            {/* Customer Info */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>Customer</h3>
              <div className={styles.formGroup}>
                <label className={styles.label}>Customer Name *</label>
                <input required type="text" name="customerName" value={formData.customerName} onChange={handleChange} className={styles.input} placeholder="ชื่อลูกค้า" />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Platform</label>
                <select name="platform" value={formData.platform} onChange={handleChange} className={styles.input}>
                  <option value="">Select Platform...</option>
                  <option value="Facebook">Facebook</option>
                  <option value="Line">Line</option>
                  <option value="Instagram">Instagram</option>
                  <option value="TikTok">TikTok</option>
                  <option value="Shopee">Shopee</option>
                  <option value="Lazada">Lazada</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Customer Address</label>
                <textarea name="customerAddress" value={formData.customerAddress} onChange={handleChange} className={styles.textarea} placeholder="ที่อยู่ลูกค้า"></textarea>
              </div>
            </div>

            {/* Product Details */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>Products</h3>
              <div className={styles.formGroup}>
                <label className={styles.label}>Crispy Pork (Pieces)</label>
                <input 
                  type="number" 
                  name="crispyPorkPiece" 
                  value={formData.crispyPorkPiece} 
                  onChange={handleChange} 
                  className={styles.input} 
                  placeholder="หมูกรอบ / แผ่น" 
                  min="0" 
                  readOnly={currentUser?.role !== "SUPER_ADMIN"}
                  style={{ opacity: currentUser?.role !== "SUPER_ADMIN" ? 0.7 : 1 }}
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Weight (kg)</label>
                <input type="number" step="0.01" name="crispyPorkWeight" value={formData.crispyPorkWeight} onChange={handleChange} className={styles.input} placeholder="น้ำหนักหมูกรอบ (e.g. 1.5)" />
              </div>
              
              {/* Rack Allocation UI */}
              <div className={styles.formGroup} style={{ gridColumn: '1 / -1', background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <label className={styles.label} style={{ marginBottom: 0 }}>Rack Allocation</label>
                  {currentUser?.role !== "SUPER_ADMIN" && (
                    <span style={{ fontSize: '12px', color: totalAllocated < targetWeight ? '#ff6b6b' : 'var(--accent-green)' }}>
                      Allocated: {totalAllocated} / {targetWeight} kg
                    </span>
                  )}
                </div>
                
                {currentUser?.role === "SUPER_ADMIN" ? (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Super Admin does not require rack allocation.</div>
                ) : (
                  <>
                    {rackDetails.map((rack, index) => (
                      <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 100px auto', gap: '8px', marginBottom: '8px' }}>
                        <select 
                          className={styles.input} 
                          value={rack.assignmentId} 
                          onChange={(e) => handleManualRackChange(index, "assignmentId", e.target.value)}
                        >
                          <option value="">Select Rack...</option>
                          {currentUser?.racks?.filter((r: any) => !r.isUsedUp || r.id === rack.assignmentId).map((r: any) => (
                            <option key={r.id} value={r.id}>
                              {r.rackNo} (avail: {r.remainingWeight}kg)
                            </option>
                          ))}
                        </select>
                        <input 
                          type="number" 
                          step="0.01"
                          className={styles.input} 
                          value={rack.weight || ""} 
                          onChange={(e) => handleManualRackChange(index, "weight", e.target.value)}
                          placeholder="kg"
                        />
                        <button type="button" onClick={() => handleRemoveRack(index)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}>✕</button>
                      </div>
                    ))}
                    <button type="button" onClick={handleAddManualRack} className={styles.button} style={{ marginTop: '8px', padding: '6px 12px', fontSize: '12px', background: 'rgba(255,255,255,0.1)' }}>
                      + Add Rack manually
                    </button>
                  </>
                )}
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Packed Pork</label>
                <input type="text" name="packedPork" value={formData.packedPork} onChange={handleChange} className={styles.input} placeholder="หมูแพ็ค" />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Promotion</label>
                <input type="text" name="promotion" value={formData.promotion} onChange={handleChange} className={styles.input} placeholder="โปรโมชั่น" />
              </div>
            </div>

            {/* Financials */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>Financials</h3>
              <div className={styles.formGroup}>
                <label className={styles.label}>Price</label>
                <input type="number" step="0.01" name="price" value={formData.price} onChange={handleChange} className={styles.input} placeholder="ราคาหมูกรอบ" />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Additional Shipping Cost</label>
                <input type="number" step="0.01" name="additionalShippingCost" value={formData.additionalShippingCost} onChange={handleChange} className={styles.input} placeholder="บวกค่าส่งเพิ่ม" />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Foam Box Cost</label>
                <input type="number" step="0.01" name="additionalFoamBoxCost" value={formData.additionalFoamBoxCost} onChange={handleChange} className={styles.input} placeholder="บวกค่าลังโฟมเพิ่ม" />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Actual Received Amount</label>
                <input type="number" step="0.01" name="actualReceivedAmount" value={formData.actualReceivedAmount} onChange={handleChange} className={styles.input} placeholder="ยอดรับจริง" />
              </div>
            </div>

            {/* Logistics & Tracking */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>Logistics</h3>
              <div className={styles.formGroup}>
                <label className={styles.label}>Shipping Method</label>
                <select name="shippingMethod" value={formData.shippingMethod} onChange={handleChange} className={styles.input}>
                  <option value="">เลือกวิธีการจัดส่ง...</option>
                  <option value="ไปรษณีย์">ไปรษณีย์</option>
                  <option value="มารับเอง">มารับเอง</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Tracking Number</label>
                <input type="text" name="trackingNumber" value={formData.trackingNumber} onChange={handleChange} className={styles.input} placeholder="เลขพัสดุ" />
              </div>
            </div>

            {/* Status & Meta */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>Status</h3>
              <div className={styles.formGroup}>
                <label className={styles.label}>Order Status</label>
                <select name="orderStatus" value={formData.orderStatus} onChange={handleChange} className={styles.input}>
                  <option value="">Select Status...</option>
                  <option value="Pending">Pending</option>
                  <option value="Processing">Processing</option>
                  <option value="Shipped">Shipped</option>
                  <option value="Delivered">Delivered</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Payment Status</label>
                <select name="paymentStatus" value={formData.paymentStatus} onChange={handleChange} className={styles.input}>
                  <option value="">Select Status...</option>
                  <option value="Unpaid">Unpaid</option>
                  <option value="Paid">Paid</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Transfer Slip</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input type="file" accept="image/*" onChange={handleFileUpload} className={styles.input} style={{ padding: '8px' }} disabled={isUploading} />
                  {isUploading && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Uploading...</span>}
                </div>
                {formData.transferSlip && (
                  <div style={{ marginTop: '8px', fontSize: '12px' }}>
                    <a href={formData.transferSlip} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>View Uploaded Slip</a>
                    <button type="button" onClick={() => setFormData(prev => ({ ...prev, transferSlip: "" }))} style={{ marginLeft: '12px', background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}>Remove</button>
                  </div>
                )}
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Seller Name</label>
                <input type="text" name="sellerName" value={formData.sellerName} onChange={handleChange} className={styles.input} placeholder="ชื่อผู้ขาย" />
              </div>
            </div>

            <div className={styles.submitRow}>
              <button type="submit" className={styles.button} disabled={isLoading}>
                {isLoading ? "Saving..." : "Save Order"}
              </button>
            </div>
          </form>
        </div>

        <div className={styles.sideContent}>
          <div className={`${styles.card} glass-panel`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 className={styles.cardTitle} style={{ marginBottom: 0 }}>Recent Entries</h2>
              {currentUser?.role === "SUPER_ADMIN" && (
                <select 
                  className={styles.input} 
                  style={{ width: 'auto', padding: '4px 8px', fontSize: '12px', height: '32px' }}
                  value={filterAdminName}
                  onChange={(e) => setFilterAdminName(e.target.value)}
                >
                  <option value="">All Admins</option>
                  {users.filter(u => u.role !== "SUPER_ADMIN").map(u => (
                    <option key={u.id} value={u.name}>{u.name}</option>
                  ))}
                </select>
              )}
            </div>
            {recentOrders.length === 0 ? (
              <div className={styles.emptyState}>No recent orders.</div>
            ) : (
              <ul className={styles.list}>
                {recentOrders.map((order) => (
                  <li key={order.id} className={styles.listItem} onClick={() => setSelectedOrder(order)} style={{ cursor: 'pointer' }}>
                    <div className={styles.itemInfo}>
                      <span className={styles.itemName}>{order.customerName}</span>
                      <span className={styles.itemProduct}>{order.platform || "No Platform"} - {order.orderStatus || "New"}</span>
                    </div>
                    <span className={styles.itemTime}>
                      {new Date(order.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {alertData.show && (
        <div className={styles.modalOverlay}>
          <div className={styles.alertBox}>
            <div className={styles.alertIcon}>!</div>
            <h3 className={styles.alertTitle}>Duplicate Found</h3>
            <p className={styles.alertText}>{alertData.message}</p>
            <div className={styles.alertActions}>
              <button 
                className={styles.btnCancel} 
                onClick={() => setAlertData({ show: false, message: "", customerName: "" })}
              >
                Cancel
              </button>
              <button 
                className={styles.btnConfirm} 
                onClick={handleConfirmDuplicate}
                disabled={isLoading}
              >
                Proceed Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedOrder && (
        <div className={styles.modalOverlay} onClick={() => setSelectedOrder(null)}>
          <div className={styles.alertBox} style={{ maxWidth: '500px', textAlign: 'left', padding: '24px' }} onClick={e => e.stopPropagation()}>
            <h3 className={styles.alertTitle} style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px', marginBottom: '16px' }}>
              Order Details: {selectedOrder.customerName}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px' }}>
              <div><span style={{ color: 'var(--text-secondary)' }}>Platform:</span> {selectedOrder.platform || '-'}</div>
              <div><span style={{ color: 'var(--text-secondary)' }}>Status:</span> {selectedOrder.orderStatus || '-'}</div>
              <div><span style={{ color: 'var(--text-secondary)' }}>Pieces:</span> {selectedOrder.crispyPorkPiece || '-'}</div>
              <div><span style={{ color: 'var(--text-secondary)' }}>Weight:</span> {selectedOrder.crispyPorkWeight || '-'} kg</div>
              <div><span style={{ color: 'var(--text-secondary)' }}>Price:</span> ฿{selectedOrder.price || '0'}</div>
              <div><span style={{ color: 'var(--text-secondary)' }}>Total Received:</span> ฿{selectedOrder.actualReceivedAmount || '0'}</div>
              <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--text-secondary)' }}>Address:</span> {selectedOrder.customerAddress || '-'}</div>
              <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--text-secondary)' }}>Racks:</span> {
                selectedOrder.rackDetails ? JSON.parse(selectedOrder.rackDetails).map((r: any) => `${r.rackNo} (${r.weight}kg)`).join(', ') : '-'
              }</div>
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Slip: </span> 
                {selectedOrder.transferSlip ? <a href={selectedOrder.transferSlip} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>View Slip</a> : '-'}
              </div>
            </div>
            <div style={{ marginTop: '24px', textAlign: 'right' }}>
              <button className={styles.btnCancel} onClick={() => setSelectedOrder(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
