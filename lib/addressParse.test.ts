import { describe, it, expect } from "vitest";
import { parseAddressBlock, isValidPhone, isValidZip, getShippingContact } from "./addressParse";

describe("parseAddressBlock", () => {
  it("extracts a 10-digit mobile number and a 5-digit zip, cleaning the address", () => {
    const result = parseAddressBlock("301/110 หมู่บ้านจิตต์อารีย์ ต.พิชัย อ.เมือง จ.ลำปาง 52000 0642396529");
    expect(result.phone).toBe("0642396529");
    expect(result.zip).toBe("52000");
    expect(result.address).toBe("301/110 หมู่บ้านจิตต์อารีย์ ต.พิชัย อ.เมือง จ.ลำปาง");
  });

  it("handles a dash-grouped phone number", () => {
    const result = parseAddressBlock("บ้านเลขที่ 1 ถ.สุขุมวิท 064-239-6529 10110");
    expect(result.phone).toBe("0642396529");
    expect(result.zip).toBe("10110");
  });

  it("accepts a 9-digit landline number", () => {
    const result = parseAddressBlock("บ้านเลขที่ 1 02-123-4567 10110");
    expect(result.phone).toBe("021234567");
  });

  it("does not let the phone regex swallow part of an adjacent zip code across a space", () => {
    // Regression: "...10110 021234567" must not be misread as one long
    // digit run bridging the space.
    const result = parseAddressBlock("บ้านเลขที่ 1 10110 021234567");
    expect(result.phone).toBe("021234567");
    expect(result.zip).toBe("10110");
  });

  it("strips a leading 'ที่อยู่' label", () => {
    const result = parseAddressBlock("ที่อยู่ : 123 ถนนสุขุมวิท กรุงเทพ 10110");
    expect(result.address).toBe("123 ถนนสุขุมวิท กรุงเทพ");
  });

  it("strips 'เบอร์โทร'/'เบอร์'/'โทร' labels anywhere in the text", () => {
    const result = parseAddressBlock("123 ถนนสุขุมวิท เบอร์โทร: 0812345678 กรุงเทพ");
    expect(result.address).not.toMatch(/เบอร์โทร/);
    expect(result.phone).toBe("0812345678");
  });

  it("trims trailing stray punctuation left after stripping", () => {
    const result = parseAddressBlock("123 ถนนสุขุมวิท -");
    expect(result.address).toBe("123 ถนนสุขุมวิท");
  });

  it("returns empty phone/zip when none are present, address unchanged aside from trimming", () => {
    const result = parseAddressBlock("บ้านไม่มีเลขที่ ปากซอย 3");
    expect(result.phone).toBe("");
    expect(result.zip).toBe("");
    expect(result.address).toBe("บ้านไม่มีเลขที่ ปากซอย 3");
  });

  it("handles null/undefined/empty input gracefully", () => {
    expect(parseAddressBlock(null)).toEqual({ phone: "", zip: "", address: "" });
    expect(parseAddressBlock(undefined)).toEqual({ phone: "", zip: "", address: "" });
    expect(parseAddressBlock("")).toEqual({ phone: "", zip: "", address: "" });
  });
});

describe("isValidPhone", () => {
  it("accepts exactly 10 digits", () => {
    expect(isValidPhone("0812345678")).toBe(true);
  });

  it("rejects anything other than exactly 10 digits", () => {
    expect(isValidPhone("081234567")).toBe(false);
    expect(isValidPhone("08123456789")).toBe(false);
    expect(isValidPhone("")).toBe(false);
    expect(isValidPhone(null)).toBe(false);
    expect(isValidPhone(undefined)).toBe(false);
    expect(isValidPhone("081-234-5678")).toBe(false);
    expect(isValidPhone("081234567a")).toBe(false);
  });
});

describe("isValidZip", () => {
  it("accepts exactly 5 digits", () => {
    expect(isValidZip("10110")).toBe(true);
  });

  it("rejects anything other than exactly 5 digits", () => {
    expect(isValidZip("1011")).toBe(false);
    expect(isValidZip("101100")).toBe(false);
    expect(isValidZip("")).toBe(false);
    expect(isValidZip(null)).toBe(false);
    expect(isValidZip(undefined)).toBe(false);
  });
});

describe("getShippingContact", () => {
  it("prefers explicit customerPhone/customerZip over parsing customerAddress", () => {
    const result = getShippingContact({
      customerAddress: "123 ถนนสุขุมวิท กรุงเทพ",
      customerPhone: "0812345678",
      customerZip: "10110",
    });
    expect(result).toEqual({ phone: "0812345678", zip: "10110", address: "123 ถนนสุขุมวิท กรุงเทพ" });
  });

  it("falls back to parsing customerAddress when explicit fields are missing (legacy orders)", () => {
    const result = getShippingContact({
      customerAddress: "301/110 หมู่บ้านจิตต์อารีย์ ต.พิชัย อ.เมือง จ.ลำปาง 52000 0642396529",
      customerPhone: null,
      customerZip: null,
    });
    expect(result).toEqual({
      phone: "0642396529",
      zip: "52000",
      address: "301/110 หมู่บ้านจิตต์อารีย์ ต.พิชัย อ.เมือง จ.ลำปาง",
    });
  });

  it("falls back to the regex-stripped address when only one explicit field is valid", () => {
    // customerZip is invalid (4 digits) -- since we can't fully trust
    // customerAddress is "clean," fall back to the stripped parse for both
    // the zip and the address text, even though the phone is valid.
    const result = getShippingContact({
      customerAddress: "123 ถนนสุขุมวิท กรุงเทพ 10110",
      customerPhone: "0812345678",
      customerZip: "9999",
    });
    expect(result.phone).toBe("0812345678");
    expect(result.zip).toBe("10110");
    expect(result.address).toBe("123 ถนนสุขุมวิท กรุงเทพ");
  });

  it("falls back to an empty phone/zip when neither explicit fields nor the address text have them", () => {
    const result = getShippingContact({ customerAddress: "บ้านไม่มีเลขที่ ปากซอย 3", customerPhone: null, customerZip: null });
    expect(result).toEqual({ phone: "", zip: "", address: "บ้านไม่มีเลขที่ ปากซอย 3" });
  });
});
