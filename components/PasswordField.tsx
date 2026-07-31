"use client";

import { useState } from "react";

interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
}

export default function PasswordField({ value, onChange, placeholder, className, style, autoFocus }: PasswordFieldProps) {
  const [show, setShow] = useState(false);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={className}
        style={{ ...style, width: "100%", boxSizing: "border-box", paddingRight: "52px" }}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        tabIndex={-1}
        style={{
          position: "absolute",
          right: "6px",
          top: "50%",
          transform: "translateY(-50%)",
          background: "transparent",
          border: "none",
          color: "var(--text-secondary)",
          cursor: "pointer",
          fontSize: "12px",
          padding: "6px 8px",
        }}
      >
        {show ? "🙈 ซ่อน" : "👁️ แสดง"}
      </button>
    </div>
  );
}
