export interface RackLike {
  rackNo: string;
}

// Finds pork-piece codes that should exist (they sit inside a run of
// consecutive codes with the same letter prefix) but don't appear anywhere
// in the given list. Rack numbering runs sequentially across the whole
// business, not per admin, so this must be given the FULL combined list
// (every admin's racks + central) — scanning one admin's own list in
// isolation misses gaps that sit right at the boundary between two admins.
//
// A candidate gap is only reported if the run between its neighbors is
// smaller than 10 linear positions (2 racks' worth) — a bigger jump is
// almost certainly an intentional new batch starting at a fresh number, not
// pieces that actually went missing.
export function findMissingRackCodes(racks: RackLike[]): string[] {
  const allRackNos = racks.map((r) => r.rackNo);
  const missing = new Set<string>();

  const sorted = [...racks].sort((a, b) => {
    const matchA = a.rackNo.match(/([A-Z]+)(\d+)(?:-(\d+))?/);
    const matchB = b.rackNo.match(/([A-Z]+)(\d+)(?:-(\d+))?/);
    if (matchA && matchB) {
      if (matchA[1] !== matchB[1]) return matchA[1].localeCompare(matchB[1]);
      if (parseInt(matchA[2]) !== parseInt(matchB[2])) return parseInt(matchA[2]) - parseInt(matchB[2]);
      if (matchA[3] && matchB[3]) return parseInt(matchA[3]) - parseInt(matchB[3]);
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
    // entirely). The only thing that matters is whether the candidate code
    // exists anywhere at all, checked below via allRackNos.
    const aM = a.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
    const bM = b.rackNo.match(/^(.*?)(\d+)-(\d+)$/);
    if (aM && bM && aM[1] === bM[1]) {
      const p = aM[1];
      const anum = parseInt(aM[2], 10) * 5 + parseInt(aM[3], 10);
      const bnum = parseInt(bM[2], 10) * 5 + parseInt(bM[3], 10);
      if (bnum - anum > 1 && bnum - anum < 10) {
        for (let n = anum + 1; n < bnum; n++) {
          let pNum = n % 5;
          let rNum = Math.floor(n / 5);
          if (pNum === 0) { pNum = 5; rNum--; }
          const missingName = `${p}${String(rNum).padStart(aM[2].length, "0")}-${pNum}`;
          if (!allRackNos.includes(missingName)) {
            missing.add(missingName);
          }
        }
      }
    }
  }

  return Array.from(missing).sort();
}
