// Slip-verification display, shared between OrderEntryForm and any other
// form that uploads a payment slip through the same /api/upload +
// /api/verify-slip pipeline (e.g. app/pending-stock/page.tsx), so the two
// never visually or behaviorally drift apart.

import { formatMoney } from "./OrderDetailShared";
import { isTotalAmountMatched, SLIP_ISSUE_REASONS, SLIP_ISSUE_OTHER } from "../lib/slipVerification";

export function SlipIssueReasonPicker({
  reason,
  onReasonChange,
  otherText,
  onOtherTextChange,
}: {
  reason: string;
  onReasonChange: (v: string) => void;
  otherText: string;
  onOtherTextChange: (v: string) => void;
}) {
  return (
    <div style={{ marginTop: '8px' }}>
      <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: '#ff6b6b', fontWeight: 600 }}>
        ⚠️ สลิปมีปัญหา — เลือกเหตุผลก่อนบันทึก *
      </label>
      <select
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(255,107,107,0.4)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '13px' }}
      >
        <option value="">-- เลือกเหตุผล --</option>
        {SLIP_ISSUE_REASONS.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
        <option value={SLIP_ISSUE_OTHER}>อื่นๆ (ระบุเอง)</option>
      </select>
      {reason === SLIP_ISSUE_OTHER && (
        <input
          type="text"
          value={otherText}
          onChange={(e) => onOtherTextChange(e.target.value)}
          placeholder="ระบุว่ามีปัญหาอะไร..."
          style={{ width: '100%', marginTop: '8px', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(255,107,107,0.4)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '13px' }}
        />
      )}
    </div>
  );
}

export function SlipVerificationBadge({ result }: { result: any }) {
  if (!result) return null;

  if (!result.success) {
    return (
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#ffac33', background: 'rgba(255,172,51,0.1)', border: '1px solid rgba(255,172,51,0.3)', borderRadius: '6px', padding: '8px 10px' }}>
        ⚠️ เช็คสลิปไม่สำเร็จ: {result.message || "ไม่ทราบสาเหตุ"} (ยังบันทึกได้ตามปกติ)
      </div>
    );
  }

  if (result.isDuplicate) {
    return (
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#ffac33', background: 'rgba(255,172,51,0.1)', border: '1px solid rgba(255,172,51,0.3)', borderRadius: '6px', padding: '8px 10px' }}>
        ⚠️ สลิปนี้เคยถูกใช้ยืนยันในออเดอร์อื่นมาแล้ว อาจเป็นสลิปซ้ำ กรุณาตรวจสอบ
      </div>
    );
  }

  if (result.amountMatched === false) {
    return (
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#ffac33', background: 'rgba(255,172,51,0.1)', border: '1px solid rgba(255,172,51,0.3)', borderRadius: '6px', padding: '8px 10px' }}>
        ⚠️ ยอดเงินในสลิป (฿{formatMoney(result.slipAmount)}) ไม่ตรงกับยอดที่ต้องได้รับ (฿{formatMoney(result.expectedAmount)}) กรุณาตรวจสอบ
      </div>
    );
  }

  if (result.accountMatched === false) {
    return (
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#ff6b6b', background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)', borderRadius: '6px', padding: '8px 10px' }}>
        ⚠️ ชื่อบัญชีปลายทางไม่ตรง — สลิปนี้โอนไปที่ {result.receiverName || 'บัญชีอื่น'} ({result.receiverBank || 'ไม่ทราบธนาคาร'}) ไม่ใช่บัญชีร้านที่ลงทะเบียนไว้ กรุณาตรวจสอบ
      </div>
    );
  }

  return (
    <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--accent-green)', background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.3)', borderRadius: '6px', padding: '8px 10px' }}>
      ✅ เช็คสลิปผ่าน โอนจาก {result.senderName || 'ไม่ทราบชื่อ'} {result.senderBank ? `(${result.senderBank})` : ''} ยอด ฿{formatMoney(result.slipAmount)}
    </div>
  );
}

// Shown once below every slip (not per-slip) — sums whatever Thunder
// confirmed across all of them (see lib/slipVerification.ts) and compares
// that total to what's actually expected.
export function CombinedSlipSummary({ totalVerified, expectedTotal, slipCount }: { totalVerified: number; expectedTotal: number; slipCount: number }) {
  if (slipCount === 0 || expectedTotal <= 0) return null;
  const matched = isTotalAmountMatched(totalVerified, expectedTotal);
  if (matched) {
    return (
      <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--accent-green)', background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.3)', borderRadius: '6px', padding: '8px 10px' }}>
        ✅ รวมยอดจาก{slipCount > 1 ? `${slipCount} สลิป` : 'สลิป'}แล้ว: ฿{formatMoney(totalVerified)} ตรงกับยอดที่ต้องได้รับ
      </div>
    );
  }
  return (
    <div style={{ marginTop: '8px', fontSize: '12px', color: '#ffac33', background: 'rgba(255,172,51,0.1)', border: '1px solid rgba(255,172,51,0.3)', borderRadius: '6px', padding: '8px 10px' }}>
      ⚠️ รวมยอดจาก{slipCount > 1 ? `${slipCount} สลิป` : 'สลิป'}แล้ว: ฿{formatMoney(totalVerified)} ไม่ตรงกับยอดที่ต้องได้รับ (฿{formatMoney(expectedTotal)}) กรุณาตรวจสอบ
    </div>
  );
}
