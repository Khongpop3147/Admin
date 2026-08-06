export interface ParsedAddress {
  phone: string;
  zip: string;
  address: string;
}

// Pulls a Thai phone number and postal code out of a free-text address
// field, returning what's left as the cleaned address. Extracted verbatim
// from the Postone export (Packing page) so both that export and any other
// shipping-label export share identical parsing.
export function parseAddressBlock(rawAddress: string | null | undefined): ParsedAddress {
  let phone = "";
  let zip = "";
  let address = rawAddress || "";

  // Smart extraction for Phone (Thai mobile = 10 digits, landline = 9 digits,
  // optionally dash-grouped e.g. 081-234-5678). Deliberately does NOT treat a
  // plain space as a separator between digits — otherwise this can "reach
  // across" a space into an adjacent zip code and swallow part of it (e.g.
  // "...10110 021234567" would misread as one 10-digit phone number starting
  // from the zip's last digit, corrupting both fields). \b keeps it from
  // matching inside a longer digit run too.
  const phoneRaw = address.match(/\b0[\d-]{7,11}\d\b/);
  if (phoneRaw) {
    const digitsOnly = phoneRaw[0].replace(/-/g, "");
    if (digitsOnly.length === 9 || digitsOnly.length === 10) {
      phone = digitsOnly;
      address = address.replace(phoneRaw[0], "").trim();
    }
  }

  // Smart extraction for Zip code (5-digit standalone token, checked after
  // the phone is already removed so it can't be confused with it)
  const zipMatch = address.match(/\b\d{5}\b/);
  if (zipMatch) {
    zip = zipMatch[0];
    address = address.replace(zipMatch[0], "").trim();
  }

  // Remove "ที่อยู่ :" or similar prefixes at the start
  address = address.replace(/^ที่อยู่\s*:\s*/, "").replace(/^ที่อยู่\s*/, "");

  // Remove "เบอร์โทร :" or similar text anywhere
  address = address.replace(/เบอร์โทร\s*:\s*/g, "")
                   .replace(/เบอร์โทร\s*/g, "")
                   .replace(/เบอร์\s*:\s*/g, "")
                   .replace(/เบอร์\s*/g, "")
                   .replace(/โทร\s*:\s*/g, "")
                   .replace(/โทร\s*/g, "");

  // Clean up stray characters at the end (like trailing colons or dashes)
  address = address.replace(/[\s:,.-]+$/, "").trim();

  return { phone, zip, address };
}
