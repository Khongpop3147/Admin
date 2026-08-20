import { describe, it, expect } from "vitest";
import { findNameMatch, normalizeCustomerName } from "./nameMatch";

describe("normalizeCustomerName", () => {
  it("strips a leading 'คุณ' prefix, whitespace, and lowercases", () => {
    expect(normalizeCustomerName("คุณ สมชาย ใจดี")).toBe("สมชายใจดี");
    expect(normalizeCustomerName("  John Doe  ")).toBe("johndoe");
  });
});

describe("findNameMatch", () => {
  it("matches an exact name (after normalizing prefix/whitespace/case)", () => {
    const candidates = [{ id: "1", name: "คุณสมชาย" }, { id: "2", name: "คุณสมหญิง" }];
    expect(findNameMatch("สมชาย", candidates)).toEqual({ status: "matched", id: "1" });
  });

  it("matches a short exact name just as confidently as a long one — there's no length floor once matching is exact-only", () => {
    const candidates = [{ id: "1", name: "คุณมล" }, { id: "2", name: "คุณกมล" }];
    expect(findNameMatch("มล", candidates)).toEqual({ status: "matched", id: "1" });
  });

  it("does NOT match a courier row that's merely a substring of a candidate's name — a partial name (missing surname, nickname) must be typed in by hand rather than guessed", () => {
    const candidates = [{ id: "1", name: "คุณสมชาย ใจดีมาก" }];
    expect(findNameMatch("สมชาย", candidates)).toEqual({ status: "not_found" });
  });

  it("does NOT match a short real name against an unrelated longer name it happens to be a substring of (regression: 'ชาย' vs 'สมชาย ใจดี' — two different people)", () => {
    const candidates = [{ id: "1", name: "สมชาย ใจดี" }];
    expect(findNameMatch("ชาย", candidates)).toEqual({ status: "not_found" });
  });

  it("reports ambiguous when more than one candidate matches exactly (duplicate customer names)", () => {
    const candidates = [{ id: "1", name: "คุณสมชาย" }, { id: "2", name: "คุณสมชาย" }];
    const result = findNameMatch("สมชาย", candidates);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidateIds.sort()).toEqual(["1", "2"]);
    }
  });

  it("returns not_found when nothing matches", () => {
    const candidates = [{ id: "1", name: "คุณสมชาย" }];
    expect(findNameMatch("วิชัย", candidates)).toEqual({ status: "not_found" });
  });
});
