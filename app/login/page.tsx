"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PasswordField from "../../components/PasswordField";
import { BASE_PATH } from "../../lib/basePath";

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !password) {
      setError("กรุณากรอกชื่อและรหัสผ่าน");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${BASE_PATH}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "เข้าสู่ระบบไม่สำเร็จ");
        return;
      }
      window.location.href = `${BASE_PATH}/`;
    } catch (e) {
      setError("เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="glass-panel"
        style={{
          width: "100%",
          maxWidth: "380px",
          padding: "36px 32px",
          borderRadius: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "8px" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "12px",
              background: "var(--accent-blue, #58a6ff)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "bold",
              fontSize: "22px",
              color: "#fff",
              margin: "0 auto 12px",
            }}
          >
            A
          </div>
          <h1 style={{ fontSize: "20px", margin: 0 }}>AdminSpace</h1>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "6px" }}>
            เข้าสู่ระบบเพื่อใช้งาน
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>ชื่อผู้ใช้</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ชื่อของคุณ"
            autoFocus
            style={{
              background: "rgba(0,0,0,0.2)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "12px 14px",
              color: "#fff",
              fontSize: "15px",
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>รหัสผ่าน</label>
          <PasswordField
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            style={{
              background: "rgba(0,0,0,0.2)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "12px 14px",
              color: "#fff",
              fontSize: "15px",
            }}
          />
        </div>

        {error && <div style={{ color: "#ff6b6b", fontSize: "13px", textAlign: "center" }}>{error}</div>}

        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            background: "var(--accent-blue, #58a6ff)",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            padding: "14px",
            fontSize: "15px",
            fontWeight: "bold",
            cursor: "pointer",
            marginTop: "4px",
          }}
        >
          {isSubmitting ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
        </button>

        <p style={{ fontSize: "12px", color: "var(--text-secondary)", textAlign: "center", marginTop: "4px" }}>
          ยังไม่มีรหัสผ่าน หรือลืมรหัสผ่าน ติดต่อ Super Admin
        </p>
      </form>
    </div>
  );
}
