"use client";

import { createContext, useContext, useState, useEffect } from "react";

export interface User {
  id: string;
  name: string;
  role: string;
  hasPassword?: boolean;
  racks: { id: string; rackNo: string; userId: string; remainingWeight?: number; initialWeight?: number; isUsedUp?: boolean }[];
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
      const res = await fetch("/api/users");
      if (!res.ok) return;
      const data = await res.json();
      if (data.users) setUsers(data.users);
    } catch (e) {
      console.error("Failed to fetch users", e);
    }
  };

  const fetchSession = async () => {
    try {
      const res = await fetch("/api/auth/me");
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
    await fetch("/api/auth/logout", { method: "POST" });
    setSessionUserRaw(null);
    setOverrideUserId(null);
    window.location.href = "/login";
  };

  return (
    <UserContext.Provider value={{ currentUser, sessionUser, setCurrentUser, users, fetchUsers, isAuthLoading, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) throw new Error("useUser must be used within a UserProvider");
  return context;
}
