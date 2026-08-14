// Single source of truth for rack-code parsing/formatting across every
// product. Rack codes used to be assumed classic-only ("A005-1") with the
// parsing regex duplicated inline at 15+ call sites across app/racks/page.tsx,
// lib/rackGaps.ts, and lib/rackShift.ts — adding a second product with its
// own code format ("L-A001-1", a literal prefix in front of the classic
// shape) meant every one of those needed to agree on the same parse/format
// rules, so they're centralized here instead.

export type RackFormat = "classic" | "prefixed";

export interface ProductTypeConfig {
  code: string;
  label: string;
  format: RackFormat;
  // Literal string prepended in front of the classic-style code, e.g. "L-"
  // turns "A001-1" into "L-A001-1". Only meaningful when format is "prefixed".
  codePrefix?: string;
}

// PORK = the original หมูกรอบ ("A005-1"). PORK_LOIN = หมูกรอบสันนอก and
// PORK_HIP = หมูกรอบสะโพก were added later — same classic numbering shape,
// just with a literal prefix stuck on the front ("L-"/"LF-") so their codes
// are visually unmistakable from the original product's, and from each
// other, at a glance.
export const PRODUCT_TYPES: Record<string, ProductTypeConfig> = {
  PORK: { code: "PORK", label: "หมูกรอบ", format: "classic" },
  PORK_LOIN: { code: "PORK_LOIN", label: "หมูกรอบสันนอก", format: "prefixed", codePrefix: "L-" },
  PORK_HIP: { code: "PORK_HIP", label: "หมูกรอบสะโพก", format: "prefixed", codePrefix: "LF-" },
};

export const DEFAULT_PRODUCT_TYPE = "PORK";

// Physical pieces per rack tray — a hardware constraint, not a per-product
// one, so it stays a single shared constant regardless of which product's
// code format is in play.
export const PIECES_PER_RACK = 5;

export function getProductFormat(productType?: string | null): RackFormat {
  return PRODUCT_TYPES[productType || DEFAULT_PRODUCT_TYPE]?.format ?? "classic";
}

function getCodePrefix(productType?: string | null): string {
  const config = PRODUCT_TYPES[productType || DEFAULT_PRODUCT_TYPE];
  return config?.format === "prefixed" ? config.codePrefix || "" : "";
}

export interface RackCodeParts {
  prefix: string; // letter portion only, e.g. "A"
  num: number;
  piece: number | null; // null for a bare rack code with no piece suffix
}

const CLASSIC_RE = /^([A-Za-z]+)(\d+)(?:-(\d+))?$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getParseRe(productType?: string | null): RegExp {
  const codePrefix = getCodePrefix(productType);
  return codePrefix ? new RegExp(`^${escapeRegExp(codePrefix)}([A-Za-z]+)(\\d+)(?:-(\\d+))?$`) : CLASSIC_RE;
}

// Parses BOTH "bare rack" (no piece, e.g. from a system-wide "highest code"
// scan) and "rack + piece" inputs — the piece capture group is optional in
// both regexes, so one function covers every caller.
export function parseRackCode(rackNo: string, productType?: string | null): RackCodeParts | null {
  const m = rackNo.match(getParseRe(productType));
  if (!m) return null;
  return {
    prefix: m[1],
    num: parseInt(m[2], 10),
    piece: m[3] !== undefined ? parseInt(m[3], 10) : null,
  };
}

export function formatRackCode(
  parts: { prefix: string; num: number; piece: number | string },
  productType?: string | null
): string {
  const numStr = String(parts.num).padStart(3, "0");
  return `${getCodePrefix(productType)}${parts.prefix}${numStr}-${parts.piece}`;
}

// Groups pieces that belong to the same physical rack (same prefix+num,
// different piece index) — used by "pick N racks worth of pieces"
// auto-select features. Replaces the old `rackNo.split('-')[0]`, which for
// a literal-prefixed format like "L-A001-1" would collapse every single
// piece down to just "L" (every piece of every rack sharing one bogus
// group) since the prefix itself contains a dash.
export function getBaseRackKey(rackNo: string, productType?: string | null): string {
  const parts = parseRackCode(rackNo, productType);
  if (!parts) return rackNo;
  const numStr = String(parts.num).padStart(3, "0");
  return `${getCodePrefix(productType)}${parts.prefix}${numStr}`;
}

