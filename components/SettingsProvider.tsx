"use client";

import { createContext, useContext, useState, useEffect } from "react";

export interface AppSettings {
  commissionRate: number;
  returnPenalty: number;
  codFlatFeeThreshold: number;
  codFlatFee: number;
  codDivisor: number;
  codMultiplier: number;
  porkPricePerKg: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  commissionRate: 0.2,
  returnPenalty: 50,
  codFlatFeeThreshold: 2.29,
  codFlatFee: 50,
  codDivisor: 1.5,
  codMultiplier: 20,
  porkPricePerKg: 250,
};

interface SettingsContextType {
  settings: AppSettings;
  fetchSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function calculateCodAmount(weight: number, settings: AppSettings): number {
  if (weight <= settings.codFlatFeeThreshold) return settings.codFlatFee;
  return (weight / settings.codDivisor) * settings.codMultiplier;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
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
