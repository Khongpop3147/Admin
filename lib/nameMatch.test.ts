import { describe, it, expect } from "vitest";
import { findNameMatch, normalizeCustomerName } from "./nameMatch";

describe("normalizeCustomerName", () => {
  it("strips a leading 'คุณ' prefix, whitespace, and lowercases", () => {
    expect(normalizeCustomerName("คุณ สมชาย ใจดี")).toBe("สมชายใจดี");
    expect(normalizeCustomerName("  John Doe  ")).toBe("johndoe");
  });
});

describe("findNameMatch", () => {
  it("matches an exact name", () => {
    const candidates = [{ id: "1", name: "คุณสมชาย" }, { id: "2", name: "คุณสมหญิง" }];
    expect(findNameMatch("สมชาย", candidates)).toEqual({ status: "matched", id: "1", matchType: "exact" });
  });

  it("does not let a short substring match an unrelated longer name (regression: 'มล' vs 'กมล'/'มลคร')", () => {
    const candidates = [{ id: "1", name: "คุณกมล" }, { id: "2", name: "คุณมลคร" }];
    // "มล" is only 2 characters -- below the minimum for substring matching,
    // and it's not an exact match against either candidate -- must be
    // reported as not found rather than silently guessing one of them.
    expect(findNameMatch("มล", candidates)).toEqual({ status: "not_found" });
  });

  it("still matches a short name via an EXACT match, even below the substring-length floor", () => {
    const candidates = [{ id: "1", name: "คุณมล" }, { id: "2", name: "คุณกมล" }];
    expect(findNameMatch("มล", candidates)).toEqual({ status: "matched", id: "1", matchType: "exact" });
  });

  it("tolerates a courier export missing a surname via substring matching", () => {
    const candidates = [{ id: "1", name: "คุณสมชาย ใจดีมาก" }];
    expect(findNameMatch("สมชาย", candidates)).toEqual({ status: "matched", id: "1", matchType: "substring" });
  });

  it("flags a lone substring match as matchType 'substring' rather than 'exact' — the caller (bulk-tracking) uses this to stamp a reviewable note, since a short real name like 'ชาย' silently matching 'สมชาย ใจดี' (the only open order) is a real risk of attaching a tracking number to the wrong customer", () => {
    const candidates = [{ id: "1", name: "สมชาย ใจดี" }];
    const result = findNameMatch("ชาย", candidates);
    expect(result).toEqual({ status: "matched", id: "1", matchType: "substring" });
  });

  it("reports ambiguous when more than one candidate matches by substring", () => {
    const candidates = [{ id: "1", name: "คุณสมชาย ใจดี" }, { id: "2", name: "คุณสมชาย รักดี" }];
    const result = findNameMatch("สมชาย", candidates);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidateIds.sort()).toEqual(["1", "2"]);
    }
  });

  it("reports ambiguous when more than one candidate matches exactly (duplicate customer names)", () => {
    const candidates = [{ id: "1", name: "คุณสมชาย" }, { id: "2", name: "คุณสมชาย" }];
    const result = findNameMatch("สมชาย", candidates);
    expect(result.status).toBe("ambiguous");
  });

  it("returns not_found when nothing matches", () => {
    const candidates = [{ id: "1", name: "คุณสมชาย" }];
    expect(findNameMatch("วิชัย", candidates)).toEqual({ status: "not_found" });
  });

  it("ignores candidates whose own name is below the substring-length floor", () => {
    // A candidate named just "คุณกอ" (2 chars after normalizing) should
    // never be substring-matched against anything -- only reachable via an
    // exact match.
    const candidates = [{ id: "1", name: "คุณกอ" }];
    expect(findNameMatch("กอใจดี", candidates)).toEqual({ status: "not_found" });
  });
});
