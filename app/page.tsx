"use client";

import { useState, useEffect, useRef } from "react";
import styles from "./page.module.css";
import { useUser } from "../components/UserProvider";

interface Order {
  id: string;
  orderNo: number;
  customerName: string;
  platform?: string;
  socialMediaName?: string;
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
    socialMediaName: "",
    crispyPorkPiece: "",
    crispyPorkWeight: "",
    packedPork: "",
    promotion: "1 kg 250 บาท",
    price: "",
    shippingMethod: "",
    additionalShippingCost: "",
    isCod: false,
    codAmount: "",
    vatAmount: "",
    actualReceivedAmount: "",
    transferSlip: "",
    paymentStatus: "",
    customerAddress: "",
    orderStatus: "",
    sellerName: "",
    trackingNumber: "",
    adminNote: "",
  };

  const [formData, setFormData] = useState(initialForm);
  const [rackDetails, setRackDetails] = useState<RackDetail[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStorefrontMode, setIsStorefrontMode] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [alertData, setAlertData] = useState({
    show: false,
    message: "",
    customerName: "",
  });

  const [filterAdminName, setFilterAdminName] = useState("");
  const [showInventory, setShowInventory] = useState(false);
  const [insufficientWeight, setInsufficientWeight] = useState(0);
  const [allocationError, setAllocationError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { currentUser, users, fetchUsers } = useUser();

  useEffect(() => {
    if (currentUser) {
      if (currentUser.role === "SUPER_ADMIN") {
        fetchOrders(filterAdminName);
      } else {
        fetchOrders(currentUser.name);
      }
    }
  }, [filterAdminName, currentUser]);

  useEffect(() => {
    if (currentUser && !formData.sellerName) {
      setFormData(prev => ({ ...prev, sellerName: currentUser.name }));
    }
  }, [currentUser]);

  useEffect(() => {
    const p = parseFloat(formData.price) || 0;
    const s = parseFloat(formData.additionalShippingCost) || 0;
    const c = parseFloat(formData.codAmount) || 0;
    
    if (formData.price !== "" || formData.additionalShippingCost !== "" || formData.codAmount !== "") {
      const vat = (p + s) * 0.07;
      const total = p + s + vat + c;
      setFormData(prev => ({ 
        ...prev, 
        vatAmount: vat.toFixed(2),
        actualReceivedAmount: total.toFixed(2) 
      }));
    } else if (formData.vatAmount !== "") {
      setFormData(prev => ({ ...prev, vatAmount: "" }));
    }
  }, [formData.price, formData.additionalShippingCost, formData.codAmount]);

  useEffect(() => {
    setFormData(prev => ({ ...prev, crispyPorkPiece: rackDetails.length.toString() }));
  }, [rackDetails]);

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
    
    // Filter available pieces and sort by creation (FIFO)
    const availableRacks = currentUser.racks
      .filter((r: any) => !r.isUsedUp && r.remainingWeight > 0)
      .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const targetInt = Math.round(targetWeight * 100);
    const racksWithInt = availableRacks.map((r: any) => ({ 
      ...r, 
      intWeight: Math.round(r.remainingWeight * 100) 
    }));

    let bestSubset: any[] | null = null;
    let closestSubset: any[] = [];
    let minDiff = Infinity;
    let closestSum = 0;

    const findSubset = (index: number, currentSubset: any[], currentSum: number) => {
      if (currentSum > 0) {
        const diff = Math.abs(currentSum - targetInt);
        if (diff === 0) {
          bestSubset = [...currentSubset];
          return true;
        }
        if (diff < minDiff) {
          minDiff = diff;
          closestSum = currentSum;
          closestSubset = [...currentSubset];
        }
      }

      if (currentSum > targetInt + 200 || index >= racksWithInt.length) {
        return false;
      }
      
      currentSubset.push(racksWithInt[index]);
      if (findSubset(index + 1, currentSubset, currentSum + racksWithInt[index].intWeight)) {
        return true;
      }
      currentSubset.pop();
      
      if (findSubset(index + 1, currentSubset, currentSum)) {
        return true;
      }
      
      return false;
    };

    findSubset(0, [], 0);

    if (bestSubset) {
      const newAllocation: RackDetail[] = (bestSubset as any[]).map((rack: any) => ({
        assignmentId: rack.id,
        rackNo: rack.rackNo,
        weight: rack.remainingWeight
      }));
      setRackDetails(newAllocation);
    } else {
      const newAllocation: RackDetail[] = (closestSubset as any[]).map((rack: any) => ({
        assignmentId: rack.id,
        rackNo: rack.rackNo,
        weight: rack.remainingWeight
      }));
      setRackDetails(newAllocation);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const target = e.target as HTMLInputElement;
    const name = target.name;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    
    setFormData(prev => {
      const newData = { ...prev, [name]: value };
      
      // Auto-calculate price if promotion is "1 kg 250 บาท"
      if (name === "crispyPorkWeight" || name === "promotion") {
        const promo = name === "promotion" ? value : newData.promotion;
        const weightStr = name === "crispyPorkWeight" ? value : newData.crispyPorkWeight;
        
        if (promo === "1 kg 250 บาท") {
          const parsedWeight = parseFloat(weightStr);
          if (!isNaN(parsedWeight) && parsedWeight > 0) {
            newData.price = (parsedWeight * 250).toFixed(2);
          }
        }
      }
      
      // Auto-calculate COD based on weight and isCod
      if (name === "crispyPorkWeight" || name === "isCod") {
        const weightStr = name === "crispyPorkWeight" ? value : newData.crispyPorkWeight;
        const parsedWeight = parseFloat(weightStr as string);
        const applyCod = name === "isCod" ? value : newData.isCod;
        
        if (applyCod && !isNaN(parsedWeight) && parsedWeight > 0) {
          let cod = 0;
          if (parsedWeight <= 2) {
            cod = 50;
          } else {
            cod = (parsedWeight / 1.5) * 20;
          }
          newData.codAmount = cod.toFixed(2);
        } else if (name === "isCod" && !applyCod) {
          newData.codAmount = "";
        }
      }
      
      // Auto-calculate Shipping Cost for EMS & NIM Express
      if (name === "crispyPorkWeight" || name === "shippingMethod") {
        const weightStr = name === "crispyPorkWeight" ? value : newData.crispyPorkWeight;
        const method = name === "shippingMethod" ? value : newData.shippingMethod;
        const parsedWeight = parseFloat(weightStr as string);
        
        if ((method === "EMS" || method === "NIM Express") && !isNaN(parsedWeight) && parsedWeight > 0) {
          const ratesEms = [
            { w: 2, c: 100 }, { w: 3, c: 110 }, { w: 4, c: 120 }, { w: 5, c: 130 },
            { w: 6, c: 140 }, { w: 7, c: 150 }, { w: 8, c: 160 }, { w: 9, c: 170 },
            { w: 10, c: 180 }, { w: 15, c: 200 }, { w: 20, c: 250 }, { w: 25, c: 300 },
            { w: 30, c: 350 }, { w: 35, c: 400 }, { w: 40, c: 450 }, { w: 45, c: 500 },
            { w: 50, c: 550 }, { w: 75, c: 750 }, { w: 100, c: 1000 }
          ];
          const ratesNim = [
            { w: 2, c: 200 }, { w: 3, c: 220 }, { w: 4, c: 240 }, { w: 5, c: 260 },
            { w: 6, c: 280 }, { w: 7, c: 300 }, { w: 8, c: 320 }, { w: 9, c: 340 },
            { w: 10, c: 360 }, { w: 15, c: 400 }, { w: 20, c: 450 }, { w: 25, c: 500 },
            { w: 30, c: 550 }, { w: 35, c: 600 }, { w: 40, c: 650 }, { w: 45, c: 700 },
            { w: 50, c: 750 }, { w: 75, c: 1000 }, { w: 100, c: 1500 }
          ];
          
          const rates = method === "EMS" ? ratesEms : ratesNim;
          const minCost = rates[0].c;
          const maxCost = rates[rates.length - 1].c;
          
          let shippingCost = 0;
          if (parsedWeight <= 2) {
            shippingCost = minCost;
          } else if (parsedWeight >= 100) {
            shippingCost = maxCost;
          } else {
            for (let i = 0; i < rates.length - 1; i++) {
              if (parsedWeight > rates[i].w && parsedWeight <= rates[i+1].w) {
                const w1 = rates[i].w, c1 = rates[i].c;
                const w2 = rates[i+1].w, c2 = rates[i+1].c;
                const exactCost = c1 + ((parsedWeight - w1) * (c2 - c1) / (w2 - w1));
                // Round to nearest 10 (ends in 0)
                shippingCost = Math.round(exactCost / 10) * 10;
                break;
              }
            }
          }
          
          newData.additionalShippingCost = shippingCost.toFixed(2);
        } else if (name === "shippingMethod" && method !== "EMS" && method !== "NIM Express") {
          newData.additionalShippingCost = "";
        }
      }
      
      return newData;
    });

    if (name === "crispyPorkWeight") {
      const parsedWeight = parseFloat(value);
      if (!isNaN(parsedWeight) && parsedWeight > 0) {
        autoAllocateRacks(parsedWeight);
      } else {
        setRackDetails([]);
        setInsufficientWeight(0);
        setAllocationError("");
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
        updated[index].weight = selected.remainingWeight;
      } else {
        updated[index].assignmentId = "";
        updated[index].rackNo = "";
        updated[index].weight = 0;
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

    setIsLoading(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          orderStatus: isStorefrontMode ? "Completed" : formData.orderStatus,
          adminNote: derivedAdminNote,
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
        if (fileInputRef.current) fileInputRef.current.value = "";
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

  const totalAllocated = Number(rackDetails.reduce((sum, r) => sum + r.weight, 0).toFixed(2));
  const targetWeight = parseFloat(formData.crispyPorkWeight) || 0;
  
  let derivedAdminNote = "";
  let derivedWarning = "";
  if (targetWeight > 0 && rackDetails.length > 0 && totalAllocated !== targetWeight) {
    const diff = Number((targetWeight - totalAllocated).toFixed(2));
    if (diff > 0) {
      derivedAdminNote = `หมูในคลังไม่พอดี ขาดอีก ${diff} kg`;
      derivedWarning = `⚠️ ไม่มีชิ้นส่วนหมูที่บวกกันได้พอดีเป๊ะ (ขาดอีก ${diff} kg) - ระบบจะบันทึกเป็น Comment ติดออเดอร์ไว้ให้ครับ`;
    } else {
      derivedAdminNote = `หมูในคลังไม่พอดี เกินมา ${Math.abs(diff)} kg`;
      derivedWarning = `⚠️ ไม่มีชิ้นส่วนหมูที่บวกกันได้พอดีเป๊ะ (เกินมา ${Math.abs(diff)} kg) - ระบบจะบันทึกเป็น Comment ติดออเดอร์ไว้ให้ครับ`;
    }
  } else if (targetWeight > 0 && rackDetails.length === 0) {
    derivedAdminNote = `หมูในคลังไม่มี ขาดอีก ${targetWeight} kg`;
    derivedWarning = `⚠️ หมูในคลังไม่มีเลย (ขาดอีก ${targetWeight} kg) - ระบบจะบันทึกเป็น Comment ติดออเดอร์ไว้ให้ครับ`;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>New Order Entry</h1>
        <p className={styles.subtitle}>Enter order details and prevent duplicate shipments</p>
      </div>

      <div className={styles.layout}>
        <div className={`${styles.mainContent} glass-panel`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 className={styles.cardTitle} style={{ marginBottom: 0 }}>{isStorefrontMode ? "ขายหน้าร้าน (Storefront Mode)" : "Order Details"}</h2>
            {currentUser?.role === "SUPER_ADMIN" && (
              <button
                type="button"
                onClick={() => {
                  setIsStorefrontMode(!isStorefrontMode);
                  if (!isStorefrontMode) {
                    setFormData(prev => ({
                      ...prev,
                      platform: "Storefront",
                      shippingMethod: "รับหน้าร้าน",
                      paymentStatus: "Paid"
                    }));
                  }
                }}
                style={{
                  background: isStorefrontMode ? 'var(--accent-blue)' : 'rgba(255,255,255,0.05)',
                  color: isStorefrontMode ? '#fff' : 'var(--text-secondary)',
                  border: isStorefrontMode ? 'none' : '1px solid var(--border-color)',
                  padding: '6px 12px',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 'bold',
                }}
              >
                {isStorefrontMode ? '✓ โหมดขายหน้าร้าน' : 'โหมดขายหน้าร้าน'}
              </button>
            )}
          </div>
          <form onSubmit={(e) => handleSubmit(e, false)} className={styles.formGrid}>
            
            {/* Customer Info */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>Customer</h3>
              <div className={styles.formGroup}>
                <label className={styles.label}>Customer Name <span style={{ color: '#ff6b6b' }}>*</span></label>
                
                {isStorefrontMode && (
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input 
                        type="radio" 
                        checked={formData.customerName !== "วางขายหน้าร้าน"}
                        onChange={() => setFormData({ ...formData, customerName: "" })}
                      />
                      ระบุชื่อลูกค้า
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input 
                        type="radio" 
                        checked={formData.customerName === "วางขายหน้าร้าน"}
                        onChange={() => setFormData({ ...formData, customerName: "วางขายหน้าร้าน" })}
                      />
                      วางขายหน้าร้าน
                    </label>
                  </div>
                )}
                
                {(!isStorefrontMode || formData.customerName !== "วางขายหน้าร้าน") && (
                  <input required type="text" name="customerName" value={formData.customerName} onChange={handleChange} className={styles.input} placeholder="ชื่อลูกค้า" />
                )}
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>Platform <span style={{ color: '#ff6b6b' }}>*</span></label>
                <select required={!isStorefrontMode} name="platform" value={formData.platform} onChange={handleChange} className={styles.input}>
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
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>Social Media / Account Name</label>
                <input type="text" name="socialMediaName" value={formData.socialMediaName || ""} onChange={handleChange} className={styles.input} placeholder="ชื่อแอคเคาท์ (เช่น IG: john_doe)" />
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>Customer Address</label>
                <textarea name="customerAddress" value={formData.customerAddress} onChange={handleChange} className={styles.textarea} placeholder="ที่อยู่ลูกค้า"></textarea>
              </div>
            </div>

            {/* Product Details */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>Products</h3>
              <div className={styles.formGroup}>
                <label className={styles.label}>Weight (kg) <span style={{ color: '#ff6b6b' }}>*</span></label>
                <input required type="number" step="0.01" name="crispyPorkWeight" value={formData.crispyPorkWeight} onChange={handleChange} className={styles.input} placeholder="น้ำหนักหมูกรอบ (e.g. 1.5)" />
                {derivedWarning && (
                  <div style={{ color: '#ffac33', fontSize: '12px', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '14px' }}>⚠️</span> {derivedWarning}
                  </div>
                )}
              </div>
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
              
              {/* Rack Allocation UI */}
              <div className={styles.formGroup} style={{ gridColumn: '1 / -1', background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <label className={styles.label} style={{ marginBottom: 0 }}>Piece Allocation</label>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: totalAllocated < targetWeight ? '#ff6b6b' : 'var(--accent-green)' }}>
                      Allocated: {totalAllocated} / {targetWeight} kg
                    </span>
                  </div>
                </div>
                
                <>
                  {rackDetails.map((rack, index) => (
                    <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 100px auto', gap: '8px', marginBottom: '8px' }}>
                      <select 
                        className={styles.input} 
                        value={rack.assignmentId} 
                        onChange={(e) => handleManualRackChange(index, "assignmentId", e.target.value)}
                      >
                        <option value="">Select Piece...</option>
                        {[...(currentUser?.racks || [])]
                          .filter((r: any) => !r.isUsedUp || r.id === rack.assignmentId)
                          .sort((a: any, b: any) => {
                            const matchA = a.rackNo.match(/([A-Z]+)(\d+)-(\d+)/);
                            const matchB = b.rackNo.match(/([A-Z]+)(\d+)-(\d+)/);
                            if (matchA && matchB) {
                              if (matchA[1] !== matchB[1]) return matchA[1].localeCompare(matchB[1]);
                              if (parseInt(matchA[2]) !== parseInt(matchB[2])) return parseInt(matchA[2]) - parseInt(matchB[2]);
                              return parseInt(matchA[3]) - parseInt(matchB[3]);
                            }
                            return a.rackNo.localeCompare(b.rackNo, undefined, { numeric: true });
                          })
                          .map((r: any) => (
                          <option key={r.id} value={r.id}>
                            {r.rackNo} (avail: {parseFloat(Number(r.remainingWeight).toFixed(2))}kg)
                          </option>
                        ))}
                      </select>
                      <input 
                        type="number" 
                        step="0.01"
                        className={styles.input} 
                        value={rack.weight || ""} 
                        readOnly
                        style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}
                        placeholder="kg"
                        title="ห้ามย่อยขาย (Force whole piece)"
                      />
                      <button type="button" onClick={() => handleRemoveRack(index)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}>✕</button>
                    </div>
                  ))}
                  <button type="button" onClick={handleAddManualRack} className={styles.button} style={{ marginTop: '8px', padding: '6px 12px', fontSize: '12px', background: 'rgba(255,255,255,0.1)' }}>
                    + Add Piece manually
                  </button>
                </>
              </div>


              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>Promotion</label>
                <select name="promotion" value={formData.promotion} onChange={handleChange} className={styles.input}>
                  <option value="">ไม่มีโปรโมชั่น (None)</option>
                  <option value="1 kg 250 บาท">1 kg 250 บาท</option>
                </select>
              </div>
            </div>

            {/* Financials */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>Financials</h3>
              <div className={styles.formGroup}>
                <label className={styles.label}>Price <span style={{ color: '#ff6b6b' }}>*</span></label>
                <input required type="number" step="0.01" name="price" value={formData.price} onChange={handleChange} className={styles.input} placeholder="ราคาหมูกรอบ" />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Shipping Method <span style={{ color: '#ff6b6b' }}>*</span></label>
                <select required name="shippingMethod" value={formData.shippingMethod} onChange={handleChange} className={styles.input}>
                  <option value="">เลือกวิธีการจัดส่ง...</option>
                  {!isStorefrontMode && (
                    <>
                      <option value="EMS">EMS</option>
                      <option value="NIM Express">NIM Express</option>
                    </>
                  )}
                  {isStorefrontMode && (
                    <>
                      <option value="รับหน้าร้าน">รับหน้าร้าน</option>
                      <option value="ส่งเอง">ส่งเอง</option>
                    </>
                  )}
                </select>
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>Additional Shipping Cost</label>
                <input type="number" step="0.01" name="additionalShippingCost" value={formData.additionalShippingCost} onChange={handleChange} className={styles.input} placeholder="บวกค่าส่งเพิ่ม" />
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" name="isCod" checked={formData.isCod} onChange={handleChange} style={{ width: '16px', height: '16px' }} />
                  Apply COD
                </label>
                <input type="number" step="0.01" name="codAmount" value={formData.codAmount} readOnly className={styles.input} placeholder="ยอดเก็บปลายทาง (COD)" style={{ opacity: formData.isCod ? 1 : 0.5, background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }} />
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>VAT (7%)</label>
                <input type="number" step="0.01" name="vatAmount" value={formData.vatAmount} readOnly className={styles.input} placeholder="ภาษีมูลค่าเพิ่ม (VAT 7%)" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }} />
              </div>
              <div className={styles.formGroup} style={{ display: isStorefrontMode ? 'none' : 'block' }}>
                <label className={styles.label}>Actual Received Amount</label>
                <input type="number" step="0.01" name="actualReceivedAmount" value={formData.actualReceivedAmount} readOnly className={styles.input} placeholder="ยอดรับจริง" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }} />
              </div>
            </div>

            {/* Status & Meta */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>Status</h3>

              <div className={styles.formGroup}>
                <label className={styles.label}>Payment Status <span style={{ color: '#ff6b6b' }}>*</span></label>
                <select required name="paymentStatus" value={formData.paymentStatus} onChange={handleChange} className={styles.input}>
                  <option value="">Select Status...</option>
                  <option value="Unpaid">Unpaid</option>
                  <option value="Paid">Paid</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Transfer Slip</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input type="file" accept="image/*" onChange={handleFileUpload} ref={fileInputRef} className={styles.input} style={{ padding: '8px' }} disabled={isUploading} />
                  {isUploading && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Uploading...</span>}
                </div>
                {formData.transferSlip && (
                  <div style={{ marginTop: '8px', fontSize: '12px' }}>
                    <a href={formData.transferSlip} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>View Uploaded Slip</a>
                    <button type="button" onClick={() => { setFormData(prev => ({ ...prev, transferSlip: "" })); if (fileInputRef.current) fileInputRef.current.value = ""; }} style={{ marginLeft: '12px', background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}>Remove</button>
                  </div>
                )}
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Seller Name</label>
                <input type="text" name="sellerName" value={formData.sellerName} className={styles.input} placeholder="ชื่อผู้ขาย" readOnly={true} style={{ opacity: 0.7, cursor: 'not-allowed', backgroundColor: 'rgba(255,255,255,0.05)' }} />
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
          {currentUser && (
            <div className={`${styles.card} glass-panel`} style={{ marginBottom: '24px' }}>
              <h2 className={styles.cardTitle} style={{ marginBottom: '16px', fontSize: '1.2rem' }}>📦 My Inventory</h2>
              
              <div style={{ marginBottom: '20px', padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--accent-blue)' }}>
                    {currentUser.racks?.filter(r => !r.isUsedUp).length || 0}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Pieces Left</div>
                </div>
                <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)' }}></div>
                <div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--accent-green)' }}>
                    {currentUser.racks?.reduce((sum, r) => sum + (!r.isUsedUp ? r.remainingWeight : 0), 0).toFixed(2) || '0.00'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Kg Left</div>
                </div>
              </div>
              
              <h3 style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--text-secondary)' }}>Available Pieces:</h3>
              {(!currentUser.racks || currentUser.racks.filter(r => !r.isUsedUp).length === 0) ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>No pieces available.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '350px', overflowY: 'auto', paddingRight: '4px' }}>
                  {(() => {
                    const availableRacks = currentUser.racks.filter(r => !r.isUsedUp);
                    const groupedRacks = availableRacks.reduce((acc: any, curr: any) => {
                      const baseRack = curr.rackNo.split('-')[0];
                      if (!acc[baseRack]) acc[baseRack] = [];
                      acc[baseRack].push(curr);
                      return acc;
                    }, {});

                    const sortedBaseRacks = Object.keys(groupedRacks).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

                    return sortedBaseRacks.map(baseRack => {
                      const pieces = groupedRacks[baseRack];
                      const totalWeight = pieces.reduce((sum: number, p: any) => sum + p.remainingWeight, 0);
                      return (
                        <div key={baseRack} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                          <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <span style={{ fontWeight: 'bold', color: 'var(--accent-blue)', fontSize: '15px' }}>ถาด {baseRack}</span>
                            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{pieces.length} ชิ้น</span>
                          </div>
                          <div style={{ padding: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {[...pieces].sort((a: any, b: any) => (a.rackNo || '').localeCompare((b.rackNo || ''), undefined, { numeric: true })).map((p: any, idx: number) => (
                              <div key={p.rackNo || idx} style={{ background: 'rgba(255,255,255,0.1)', padding: '6px 12px', borderRadius: '4px', fontSize: '13px', display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                                <span style={{ color: '#ddd' }}>{p.rackNo?.includes('-') ? `ชิ้น ${p.rackNo.split('-')[1]}` : (p.rackNo || 'Unknown')}</span>
                                <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>{p.remainingWeight} kg</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          )}

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
                    <option key={u.id} value={u.name}>
                      {u.name} (เหลือ {u.racks?.reduce((sum, r) => sum + (!r.isUsedUp ? r.remainingWeight : 0), 0).toFixed(2) || '0.00'} kg)
                    </option>
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
                      <span className={styles.itemName}>#{order.orderNo || "?"} - {order.customerName}</span>
                      <span className={styles.itemProduct}>
                        {order.platform || "No Platform"} 
                        {order.adminNote && <span style={{ color: '#ffac33', marginLeft: '8px' }} title={order.adminNote}>⚠️ Note</span>}
                      </span>
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
              <div><span style={{ color: 'var(--text-secondary)' }}>Customer:</span> {selectedOrder.customerName}</div>
              <div><span style={{ color: 'var(--text-secondary)' }}>Platform:</span> {selectedOrder.platform || '-'}</div>
              <div><span style={{ color: 'var(--text-secondary)' }}>Account Name:</span> {selectedOrder.socialMediaName || '-'}</div>
              <div><span style={{ color: 'var(--text-secondary)' }}>Status:</span> {selectedOrder.orderStatus || '-'}</div>
              <div><span style={{ color: 'var(--text-secondary)' }}>Pieces:</span> {selectedOrder.crispyPorkPiece || '-'}</div>
              <div><span style={{ color: 'var(--text-secondary)' }}>Weight:</span> {selectedOrder.crispyPorkWeight || '-'} kg</div>
              <div><span style={{ color: 'var(--text-secondary)' }}>Price:</span> ฿{selectedOrder.price || '0'}</div>
              <div><span style={{ color: 'var(--text-secondary)' }}>COD:</span> ฿{selectedOrder.codAmount || '0'}</div>
              <div><span style={{ color: 'var(--text-secondary)' }}>Total Received:</span> ฿{selectedOrder.actualReceivedAmount || '0'}</div>
              <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--text-secondary)' }}>Address:</span> {selectedOrder.customerAddress || '-'}</div>
              <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--text-secondary)' }}>Pieces:</span> {
                (() => {
                  if (!selectedOrder.rackDetails) return '-';
                  try {
                    return JSON.parse(selectedOrder.rackDetails).map((r: any) => `${r.rackNo} (${r.weight}kg)`).join(', ');
                  } catch (e) {
                    return selectedOrder.rackDetails; // Fallback to raw string
                  }
                })()
              }</div>
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Slip: </span> 
                {selectedOrder.transferSlip ? <a href={selectedOrder.transferSlip} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>View Slip</a> : '-'}
              </div>
              {selectedOrder.adminNote && (
                <div style={{ gridColumn: '1 / -1', background: 'rgba(255,172,51,0.1)', border: '1px solid #ffac33', padding: '8px', borderRadius: '4px', color: '#ffac33' }}>
                  <span style={{ fontWeight: 'bold' }}>⚠️ Admin Note:</span> {selectedOrder.adminNote}
                </div>
              )}
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
