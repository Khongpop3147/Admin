// Whether to show the small pet mascot on /orders (components/PetCorner.tsx)
// — a personal, per-browser preference, not business data, so localStorage
// is enough; no API/DB round-trip needed. Defaults to shown.
const KEY = "petCornerEnabled";

export function getPetCornerEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(KEY) !== "0";
}

export function setPetCornerEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, enabled ? "1" : "0");
}
