"use client";

import { createContext, useContext, useState, useEffect } from "react";

export interface User {
  id: string;
  name: string;
  role: string;
  racks: { id: string; rackNo: string; userId: string }[];
}

interface UserContextType {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  users: User[];
  fetchUsers: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      if (data.users) {
        setUsers(data.users);
        
        setCurrentUser(prev => {
          if (!prev) {
            return data.users.find((u: User) => u.id === "user-super-admin") || data.users[0];
          }
          return data.users.find((u: User) => u.id === prev.id) || prev;
        });
      }
    } catch (e) {
      console.error("Failed to fetch users", e);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  return (
    <UserContext.Provider value={{ currentUser, setCurrentUser, users, fetchUsers }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) throw new Error("useUser must be used within a UserProvider");
  return context;
}
