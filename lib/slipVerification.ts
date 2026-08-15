export interface SlipCheckResult {
  success: boolean;
  isDuplicate?: boolean;
  accountMatched?: boolean | null;
  slipAmount?: number | null;
}

// A slip whose amount should count toward the order total — verified fine,
// not flagged as a duplicate upload, and paid into the right account. A
// slip that failed to check at all, or one Thunder can't confirm the
// receiving account for, still gets saved on the order (never blocks
// admins), it just doesn't contribute to the running total.
export function isSlipUsable(result: SlipCheckResult | null | undefined): boolean {
  if (!result) return false;
  if (!result.success) return false;
  if (result.isDuplicate) return false;
  if (result.accountMatched === false) return false;
  return true;
}

export function sumUsableSlipAmounts(results: (SlipCheckResult | null | undefined)[]): number {
  return results.reduce((sum, r) => sum + (isSlipUsable(r) ? Number(r?.slipAmount) || 0 : 0), 0);
}

// Same ±2 baht tolerance Thunder itself used to apply to a single slip's own
// amountMatched (see app/api/verify-slip/route.ts) — a customer paying a
// couple baht over/under (bank rounding) still counts as a clean match.
export function isTotalAmountMatched(totalVerified: number, expectedTotal: number): boolean {
  return Math.abs(totalVerified - expectedTotal) <= 2;
}

// Any slip that came back with a problem (failed check, duplicate, wrong
// receiving account) needs the admin to explain before saving — checked
// across every slip on the order, not just one.
export function hasAnySlipIssue(results: (SlipCheckResult | null | undefined)[]): boolean {
  return results.some((r) => r && (!r.success || r.isDuplicate || r.accountMatched === false));
}

export const SLIP_ISSUE_REASONS = [
  "สลิปไม่มี QR โค้ด",
  "รีเฟรชหน้าเว็บซ้ำ ระบบเลยแจ้งว่าสลิปซ้ำ (จริงๆ ไม่ซ้ำ)",
  "ชื่อบัญชีปลายทางไม่ตรง แต่ตรวจสอบแล้วถูกต้อง",
  "ยอดเงินไม่ตรง แต่ตรวจสอบแล้วถูกต้อง",
];

// Sentinel for the "type your own reason" option — kept distinct from the
// fixed reasons above so callers can tell when to show/require the
// free-text follow-up, without string-matching a display label.
export const SLIP_ISSUE_OTHER = "อื่นๆ";

// True once there's enough to save on — a fixed reason needs nothing else,
// but "อื่นๆ" needs its own free-text filled in too.
export function isSlipIssueReasonComplete(reason: string, otherText: string): boolean {
  if (!reason) return false;
  if (reason === SLIP_ISSUE_OTHER) return !!otherText.trim();
  return true;
}

// Builds the "[หมายเหตุสลิป: ...]" note tag saved onto adminNote/note — same
// bracketed-tag convention as extractShortageNote (lib/porkSlip.ts) and
// buildTrackDateMismatchNote (lib/trackingImport.ts). For "อื่นๆ", the
// actual typed detail replaces the generic label so the saved note is
// useful on its own instead of just saying "other."
export function buildSlipIssueNote(reason: string, otherText: string): string {
  if (!reason) return "";
  const detail = reason === SLIP_ISSUE_OTHER ? otherText.trim() : reason;
  return detail ? `[หมายเหตุสลิป: ${detail}]` : "";
}
