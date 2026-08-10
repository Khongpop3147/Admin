export interface AllocatableRack {
  id: string;
  rackNo: string;
  remainingWeight: number;
  isUsedUp?: boolean;
  createdAt: string | Date;
}

export interface RackAllocation {
  assignmentId: string;
  rackNo: string;
  weight: number;
}

// How far an allocation is allowed to land from the requested weight before
// it's no longer considered "close enough" — checked separately per
// direction. Over target: a flat cap, 0 to MAX_OVER_DEVIATION_KG over is
// fine. Under target: a *band*, not a cap starting at zero — a shortfall
// has to be at least MIN_UNDER_DEVIATION_KG before it's accepted at all
// (anything closer than that is treated the same as "nothing available"),
// and no more than MAX_UNDER_DEVIATION_KG. An allocation landing outside
// its direction's window is never chosen, even as a last resort. If nothing
// available lands within tolerance either way, the function returns nothing
// at all (an empty allocation) rather than force a mismatched amount.
export const MAX_OVER_DEVIATION_KG = 0.1;
export const MIN_UNDER_DEVIATION_KG = 0.17;
export const MAX_UNDER_DEVIATION_KG = 0.4;

// Picks a subset of available rack pieces whose weights sum as close as
// possible to targetWeight (kg), within target + MAX_OVER_DEVIATION_KG on
// the over side, or [target - MAX_UNDER_DEVIATION_KG, target -
// MIN_UNDER_DEVIATION_KG] on the under side. Anything outside those windows
// is disqualified outright. Two tiers, best to worst:
//   1. Meets or exceeds target, within MAX_OVER_DEVIATION_KG — smallest
//      overage wins. Always preferred over tier 2, even when a tier-2
//      candidate would land numerically closer to target.
//   2. Falls short of target, by between MIN_UNDER_DEVIATION_KG and
//      MAX_UNDER_DEVIATION_KG — smallest shortfall (within that band) wins.
//      Only used when nothing qualifies for tier 1.
export function computeRackAllocation(racks: AllocatableRack[], targetWeight: number): RackAllocation[] {
  const availableRacks = racks
    .filter((r) => !r.isUsedUp && r.remainingWeight > 0)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const targetInt = Math.round(targetWeight * 100);
  const overCapInt = Math.round(MAX_OVER_DEVIATION_KG * 100);
  const underFloorInt = Math.round(MIN_UNDER_DEVIATION_KG * 100);
  const underCapInt = Math.round(MAX_UNDER_DEVIATION_KG * 100);
  const racksWithInt = availableRacks.map((r) => ({
    ...r,
    intWeight: Math.round(r.remainingWeight * 100),
  }));

  const suffixSum: number[] = new Array(racksWithInt.length + 1).fill(0);
  for (let i = racksWithInt.length - 1; i >= 0; i--) {
    suffixSum[i] = suffixSum[i + 1] + racksWithInt[i].intWeight;
  }

  let bestSubset: (typeof racksWithInt) | null = null;
  let closestSubset: typeof racksWithInt = [];
  let minScore = Infinity;
  let callBudget = 200000; // hard cap so a large/unreachable inventory can never hang the tab

  // Tier 1 (meets/exceeds target) always scores lower than tier 2 (falls
  // short) — offsetting every tier-2 score above the worst possible tier-1
  // score (overCapInt) guarantees that, regardless of how much closer to
  // target a tier-2 candidate might numerically be.
  const scoreOf = (sum: number) => {
    const overshoot = sum - targetInt;
    if (overshoot >= 0) return overshoot <= overCapInt ? overshoot : Infinity;
    const shortfall = -overshoot;
    return shortfall >= underFloorInt && shortfall <= underCapInt ? shortfall + overCapInt + 1 : Infinity;
  };

  const findSubset = (index: number, currentSubset: typeof racksWithInt, currentSum: number): boolean => {
    if (callBudget-- <= 0) return false;

    if (currentSum > 0) {
      const score = scoreOf(currentSum);
      if (currentSum === targetInt) {
        bestSubset = [...currentSubset];
        return true;
      }
      if (score < minScore) {
        minScore = score;
        closestSubset = [...currentSubset];
      }
    }

    // Once already past the over-cap, every extension of this branch only
    // grows further past it (all weights are positive) — score is Infinity
    // from here on, so there's nothing left to explore.
    if (index >= racksWithInt.length || currentSum > targetInt + overCapInt) {
      return false;
    }

    // Unlike the over-side prune above, taking every remaining piece is no
    // longer automatically the best under-target candidate from this branch
    // — with a floor on the under-side band, that closest-to-target sum can
    // land too close and get disqualified, while some smaller subset of the
    // same remaining pieces lands inside the [floor, cap] band instead. So
    // this only prunes the branch when NO achievable sum (not even the
    // maximum) can climb as high as the band's lowest allowed sum
    // (target - cap, i.e. the largest allowed shortfall); every other case
    // has to actually be tried. callBudget still bounds the worst case.
    if (currentSum + suffixSum[index] < targetInt - underCapInt) {
      return false;
    }

    currentSubset.push(racksWithInt[index]);
    if (findSubset(index + 1, currentSubset, currentSum + racksWithInt[index].intWeight)) {
      return true;
    }
    currentSubset.pop();

    if (findSubset(index + 1, currentSubset, currentSum)) {
      return true;
    }

    return false;
  };

  findSubset(0, [], 0);

  const chosen = bestSubset || closestSubset;
  return chosen.map((rack) => ({
    assignmentId: rack.id,
    rackNo: rack.rackNo,
    weight: rack.remainingWeight,
  }));
}
