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

// How far over the requested weight an allocation is allowed to go before
// it's no longer considered "close enough" — beyond this, the customer is
// better served by an under-target amount (flagged as short) than by
// forcing a big unwanted overage on them. This is a hard cap: an allocation
// that exceeds it is never chosen, even as a last resort — if nothing fits
// within the cap and there's no under-target option either, the function
// returns nothing at all (an empty allocation, i.e. fully short) rather
// than force an oversized piece on the order.
export const MAX_OVER_ALLOCATION_KG = 0.2;

// Picks a subset of available rack pieces whose weights sum as close as
// possible to targetWeight (kg), preferring to round up. Two tiers, best to
// worst:
//   1. Meets or exceeds target, by no more than MAX_OVER_ALLOCATION_KG —
//      the "close enough, round up" zone. Smallest overage wins.
//   2. Falls short of target — the customer gets less than they asked for.
//      Smallest shortfall wins. Always worse than tier 1, but still chosen
//      over any allocation that breaks the overage cap.
// Anything exceeding the cap is disqualified outright, never selected.
export function computeRackAllocation(racks: AllocatableRack[], targetWeight: number): RackAllocation[] {
  const availableRacks = racks
    .filter((r) => !r.isUsedUp && r.remainingWeight > 0)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const targetInt = Math.round(targetWeight * 100);
  const capInt = Math.round(MAX_OVER_ALLOCATION_KG * 100);
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

  const UNDERSHOOT_PENALTY = 1_000_000;
  const scoreOf = (sum: number) => {
    if (sum >= targetInt && sum <= targetInt + capInt) return sum - targetInt;
    if (sum < targetInt) return targetInt - sum + UNDERSHOOT_PENALTY;
    return Infinity; // over the cap — disqualified, can never beat even an empty result
  };

  const considerCandidate = (subset: typeof racksWithInt, sum: number) => {
    if (sum <= 0) return;
    const score = scoreOf(sum);
    if (score < minScore) {
      minScore = score;
      closestSubset = subset;
    }
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

    // Once already past the cap, every extension of this branch only grows
    // further past it (all weights are positive) — score is Infinity from
    // here on, so there's nothing left to explore.
    if (index >= racksWithInt.length || currentSum > targetInt + capInt) {
      return false;
    }

    if (currentSum + suffixSum[index] < targetInt) {
      considerCandidate([...currentSubset, ...racksWithInt.slice(index)], currentSum + suffixSum[index]);
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
