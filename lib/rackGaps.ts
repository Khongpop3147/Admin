import { parseRackCode, formatRackCode, DEFAULT_PRODUCT_TYPE, PIECES_PER_RACK } from "./rackCode";

export interface RackLike {
  rackNo: string;
  // Which product this piece belongs to — defaults to the original product
  // (PORK) so existing callers that never set this still behave exactly as
  // before. Grouping by this INSIDE the function (rather than requiring
  // callers to pre-filter) means a caller can safely pass a combined list
  // spanning both products without remembering to split it first.
  productType?: string;
}

// Finds pork-piece codes that should exist (they sit inside a run of
// consecutive codes with the same letter prefix) but don't appear anywhere
// in the given list. Rack numbering runs sequentially across the whole
// business, not per admin, so this must be given the FULL combined list
// (every admin's racks + central) — scanning one admin's own list in
// isolation misses gaps that sit right at the boundary between two admins.
//
// A candidate gap is only reported if the run between its neighbors is
// smaller than 2 racks' worth of positions — a bigger jump is almost
// certainly an intentional new batch starting at a fresh number, not pieces
// that actually went missing.
export function findMissingRackCodes(racks: RackLike[]): string[] {
  // Group by product first — a classic-format run and a prefixed-format run
  // must never be compared against each other for gaps (their codes don't
  // even parse under the other's format, so mixing them would either throw
  // away real neighbors or, worse, misdetect gaps across two unrelated
  // numbering schemes).
  const byProduct = new Map<string, RackLike[]>();
  for (const r of racks) {
    const productType = r.productType || DEFAULT_PRODUCT_TYPE;
    if (!byProduct.has(productType)) byProduct.set(productType, []);
    byProduct.get(productType)!.push(r);
  }

  const missing = new Set<string>();

  for (const [productType, group] of byProduct) {
    const allCodesInGroup = new Set(group.map((r) => r.rackNo));

    const sorted = [...group].sort((a, b) => {
      const matchA = parseRackCode(a.rackNo, productType);
      const matchB = parseRackCode(b.rackNo, productType);
      if (matchA && matchB) {
        if (matchA.prefix !== matchB.prefix) return matchA.prefix.localeCompare(matchB.prefix);
        if (matchA.num !== matchB.num) return matchA.num - matchB.num;
        if (matchA.piece !== null && matchB.piece !== null) return matchA.piece - matchB.piece;
      }
      return a.rackNo.localeCompare(b.rackNo, undefined, { numeric: true });
    });

    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      // Whether a piece has already sold out (isUsedUp) says nothing about
      // whether the code between it and its neighbor was ever created —
      // checking that here used to hide real gaps (confirmed against
      // production: L112-1 sits right after L111-5, but L112-2 was already
      // sold out, so an isUsedUp check on the neighbors skipped the pair
      // entirely). The only thing that matters is whether the candidate
      // code exists anywhere at all, checked below via allCodesInGroup.
      const aM = parseRackCode(a.rackNo, productType);
      const bM = parseRackCode(b.rackNo, productType);
      if (aM && bM && aM.piece !== null && bM.piece !== null && aM.prefix === bM.prefix) {
        const anum = aM.num * PIECES_PER_RACK + aM.piece;
        const bnum = bM.num * PIECES_PER_RACK + bM.piece;
        if (bnum - anum > 1 && bnum - anum < PIECES_PER_RACK * 2) {
          for (let n = anum + 1; n < bnum; n++) {
            let pNum = n % PIECES_PER_RACK;
            let rNum = Math.floor(n / PIECES_PER_RACK);
            if (pNum === 0) {
              pNum = PIECES_PER_RACK;
              rNum--;
            }
            const missingName = formatRackCode({ prefix: aM.prefix, num: rNum, piece: pNum }, productType);
            if (!allCodesInGroup.has(missingName)) {
              missing.add(missingName);
            }
          }
        }
      }
    }
  }

  return Array.from(missing).sort();
}
