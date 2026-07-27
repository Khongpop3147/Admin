"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "../components/UserProvider";

export default function Home() {
  const { currentUser } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.role === "SUPER_ADMIN") {
      router.replace("/dashboard");
    } else if (currentUser.role === "PACKING") {
      router.replace("/packing");
    } else {
      router.replace("/orders");
    }
  }, [currentUser, router]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: "60vh", color: "var(--text-secondary)", fontSize: "14px" }}>
      กำลังโหลด...
    </div>
  );
}
