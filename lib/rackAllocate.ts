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

// How far an allocation is allowed to land from the requested weight, in
// either direction, before it's no longer considered "close enough". This is
// a hard, symmetric cap — an allocation whose total is more than this far
// over OR under the target is never chosen, even as a last resort. If
// nothing available lands within the tolerance in either direction, the
// function returns nothing at all (an empty allocation) rather than force a
// badly-mismatched amount on the order.
export const MAX_WEIGHT_DEVIATION_KG = 0.2;

// Picks a subset of available rack pieces whose weights sum as close as
// possible to targetWeight (kg), within ±MAX_WEIGHT_DEVIATION_KG. Anything
// outside that window is disqualified outright. Among valid candidates,
// smallest deviation wins; an exact tie between an over-shoot and an
// under-shoot of the same size favors the over-shoot (round up, not down).
export function computeRackAllocation(racks: AllocatableRack[], targetWeight: number): RackAllocation[] {
  const availableRacks = racks
    .filter((r) => !r.isUsedUp && r.remainingWeight > 0)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const targetInt = Math.round(targetWeight * 100);
  const capInt = Math.round(MAX_WEIGHT_DEVIATION_KG * 100);
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

  const scoreOf = (sum: number) => {
    const deviation = Math.abs(sum - targetInt);
    if (deviation > capInt) return Infinity; // outside the tolerance either way — disqualified
    // Tiny tie-break nudge (well under 1 int-unit) so an exact-magnitude
    // over-shoot beats an equal-magnitude under-shoot without ever being
    // able to flip a genuine difference.
    return sum >= targetInt ? deviation : deviation + 0.5;
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
