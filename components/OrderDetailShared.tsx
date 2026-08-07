// Small presentational pieces shared by every "show one order's full detail"
// view in the app — originally lived only in OrderEntryForm's own order
// detail modal, extracted so HR Manage's customer-history view can render
// the same look without duplicating the formatting/status logic.

export function formatMoney(value: unknown): string {
  const num = typeof value === "string" ? parseFloat(value) : (value as number);
  if (num === undefined || num === null || isNaN(num)) return "0";
  // ทศนิยมต่ำกว่า .5 ปัดลง, ตั้งแต่ .5 ปัดขึ้น (ปัดเป็นจำนวนเต็ม)
  return Math.round(num).toLocaleString("th-TH");
}

export function getOrderStatusInfo(status?: string) {
  switch (status) {
    case "Completed":
      return { label: "เสร็จสิ้น", color: "#3fb950", bg: "rgba(63,185,80,0.15)" };
    case "Shipped":
      return { label: "จัดส่งแล้ว", color: "#58a6ff", bg: "rgba(88,166,255,0.15)" };
    case "Packed":
      return { label: "แพ็คแล้ว", color: "#58a6ff", bg: "rgba(88,166,255,0.15)" };
    case "Pending":
      return { label: "รอดำเนินการ", color: "#ffac33", bg: "rgba(255,172,51,0.15)" };
    default:
      return { label: "รอดำเนินการ", color: "#8b949e", bg: "rgba(139,148,158,0.15)" };
  }
}

export function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '10px' }}>{title}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>{children}</div>
    </div>
  );
}

export function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', fontSize: '14px' }}>
      <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: 'right', fontWeight: 500 }}>{value}</span>
    </div>
  );
}
