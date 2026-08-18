"use client";

import { useState, useEffect } from "react";
import { useUser } from "../../components/UserProvider";
import { BASE_PATH } from "../../lib/basePath";
import { SPECIES, GrowthStage, getNextGrowthThreshold } from "../../lib/petCatalog";
import { getPetCornerEnabled, setPetCornerEnabled } from "../../lib/petCornerPref";
import Pet3D from "../../components/Pet3D";
import styles from "../page.module.css";

interface Pet {
  species: string;
  stageOverride: string | null;
}

const STAGE_ORDER: GrowthStage[] = ["baby", "adult"];

const STAGE_LABELS: Record<GrowthStage, string> = {
  baby: "เด็ก",
  adult: "โต",
};

export default function PetsPage() {
  const { currentUser } = useUser();
  const [orderCount, setOrderCount] = useState(0);
  const [growthStage, setGrowthStage] = useState<GrowthStage>("baby");
  const [pet, setPet] = useState<Pet | null>(null);
  const [isDev, setIsDev] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  // Starts true (matching the value components/PetCorner.tsx also starts
  // with server-side) and corrects itself right after mount, so this and
  // the widget on /orders never briefly disagree with what's actually saved.
  const [cornerEnabled, setCornerEnabled] = useState(true);

  useEffect(() => {
    setCornerEnabled(getPetCornerEnabled());
  }, []);

  const toggleCornerEnabled = () => {
    const next = !cornerEnabled;
    setCornerEnabled(next);
    setPetCornerEnabled(next);
  };

  const fetchPet = async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/pets`);
      const data = await res.json();
      if (res.ok) {
        setOrderCount(data.orderCount);
        setGrowthStage(data.growthStage);
        setPet(data.pet);
        setIsDev(!!data.isDev);
      }
    } catch (e) {
      console.error("Failed to fetch pet", e);
    } finally {
      setIsLoading(false);
    }
  };

  // DEV-only: pin/reset the growth stage directly instead of waiting on
  // real order count — see app/api/pets/stage/route.ts.
  const setStageOverride = async (stage: GrowthStage | null) => {
    setIsBusy(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/pets/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "ตั้งค่าช่วงวัยไม่สำเร็จ");
        return;
      }
      await fetchPet();
    } catch (e) {
      alert("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    if (currentUser) fetchPet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  if (!currentUser) return null;

  const chooseSpecies = async (species: string) => {
    setIsBusy(true);
    try {
      await fetch(`${BASE_PATH}/api/pets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ species }),
      });
      await fetchPet();
      setIsPickerOpen(false);
    } catch (e) {
      alert("เลือกสัตว์เลี้ยงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsBusy(false);
    }
  };

  const nextGrowthThreshold = getNextGrowthThreshold(orderCount);

  return (
    <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto", color: "#fff" }}>
      <div className={styles.header} style={{ textAlign: "left", marginBottom: "24px" }}>
        <h1 className={styles.title} style={{ fontSize: "2rem" }}>สัตว์เลี้ยง 🐷</h1>
        <p className={styles.subtitle}>เลี้ยงสัตว์เสมือน 3 มิติที่โตตามยอดขายของคุณ</p>
      </div>

      <div className="glass-panel" style={{ padding: "20px 24px", borderRadius: "16px", marginBottom: "24px" }}>
        <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>ออเดอร์สะสมทั้งหมด</div>
            <div style={{ fontSize: "28px", fontWeight: "bold" }}>{orderCount}</div>
          </div>
          <div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>ช่วงวัยของสัตว์เลี้ยง</div>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "var(--accent-green)" }}>{STAGE_LABELS[growthStage]}</div>
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            {nextGrowthThreshold !== null
              ? `อีก ${nextGrowthThreshold - orderCount} ออเดอร์ถึงช่วงวัยถัดไป`
              : "โตเต็มวัยแล้ว 🎉"}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--text-secondary)", cursor: "pointer" }}>
            <input type="checkbox" checked={cornerEnabled} onChange={toggleCornerEnabled} />
            แสดงสัตว์เลี้ยงในหน้า Order
          </label>
        </div>
      </div>

      {isDev && pet && (
        <div className="glass-panel" style={{ padding: "16px 24px", borderRadius: "16px", marginBottom: "24px", border: "1px solid rgba(255,172,51,0.4)" }}>
          <div style={{ fontSize: "13px", color: "#ffac33", fontWeight: "bold", marginBottom: "10px" }}>
            🛠️ DEV — เลือกช่วงวัยเองได้
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setStageOverride(null)}
              style={{
                padding: "8px 14px",
                borderRadius: "8px",
                border: !pet.stageOverride ? "2px solid #ffac33" : "1px solid var(--border-color)",
                background: !pet.stageOverride ? "rgba(255,172,51,0.15)" : "rgba(var(--surface-rgb),0.05)",
                color: "#fff",
                cursor: isBusy ? "wait" : "pointer",
                fontSize: "13px",
              }}
            >
              อัตโนมัติ (ตามยอดจริง)
            </button>
            {STAGE_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                disabled={isBusy}
                onClick={() => setStageOverride(s)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: pet.stageOverride === s ? "2px solid #ffac33" : "1px solid var(--border-color)",
                  background: pet.stageOverride === s ? "rgba(255,172,51,0.15)" : "rgba(var(--surface-rgb),0.05)",
                  color: "#fff",
                  cursor: isBusy ? "wait" : "pointer",
                  fontSize: "13px",
                }}
              >
                {STAGE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "var(--text-secondary)" }}>กำลังโหลด...</div>
      ) : !pet ? (
        <div className="glass-panel" style={{ padding: "32px", borderRadius: "16px", textAlign: "center" }}>
          <p style={{ marginBottom: "20px", color: "var(--text-secondary)" }}>ยังไม่มีสัตว์เลี้ยง เลือกสายพันธุ์แรกของคุณ</p>
          <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
            {Object.values(SPECIES).map((s) => (
              <button
                key={s.code}
                type="button"
                disabled={isBusy}
                onClick={() => chooseSpecies(s.code)}
                style={{ padding: "16px", borderRadius: "12px", background: "rgba(var(--surface-rgb),0.05)", border: "1px solid var(--border-color)", color: "#fff", cursor: isBusy ? "wait" : "pointer", textAlign: "center" }}
              >
                <Pet3D species={s.code} stage="baby" size={140} />
                <div style={{ marginTop: "8px", fontSize: "14px" }}>{s.label}</div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: "24px", borderRadius: "16px", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Pet3D species={pet.species} stage={growthStage} size={320} />
          </div>
          <div style={{ fontWeight: "bold", fontSize: "18px", marginTop: "8px" }}>{SPECIES[pet.species]?.label || pet.species}</div>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "16px" }}>ลากเมาส์เพื่อหมุนดูรอบตัว</div>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => setIsPickerOpen(true)}
              style={{ padding: "10px 20px", borderRadius: "8px", background: "rgba(var(--surface-rgb),0.08)", border: "1px solid var(--border-color)", color: "#fff", cursor: "pointer", fontSize: "13px" }}
            >
              🔄 เปลี่ยนสัตว์เลี้ยง
            </button>
          </div>
        </div>
      )}

      {isPickerOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div style={{ background: "var(--modal-bg)", width: "100%", maxWidth: "560px", maxHeight: "80vh", borderRadius: "12px", padding: "24px", border: "1px solid var(--border-color)", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2 style={{ fontSize: "18px", fontWeight: "bold" }}>เปลี่ยนสัตว์เลี้ยง</h2>
              <button onClick={() => setIsPickerOpen(false)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: "20px" }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "12px" }}>
              {Object.values(SPECIES).map((s) => (
                <button
                  key={s.code}
                  type="button"
                  disabled={isBusy}
                  onClick={() => chooseSpecies(s.code)}
                  style={{
                    padding: "12px",
                    borderRadius: "10px",
                    background: pet?.species === s.code ? "rgba(88,166,255,0.15)" : "rgba(var(--surface-rgb),0.05)",
                    border: pet?.species === s.code ? "2px solid var(--accent-blue)" : "1px solid var(--border-color)",
                    color: "#fff",
                    cursor: isBusy ? "wait" : "pointer",
                    textAlign: "center",
                  }}
                >
                  <Pet3D species={s.code} stage="baby" size={120} />
                  <div style={{ marginTop: "6px", fontSize: "13px" }}>{s.label}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
