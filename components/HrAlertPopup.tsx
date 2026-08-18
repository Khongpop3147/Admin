"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useUser } from "./UserProvider";
import { BASE_PATH } from "../lib/basePath";

interface Alert {
  id: string;
  message: string;
  createdBy: string;
  createdAt: string;
}

const POLL_INTERVAL_MS = 20000;

// Mounted once in AppShell so it's active on every authenticated page — an
// HR/Super Admin message pops up here next time its targeted admin has
// AdminSpace open, on whatever page they're already on. Applied off
// sessionUser (the real login), same reasoning as theme/mode in
// UserProvider — a DEV previewing as someone else still only sees their own
// real alerts, never the previewed user's.
export default function HrAlertPopup() {
  const { sessionUser } = useUser();
  const [queue, setQueue] = useState<Alert[]>([]);
  const [isDismissing, setIsDismissing] = useState(false);
  // Ids dismissed locally but possibly not yet reflected in the server's
  // response to an in-flight poll issued just before the dismiss — without
  // this, that stale response can win the setQueue race and resurrect an
  // alert the user just acknowledged (React Strict Mode's double-effect in
  // dev makes this easy to hit, but a slow request could trigger it in prod
  // too).
  const dismissedIdsRef = useRef<Set<string>>(new Set());

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/hr-alerts/pending`);
      if (!res.ok) return;
      const data = await res.json();
      const alerts: Alert[] = data.alerts || [];
      setQueue((prev) => {
        // Merge rather than replace — don't drop an alert that's already
        // showing (and mid-dismiss) just because a poll landed at the same
        // moment.
        const known = new Set(prev.map((a) => a.id));
        const fresh = alerts.filter((a) => !known.has(a.id) && !dismissedIdsRef.current.has(a.id));
        return [...prev, ...fresh];
      });
    } catch (e) {
      console.error("Failed to poll HR alerts", e);
    }
  }, []);

  useEffect(() => {
    if (!sessionUser) return;
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sessionUser, poll]);

  const dismiss = async (id: string) => {
    dismissedIdsRef.current.add(id);
    setQueue((prev) => prev.filter((a) => a.id !== id));
    setIsDismissing(true);
    try {
      await fetch(`${BASE_PATH}/api/hr-alerts/${id}/dismiss`, { method: "POST" });
    } catch (e) {
      console.error("Failed to dismiss HR alert", e);
    } finally {
      setIsDismissing(false);
    }
  };

  if (queue.length === 0) return null;
  const current = queue[0];

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: "rgba(0,0,0,0.7)",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          background: "var(--modal-bg)",
          padding: "28px",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "420px",
          border: "1px solid var(--border-color)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <span style={{ fontSize: "22px" }}>📢</span>
          <h2 style={{ margin: 0, fontSize: "18px", color: "var(--text-heading)" }}>ข้อความจาก {current.createdBy}</h2>
        </div>
        <p style={{ fontSize: "15px", color: "var(--text-primary)", whiteSpace: "pre-wrap", marginBottom: "20px" }}>
          {current.message}
        </p>
        <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "20px" }}>
          {new Date(current.createdAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}
          {queue.length > 1 && ` · เหลืออีก ${queue.length - 1} ข้อความ`}
        </div>
        <button
          onClick={() => dismiss(current.id)}
          disabled={isDismissing}
          style={{
            width: "100%",
            background: "var(--accent-blue)",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            padding: "12px",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: isDismissing ? "wait" : "pointer",
          }}
        >
          รับทราบ
        </button>
      </div>
    </div>
  );
}
