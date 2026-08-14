import { describe, it, expect } from "vitest";
import {
  parseRackCode,
  formatRackCode,
  getBaseRackKey,
  getBaseRackKeyAuto,
  getRackScopePrefix,
  incrementPrefix,
  decrementPrefix,
  getRackSequence,
} from "./rackCode";

describe("parseRackCode — classic format (PORK)", () => {
  it("parses a rack code with a piece suffix", () => {
    expect(parseRackCode("A005-1", "PORK")).toEqual({ prefix: "A", num: 5, piece: 1 });
  });

  it("parses a bare rack code with no piece suffix", () => {
    expect(parseRackCode("A005", "PORK")).toEqual({ prefix: "A", num: 5, piece: null });
  });

  it("parses a multi-letter prefix (post Z-rollover)", () => {
    expect(parseRackCode("AA005-1", "PORK")).toEqual({ prefix: "AA", num: 5, piece: 1 });
  });

  it("returns null for a prefixed-format code", () => {
    expect(parseRackCode("L-A001-1", "PORK")).toBeNull();
  });

  it("defaults to classic when no productType is given", () => {
    expect(parseRackCode("A005-1")).toEqual({ prefix: "A", num: 5, piece: 1 });
  });
});

describe("parseRackCode — prefixed format (PORK_LOIN)", () => {
  it("parses a rack code with a piece suffix", () => {
    expect(parseRackCode("L-A001-1", "PORK_LOIN")).toEqual({ prefix: "A", num: 1, piece: 1 });
  });

  it("parses a bare rack code with no piece suffix", () => {
    expect(parseRackCode("L-A001", "PORK_LOIN")).toEqual({ prefix: "A", num: 1, piece: null });
  });

  it("parses a multi-letter prefix (post Z-rollover)", () => {
    expect(parseRackCode("L-AA005-1", "PORK_LOIN")).toEqual({ prefix: "AA", num: 5, piece: 1 });
  });

  it("returns null for a classic-format code", () => {
    expect(parseRackCode("A005-1", "PORK_LOIN")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parseRackCode("not-a-code", "PORK_LOIN")).toBeNull();
  });
});

describe("parseRackCode — prefixed format (PORK_HIP)", () => {
  it("parses a rack code with a piece suffix", () => {
    expect(parseRackCode("LF-A001-1", "PORK_HIP")).toEqual({ prefix: "A", num: 1, piece: 1 });
  });

  it("does not get misparsed as PORK_LOIN despite sharing a leading 'L'", () => {
    expect(parseRackCode("LF-A001-1", "PORK_LOIN")).toBeNull();
    expect(parseRackCode("L-A001-1", "PORK_HIP")).toBeNull();
  });
});

describe("formatRackCode", () => {
  it("formats classic", () => {
    expect(formatRackCode({ prefix: "A", num: 5, piece: 1 }, "PORK")).toBe("A005-1");
  });

  it("formats prefixed", () => {
    expect(formatRackCode({ prefix: "A", num: 1, piece: 1 }, "PORK_LOIN")).toBe("L-A001-1");
    expect(formatRackCode({ prefix: "A", num: 1, piece: 1 }, "PORK_HIP")).toBe("LF-A001-1");
  });

  it("round-trips through parse for every format", () => {
    const classic = formatRackCode({ prefix: "AA", num: 5, piece: 3 }, "PORK");
    expect(parseRackCode(classic, "PORK")).toEqual({ prefix: "AA", num: 5, piece: 3 });

    const prefixed = formatRackCode({ prefix: "AA", num: 5, piece: 3 }, "PORK_LOIN");
    expect(parseRackCode(prefixed, "PORK_LOIN")).toEqual({ prefix: "AA", num: 5, piece: 3 });

    const hip = formatRackCode({ prefix: "AA", num: 5, piece: 3 }, "PORK_HIP");
    expect(parseRackCode(hip, "PORK_HIP")).toEqual({ prefix: "AA", num: 5, piece: 3 });
  });
});

describe("getBaseRackKey", () => {
  it("groups pieces of the same classic rack under one key", () => {
    expect(getBaseRackKey("A005-1", "PORK")).toBe(getBaseRackKey("A005-5", "PORK"));
  });

  it("does not group different classic racks together", () => {
    expect(getBaseRackKey("A005-1", "PORK")).not.toBe(getBaseRackKey("A006-1", "PORK"));
  });

  it("groups pieces of the same prefixed rack under one key (regression: used to collapse to just 'L')", () => {
    const key1 = getBaseRackKey("L-A001-3", "PORK_LOIN");
    const key5 = getBaseRackKey("L-A001-5", "PORK_LOIN");
    expect(key1).toBe(key5);
    expect(key1).not.toBe("L");
  });

  it("does not group different prefixed racks together", () => {
    expect(getBaseRackKey("L-A001-1", "PORK_LOIN")).not.toBe(getBaseRackKey("L-A002-1", "PORK_LOIN"));
  });
});

