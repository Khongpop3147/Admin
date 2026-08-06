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
