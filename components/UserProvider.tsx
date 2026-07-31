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
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const [overrideUser, setOverrideUser] = useState<User | null>(null);
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
        setSessionUser(data.user);
      } else {
        setSessionUser(null);
      }
    } catch (e) {
      setSessionUser(null);
    } finally {
      setIsAuthLoading(false);
    }
  };

  useEffect(() => {
    fetchSession();
  }, []);

  useEffect(() => {
    if (sessionUser) fetchUsers();
  }, [sessionUser]);

  const isDev = sessionUser?.role === "DEV";
  const currentUser = isDev && overrideUser ? overrideUser : sessionUser;

  const setCurrentUser = (user: User | null) => {
    if (isDev) setOverrideUser(user);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setSessionUser(null);
    setOverrideUser(null);
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