// For callers that only have a bare rackNo with no productType in scope
// (e.g. rendering a mixed-product order's rack list) — detects the format
// from the string shape itself. A prefixed code always starts literally
// with its product's codePrefix ("L-", "LF-", ...); classic codes never
// contain a dash before the digits, so trying every prefixed format first is
// unambiguous. Longest codePrefix first so a prefix that's a literal string
// extension of another's (e.g. "LF-" starting with the same letter as "L-")
// never gets misparsed by the shorter one. Prefer getBaseRackKey(rackNo,
// productType) directly wherever productType IS already known.
export function getBaseRackKeyAuto(rackNo: string): string {
  const prefixedTypes = Object.keys(PRODUCT_TYPES)
    .filter((key) => PRODUCT_TYPES[key].format === "prefixed")
    .sort((a, b) => (PRODUCT_TYPES[b].codePrefix?.length || 0) - (PRODUCT_TYPES[a].codePrefix?.length || 0));
  for (const productType of prefixedTypes) {
    if (parseRackCode(rackNo, productType)) return getBaseRackKey(rackNo, productType);
  }
  return getBaseRackKey(rackNo, DEFAULT_PRODUCT_TYPE);
}

// The literal string every rack code for a given letter prefix + product
// starts with — e.g. "A" for classic PORK, "L-A" for PORK_LOIN — used to
// scope a `startsWith` DB query to just that rack's pieces (see
// app/api/users/racks/shift/route.ts) without also matching an unrelated
// product/prefix combination.
export function getRackScopePrefix(letterPrefix: string, productType?: string | null): string {
  return `${getCodePrefix(productType)}${letterPrefix}`;
}

// --- Letter-prefix base-26 arithmetic, moved unchanged from app/racks/page.tsx ---
// Format-agnostic: operates on the abstract letter prefix only, so it's
// shared by both products' code generators as-is.

export function incrementPrefix(prefix: string): string {
  if (!prefix) return "A";
  const match = prefix.match(/([a-zA-Z]+)$/);
  if (!match) return prefix + "A";

  const letters = match[1];
  let newLetters = "";
  let carry = true;

  for (let i = letters.length - 1; i >= 0; i--) {
    if (!carry) {
      newLetters = letters[i] + newLetters;
      continue;
    }
    const charCode = letters.charCodeAt(i);
    if (charCode === 90) {
      // 'Z'
      newLetters = "A" + newLetters;
      carry = true;
    } else if (charCode === 122) {
      // 'z'
      newLetters = "a" + newLetters;
      carry = true;
    } else {
      newLetters = String.fromCharCode(charCode + 1) + newLetters;
      carry = false;
    }
  }
  if (carry) {
    const isUpper = letters[0] === letters[0].toUpperCase();
    newLetters = (isUpper ? "A" : "a") + newLetters;
  }
  return prefix.slice(0, prefix.length - letters.length) + newLetters;
}

export function decrementPrefix(prefix: string): string {
  if (!prefix) return "A";
  const match = prefix.match(/([a-zA-Z]+)$/);
  if (!match) return prefix;

  const letters = match[1];
  let newLetters = "";
  let borrow = true;

  for (let i = letters.length - 1; i >= 0; i--) {
    if (!borrow) {
      newLetters = letters[i] + newLetters;
      continue;
    }
    const charCode = letters.charCodeAt(i);
    if (charCode === 65) {
      // 'A'
      newLetters = "Z" + newLetters;
      borrow = true;
    } else if (charCode === 97) {
      // 'a'
      newLetters = "z" + newLetters;
      borrow = true;
    } else {
      newLetters = String.fromCharCode(charCode - 1) + newLetters;
      borrow = false;
    }
  }
  if (borrow && letters.length > 1) {
    newLetters = newLetters.slice(1);
  }
  return prefix.slice(0, prefix.length - letters.length) + newLetters;
}

export function getRackSequence(
  basePrefix: string,
  baseStartNum: number,
  rackOffset: number
): { prefix: string; num: number } {
  let num = baseStartNum + rackOffset;
  let pfx = basePrefix;

  while (num > 999) {
    num -= 999;
    pfx = incrementPrefix(pfx);
  }
  while (num <= 0 && baseStartNum > 0) {
    // There's no prefix before "A" — clamp here instead of letting
    // decrementPrefix wrap it around to "Z" (that produced racks like
    // Z999 out of nowhere when someone dialed the start number too low).
    if (pfx === "A" || pfx === "a") {
      num = 1;
      break;
    }
    num += 999;
    pfx = decrementPrefix(pfx);
  }
  return { prefix: pfx, num: Math.max(num, 0) };
}
