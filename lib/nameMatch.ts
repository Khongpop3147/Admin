// Matches a courier export's customer name against our own order records —
// extracted so the bulk tracking-number import (app/api/orders/bulk-tracking)
// and any other place that needs this matching share identical, tested logic.

export interface NameCandidate {
  id: string;
  name: string;
}

export type NameMatchResult =
  // matchType lets a caller treat a substring match with extra caution (e.g.
  // stamp a reviewable note) without re-deriving whether it was exact —
  // "ชาย" matching "สมชาย ใจดี" as the sole open candidate is a confident,
  // silent "matched" today even though it's a real risk of attaching a
  // tracking number to the wrong customer; exact still needs no caveat.
  | { status: "matched"; id: string; matchType: "exact" | "substring" }
  | { status: "not_found" }
  // More than one candidate matched — refuse to guess. Silently picking
  // "whichever came first" is exactly the bug this type exists to prevent:
  // a short/generic name like "มล" would otherwise get auto-assigned to
  // whichever unrelated customer ("กมล", "มลคร", ...) happened to be first
  // in the list, attaching that tracking number to the wrong order.
  | { status: "ambiguous"; candidateIds: string[] };

export function normalizeCustomerName(name: string): string {
  return name
    .replace(/^คุณ\s*/, "") // Remove "คุณ " prefix
    .replace(/\s+/g, "") // Remove all whitespace
    .toLowerCase();
}

// Thai given names are essentially never 1-2 characters — requiring at
// least this many normalized characters before allowing substring (not
// exact) matching stops a short name from accidentally matching an
// unrelated customer whose name merely contains it as a substring.
export const MIN_SUBSTRING_MATCH_LENGTH = 3;

export function findNameMatch(rawExcelName: string, candidates: NameCandidate[]): NameMatchResult {
  const excelName = normalizeCustomerName(rawExcelName);

  // Exact match is always unambiguous and safe regardless of name length —
  // checked before any substring logic, so a real short name (if it exactly
  // matches) still works.
  const exact = candidates.filter((c) => normalizeCustomerName(c.name) === excelName);
  if (exact.length === 1) return { status: "matched", id: exact[0].id, matchType: "exact" };
  if (exact.length > 1) return { status: "ambiguous", candidateIds: exact.map((c) => c.id) };

  if (excelName.length < MIN_SUBSTRING_MATCH_LENGTH) return { status: "not_found" };

  // Tolerates minor variants (a courier export missing/adding a surname, a
  // nickname vs. full name) via a two-way substring check — but only once
  // both sides clear the minimum length, so short names can't collide.
  const substring = candidates.filter((c) => {
    const name = normalizeCustomerName(c.name);
    if (name.length < MIN_SUBSTRING_MATCH_LENGTH) return false;
    return name.includes(excelName) || excelName.includes(name);
  });
  if (substring.length === 1) return { status: "matched", id: substring[0].id, matchType: "substring" };
  if (substring.length > 1) return { status: "ambiguous", candidateIds: substring.map((c) => c.id) };

  return { status: "not_found" };
}
