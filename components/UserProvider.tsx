"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { BASE_PATH } from "../lib/basePath";

export interface User {
  id: string;
  name: string;
  nickname?: string | null;
  defaultPlatform?: string | null;
  themePreference?: string | null;
  themeMode?: string | null;
  role: string;
  canAccessStorefront?: boolean;
  hasPassword?: boolean;
  racks: { id: string; rackNo: string; userId: string; remainingWeight?: number; initialWeight?: number; isUsedUp?: boolean; productType?: string }[];
}

interface UserContextType {
  // The identity the rest of the app should act as. Equal to sessionUser for
  // everyone except DEV, who can locally override it via the Sidebar
  // switcher — a convenience for testing as another role without a second
  // login. Server-side authorization always trusts the real session, never
  // this override.
  currentUser: User | null;
  // The real logged-in identity from the session cookie.
  sessionUser: User | null;
  setCurrentUser: (user: User | null) => void;
  users: User[];
  fetchUsers: () => Promise<void>;
  isAuthLoading: boolean;
  logout: () => Promise<void>;
  // Sets the REAL logged-in user's own accent-color preset (see
  // PATCH /api/users/me/theme) — self-service, unlike defaultPlatform which
  // only a Super Admin can set for someone else via /users. `null` clears
  // back to the default (blue) theme.
  setTheme: (theme: string | null) => Promise<void>;
  // Same self-service mechanism, independent axis — light/dark instead of
  // accent color. `null` clears back to the default (dark) mode.
  setThemeMode: (mode: string | null) => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [sessionUserRaw, setSessionUserRaw] = useState<User | null>(null);
  // Just the id, not the whole User object — the object itself is derived
  // fresh from `users` below every render (same reasoning as sessionUser:
  // storing a frozen snapshot here would go stale the same way sessionUser
  // used to, since fetchUsers() keeps `users` current but would never touch
  // a separately-held override object).
  const [overrideUserId, setOverrideUserId] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/users`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.users) setUsers(data.users);
    } catch (e) {
      console.error("Failed to fetch users", e);
    }
  };

  const fetchSession = async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/auth/me`);
      if (res.ok) {
        const data = await res.json();
        setSessionUserRaw(data.user);
      } else {
        setSessionUserRaw(null);
      }
    } catch (e) {
      setSessionUserRaw(null);
    } finally {
      setIsAuthLoading(false);
    }
  };

  useEffect(() => {
    fetchSession();
  }, []);

  useEffect(() => {
    if (sessionUserRaw) fetchUsers();
  }, [sessionUserRaw]);

  // /api/auth/me only runs once at login — its snapshot of racks goes stale
  // the moment any order is placed. `users` gets refreshed constantly
  // (fetchUsers() runs after every order/rack change across the app), so
  // once it's loaded, prefer that copy of the logged-in user over the frozen
  // one from the session fetch. Falls back to the raw snapshot before
  // fetchUsers has resolved for the first time.
  const sessionUser = sessionUserRaw
    ? users.find((u) => u.id === sessionUserRaw.id) || sessionUserRaw
    : null;

  const isDev = sessionUser?.role === "DEV";
  const overrideUser = overrideUserId ? users.find((u) => u.id === overrideUserId) || null : null;
  const currentUser = isDev && overrideUser ? overrideUser : sessionUser;

  const setCurrentUser = (user: User | null) => {
    if (isDev) setOverrideUserId(user?.id ?? null);
  };

  const logout = async () => {
    await fetch(`${BASE_PATH}/api/auth/logout`, { method: "POST" });
    setSessionUserRaw(null);
    setOverrideUserId(null);
    window.location.href = `${BASE_PATH}/login`;
  };

  // Applied off sessionUser (the real login), not currentUser — unlike
  // defaultPlatform (a form default that makes sense to preview per
  // identity), an accent theme/mode is a personal display preference tied
  // to who is actually authenticated, so a DEV previewing as someone else
  // still sees their own look rather than the previewed user's.
  useEffect(() => {
    const theme = sessionUser?.themePreference;
    if (theme) {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, [sessionUser?.themePreference]);

  useEffect(() => {
    const mode = sessionUser?.themeMode;
    if (mode === "light") {
      document.documentElement.setAttribute("data-mode", "light");
    } else {
      document.documentElement.removeAttribute("data-mode");
    }
  }, [sessionUser?.themeMode]);

  const setTheme = async (theme: string | null) => {
    // Optimistic — flips the attribute immediately rather than waiting on
    // the round trip, then reconciles once fetchUsers picks up the real
    // saved value (or reverts it if the request ends up failing).
    if (theme) {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try {
      const res = await fetch(`${BASE_PATH}/api/users/me/theme`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme }),
      });
      if (res.ok) {
        await fetchUsers();
      }
    } catch (e) {
      console.error("Failed to save theme preference", e);
    }
  };

  const setThemeMode = async (mode: string | null) => {
    if (mode === "light") {
      document.documentElement.setAttribute("data-mode", "light");
    } else {
      document.documentElement.removeAttribute("data-mode");
    }
    try {
      const res = await fetch(`${BASE_PATH}/api/users/me/theme`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        await fetchUsers();
      }
    } catch (e) {
      console.error("Failed to save theme mode", e);
    }
  };

  return (
    <UserContext.Provider value={{ currentUser, sessionUser, setCurrentUser, users, fetchUsers, isAuthLoading, logout, setTheme, setThemeMode }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) throw new Error("useUser must be used within a UserProvider");
  return context;
}
