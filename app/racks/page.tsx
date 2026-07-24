"use client";

import { useState } from "react";
import { useUser } from "../../components/UserProvider";
import styles from "../page.module.css";

interface DraftRack {
  rackNo: string;
  weight: number;
}

export default function RacksPage() {
  const { currentUser, users, fetchUsers } = useUser();
  const [selectedUserId, setSelectedUserId] = useState("");
  
  // Batch generation state
  const [prefix, setPrefix] = useState("Rack-");
  const [startNum, setStartNum] = useState<number>(1);
  const [endNum, setEndNum] = useState<number>(5);
  const [defaultWeight, setDefaultWeight] = useState<number>(0);
  
  const [draftRacks, setDraftRacks] = useState<DraftRack[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  if (!currentUser) return null;
  if (currentUser.role !== "SUPER_ADMIN") {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Access Denied</h1>
          <p className={styles.subtitle}>Only Super Admins can access this page.</p>
        </div>
      </div>
    );
  }

  const handleGenerate = () => {
    const newRacks: DraftRack[] = [];
    for (let i = startNum; i <= endNum; i++) {
      newRacks.push({
        rackNo: `${prefix}${i}`,
        weight: defaultWeight
      });
    }
    setDraftRacks(newRacks);
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
    setDraftRacks(draftRacks.filter((_, i) => i !== index));
  };

  const handleAssignBatch = async () => {
    if (!selectedUserId || draftRacks.length === 0) return;

    setIsLoading(true);
    try {
      const res = await fetch("/api/users/racks/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId, racks: draftRacks }),
      });
      if (res.ok) {
        setDraftRacks([]);
        await fetchUsers(); // Refresh the users list and racks
        alert("Batch assignment successful!");
      } else {
        const err = await res.json();
        alert(err.error || "Failed to assign racks");
      }
    } catch (err) {
      console.error(err);
      alert("Error assigning racks");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevoke = async (assignmentId: string) => {
    if (!confirm("Are you sure you want to revoke this rack?")) return;
    
    try {
      const res = await fetch(`/api/users/racks?id=${assignmentId}`, { method: "DELETE" });
      if (res.ok) {
        await fetchUsers();
      }
    } catch (err) {
      console.error(err);
      alert("Error revoking rack");
    }
  };

  const selectedUser = users.find(u => u.id === selectedUserId);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Rack Management</h1>
        <p className={styles.subtitle}>Batch Assign Racks & Inventory</p>
      </div>

      <div className={styles.layout}>
        <div className={`${styles.mainContent} glass-panel`}>
          <h2 className={styles.cardTitle}>Batch Assign Racks</h2>
          
          <div className={styles.formSection} style={{ gridTemplateColumns: '1fr', marginBottom: 20 }}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Select Admin</label>
              <select 
                className={styles.input} 
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                required
              >
                <option value="">-- Select an Admin --</option>
                {users.filter(u => u.role !== "SUPER_ADMIN").map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
            </div>
          </div>

          {selectedUserId && (
            <>
              <div style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', marginBottom: '20px' }}>
                <h3 style={{ fontSize: '14px', marginBottom: '12px' }}>Generate Rack Sequence</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '12px', alignItems: 'end' }}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Start #</label>
                    <input type="number" className={styles.input} value={startNum} onChange={e => setStartNum(Number(e.target.value))} />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>End #</label>
                    <input type="number" className={styles.input} value={endNum} onChange={e => setEndNum(Number(e.target.value))} />
                  </div>
                  <button onClick={handleGenerate} className={styles.button} style={{ height: '42px' }}>Generate</button>
                </div>
              </div>

              {draftRacks.length > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ fontSize: '14px' }}>Generated Racks ({draftRacks.length})</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Set all weights to:</span>
                      <input 
                        type="number" 
                        className={styles.input} 
                        style={{ width: '80px', padding: '4px 8px' }} 
                        value={defaultWeight}
                        onChange={e => {
                          const w = Number(e.target.value);
                          setDefaultWeight(w);
                          setDraftRacks(draftRacks.map(r => ({ ...r, weight: w })));
                        }} 
                      />
                    </div>
                  </div>

                  <div style={{ maxHeight: '300px', overflowY: 'auto', paddingRight: '8px', marginBottom: '16px' }}>
                    {draftRacks.map((rack, idx) => (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '12px', marginBottom: '8px', alignItems: 'center' }}>
                        <input 
                          type="text" 
                          className={styles.input} 
                          value={rack.rackNo} 
                          onChange={e => handleDraftNameChange(idx, e.target.value)} 
                        />
                        <div style={{ position: 'relative' }}>
                          <input 
                            type="number" 
                            className={styles.input} 
                            value={rack.weight} 
                            onChange={e => handleDraftWeightChange(idx, Number(e.target.value))} 
                          />
                          <span style={{ position: 'absolute', right: '12px', top: '10px', color: '#666', fontSize: '12px' }}>kg</span>
                        </div>
                        <button onClick={() => handleRemoveDraft(idx)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}>✕</button>
                      </div>
                    ))}
                  </div>

                  <button 
                    onClick={handleAssignBatch} 
                    className={styles.button} 
                    disabled={isLoading}
                    style={{ width: '100%' }}
                  >
                    {isLoading ? "Assigning..." : `Assign ${draftRacks.length} Racks to ${selectedUser?.name}`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className={`${styles.sideContent} glass-panel`}>
          <h2 className={styles.cardTitle}>Current Assignments</h2>
          {selectedUser ? (
            <div>
              <h3 style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>{selectedUser.name}'s Racks</h3>
              {selectedUser.racks.length === 0 ? (
                <div className={styles.emptyState}>No racks assigned.</div>
              ) : (
                <ul className={styles.list}>
                  {selectedUser.racks.map(rack => (
                    <li key={rack.id} className={styles.listItem} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: rack.isUsedUp ? 0.5 : 1 }}>
                      <div>
                        <div className={styles.itemName} style={{ textDecoration: rack.isUsedUp ? 'line-through' : 'none' }}>
                          {rack.rackNo}
                        </div>
                        <div style={{ fontSize: '12px', color: rack.remainingWeight === 0 ? '#ff6b6b' : 'var(--accent-green)' }}>
                          {Number(rack.remainingWeight).toFixed(2)} kg remaining
                        </div>
                      </div>
                      <button 
                        onClick={() => handleRevoke(rack.id)}
                        style={{ background: 'rgba(255,0,0,0.2)', border: 'none', color: '#ff6b6b', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', alignSelf: 'flex-start' }}
                      >
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className={styles.emptyState}>Select an admin to view their racks.</div>
          )}
        </div>
      </div>
    </div>
  );
}
