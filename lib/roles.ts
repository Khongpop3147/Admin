// "DEV" is a hidden super-role for the person who built this app — it behaves
// like SUPER_ADMIN everywhere, but Super Admin can never grant/revoke it via
// the UI or API (see ALLOWED_ROLES in the users API routes). It can only be
// set directly in the database by whoever has DB access.
export function isSuperAdminRole(role?: string | null): boolean {
  return role === "SUPER_ADMIN" || role === "DEV";
}
