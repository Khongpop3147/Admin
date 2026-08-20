// Matches a courier export's customer name against our own order records —
// extracted so the bulk tracking-number import (app/api/orders/bulk-tracking)
// and any other place that needs this matching share identical, tested logic.

export interface NameCandidate {
  id: string;
  name: string;
}

export type NameMatchResult =
  | { status: "matched"; id: string }
  | { status: "not_found" }
  // More than one candidate matched exactly — refuse to guess (a duplicate
  // customer name). Silently picking "whichever came first" is exactly the
  // bug this type exists to prevent.
  | { status: "ambiguous"; candidateIds: string[] };

export function normalizeCustomerName(name: string): string {
  return name
    .replace(/^คุณ\s*/, "") // Remove "คุณ " prefix
    .replace(/\s+/g, "") // Remove all whitespace
    .toLowerCase();
}

// Exact match only (after normalizing prefix/whitespace/case) — no
// substring/fuzzy tolerance. A courier row that doesn't match any order's
// name exactly comes back not_found rather than guessing at a "close
// enough" candidate, even when there's only one plausible one; a short
// real name silently matching a longer unrelated one's substring (e.g.
// "ชาย" matching "สมชาย ใจดี") was a real risk of attaching a tracking
// number to the wrong customer, and the reviewable-note workaround for
// that risk was still a workaround — matching this strictly removes the
// risk outright instead of just flagging it.
export function findNameMatch(rawExcelName: string, candidates: NameCandidate[]): NameMatchResult {
  const excelName = normalizeCustomerName(rawExcelName);
  const exact = candidates.filter((c) => normalizeCustomerName(c.name) === excelName);
  if (exact.length === 1) return { status: "matched", id: exact[0].id };
  if (exact.length > 1) return { status: "ambiguous", candidateIds: exact.map((c) => c.id) };
  return { status: "not_found" };
}
