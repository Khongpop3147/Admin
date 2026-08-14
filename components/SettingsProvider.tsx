"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { BASE_PATH } from "../lib/basePath";
import { AppSettings, DEFAULT_SETTINGS } from "../lib/money";

export type { AppSettings };

interface SettingsContextType {
  settings: AppSettings;
  fetchSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/settings`);
      const data = await res.json();
      if (data.settings) {
        setSettings({
          commissionRate: data.settings.commissionRate,
          returnPenalty: data.settings.returnPenalty,
          codFlatFeeThreshold: data.settings.codFlatFeeThreshold,
          codFlatFee: data.settings.codFlatFee,
          codDivisor: data.settings.codDivisor,
          codMultiplier: data.settings.codMultiplier,
          porkPricePerKg: data.settings.porkPricePerKg,
          porkLoinPricePerKg: data.settings.porkLoinPricePerKg,
          porkHipPricePerKg: data.settings.porkHipPricePerKg,
        });
      }
    } catch (e) {
      console.error("Failed to fetch settings", e);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, fetchSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used within a SettingsProvider");
  return context;
}
