import { describe, it, expect } from "vitest";
import { isSuperAdminRole } from "./roles";

describe("isSuperAdminRole", () => {
  it("treats SUPER_ADMIN and the hidden DEV role as super-admin", () => {
    expect(isSuperAdminRole("SUPER_ADMIN")).toBe(true);
    expect(isSuperAdminRole("DEV")).toBe(true);
  });

  it("rejects every other role", () => {
    expect(isSuperAdminRole("ADMIN")).toBe(false);
    expect(isSuperAdminRole("PACKING")).toBe(false);
    expect(isSuperAdminRole("CENTRAL_INVENTORY")).toBe(false);
  });

  it("rejects missing/empty roles", () => {
    expect(isSuperAdminRole(undefined)).toBe(false);
    expect(isSuperAdminRole(null)).toBe(false);
    expect(isSuperAdminRole("")).toBe(false);
  });
});