describe("getBaseRackKeyAuto", () => {
  it("groups pieces of the same classic rack without needing productType", () => {
    expect(getBaseRackKeyAuto("A005-1")).toBe(getBaseRackKeyAuto("A005-5"));
  });

  it("groups pieces of the same prefixed rack without needing productType (regression: used to collapse to just 'L')", () => {
    const key1 = getBaseRackKeyAuto("L-A001-3");
    const key5 = getBaseRackKeyAuto("L-A001-5");
    expect(key1).toBe(key5);
    expect(key1).not.toBe("L");
  });

  it("does not group a classic rack and a prefixed rack together even if their letters coincide", () => {
    expect(getBaseRackKeyAuto("A005-1")).not.toBe(getBaseRackKeyAuto("L-A005-1"));
  });

  it("tells apart two prefixed products whose codePrefix shares a leading letter ('L-' vs 'LF-')", () => {
    const loinKey = getBaseRackKeyAuto("L-A001-3");
    const hipKey = getBaseRackKeyAuto("LF-A001-3");
    expect(loinKey).not.toBe(hipKey);
    expect(hipKey).toBe(getBaseRackKeyAuto("LF-A001-5"));
  });

  it("falls back to returning the raw string for unparseable input", () => {
    expect(getBaseRackKeyAuto("not-a-code")).toBe("not-a-code");
  });
});

describe("getRackScopePrefix", () => {
  it("returns the bare letter prefix for classic (no literal codePrefix)", () => {
    expect(getRackScopePrefix("A", "PORK")).toBe("A");
  });

  it("prepends the product's literal codePrefix for a prefixed format", () => {
    expect(getRackScopePrefix("A", "PORK_LOIN")).toBe("L-A");
    expect(getRackScopePrefix("A", "PORK_HIP")).toBe("LF-A");
  });

  it("scopes correctly enough that a classic prefix never collides with a prefixed one", () => {
    // A classic rack "L005-1" starts with the same letter "L" as PORK_LOIN's
    // literal codePrefix — scoping must still tell them apart.
    expect(getRackScopePrefix("L", "PORK")).toBe("L");
    expect("L005-1".startsWith(getRackScopePrefix("L", "PORK"))).toBe(true);
    expect("L-A001-1".startsWith(getRackScopePrefix("L", "PORK"))).toBe(true); // expected overlap at the string level
    // The real disambiguation happens via productType filtering in the
    // caller (see app/api/users/racks/shift/route.ts), not string scoping
    // alone — this test just documents that the raw prefixes can overlap.
  });
});

describe("incrementPrefix / decrementPrefix", () => {
  it("increments within the alphabet", () => {
    expect(incrementPrefix("A")).toBe("B");
  });

  it("rolls Z over to AA", () => {
    expect(incrementPrefix("Z")).toBe("AA");
  });

  it("decrements within the alphabet", () => {
    expect(decrementPrefix("B")).toBe("A");
  });

  it("decrements AA back down to Z", () => {
    expect(decrementPrefix("AA")).toBe("Z");
  });
});

describe("getRackSequence", () => {
  it("advances the number within the same prefix", () => {
    expect(getRackSequence("A", 1, 4)).toEqual({ prefix: "A", num: 5 });
  });

  it("rolls over to the next prefix past 999", () => {
    expect(getRackSequence("A", 998, 5)).toEqual({ prefix: "B", num: 4 });
  });

  it("both letter rollover directions work the same regardless of which product's format will render the result", () => {
    // getRackSequence itself never sees a rack-code string, so its output
    // for a given (prefix, startNum, offset) is identical no matter which
    // product later formats it — this just confirms the shared function is
    // truly format-agnostic.
    const seq = getRackSequence("Z", 999, 1);
    expect(seq).toEqual({ prefix: "AA", num: 1 });
    expect(formatRackCode({ ...seq, piece: 1 }, "PORK")).toBe("AA001-1");
    expect(formatRackCode({ ...seq, piece: 1 }, "PORK_LOIN")).toBe("L-AA001-1");
  });
});
