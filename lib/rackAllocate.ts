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

// Picks a subset of available rack pieces whose weights sum as close as
// possible to targetWeight (kg). Under-shooting the target means the
// customer gets less pork than they asked for — always worse than
// over-shooting, even by a lot — so among candidates, any sum that meets or
// exceeds the target beats every sum that falls short, and within each group
// the closest to target wins (real pork pieces mean the resulting overage is
// typically small, well under 0.2kg).
export function computeRackAllocation(racks: AllocatableRack[], targetWeight: number): RackAllocation[] {
  const availableRacks = racks
    .filter((r) => !r.isUsedUp && r.remainingWeight > 0)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const targetInt = Math.round(targetWeight * 100);
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
  const scoreOf = (sum: number) => (sum >= targetInt ? sum - targetInt : targetInt - sum + UNDERSHOOT_PENALTY);

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

    if (index >= racksWithInt.length || currentSum > targetInt + 200) {
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
