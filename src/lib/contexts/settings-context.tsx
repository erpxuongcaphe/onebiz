"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

// --- Settings shape ---

export interface AppSettings {
  // Cửa hàng (store)
  store: {
    name: string;
    phone: string;
    email: string;
    address: string;
    taxCode: string;
    businessType: string;
    foundingDate: string;
  };
  // Giao diện (appearance)
  appearance: {
    theme: "light" | "dark" | "system";
    accentColor: string;
    navLayout: "horizontal" | "vertical";
    fontSize: "small" | "medium" | "large";
    borderRadius: "none" | "sm" | "md" | "lg";
  };
  // Bán hàng (sales)
  sales: {
    allowSellOutOfStock: boolean;
    requireCustomer: boolean;
    autoPrintInvoice: boolean;
    showCostOnPos: boolean;
    discountType: "percent" | "fixed";
    maxDiscount: number;
    paymentMethods: {
      cash: boolean;
      transfer: boolean;
      card: boolean;
      ewallet: boolean;
    };
  };
  // Hóa đơn (invoice)
  invoice: {
    prefix: string;
    autoNumber: boolean;
    showLogo: boolean;
    showSignature: boolean;
    note: string;
  };
  // In ấn (print)
  print: {
    paperSize: "58mm" | "80mm" | "A4" | "A5";
    showStoreName: boolean;
    showStoreAddress: boolean;
    showStorePhone: boolean;
    showBarcode: boolean;
    showQr: boolean;
    copies: number;
  };
  // Giao hàng (delivery)
  delivery: {
    defaultFee: number;
    freeShippingThreshold: number;
    allowCod: boolean;
    codFee: number;
  };
  // Thanh toán (payment)
  payment: {
    bankName: string;
    bankAccount: string;
    bankHolder: string;
    momoPhone: string;
    vnpayEnabled: boolean;
  };
  // Thông báo (notification)
  notification: {
    orderNew: boolean;
    orderCompleted: boolean;
    stockLow: boolean;
    stockLowThreshold: number;
    customerNew: boolean;
    paymentReceived: boolean;
    emailNotify: boolean;
    soundEnabled: boolean;
  };
  // Ngôn ngữ (language)
  language: {
    locale: "vi" | "en";
    currency: "VND" | "USD";
    dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
    timezone: string;
  };
}

// --- Defaults ---

const defaultSettings: AppSettings = {
  store: {
    name: "OneBiz Shop HCM",
    phone: "0909 123 456",
    email: "contact@onebiz.vn",
    address: "123 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP.HCM",
    taxCode: "0312345678",
    businessType: "retail",
    foundingDate: "2020-01-15",
  },
  appearance: {
    theme: "light",
    accentColor: "blue",
    navLayout: "horizontal",
    fontSize: "medium",
    borderRadius: "md",
  },
  sales: {
    allowSellOutOfStock: false,
    requireCustomer: false,
    autoPrintInvoice: true,
    showCostOnPos: false,
    discountType: "percent",
    maxDiscount: 50,
    paymentMethods: {
      cash: true,
      transfer: true,
      card: true,
      ewallet: false,
    },
  },
  invoice: {
    prefix: "HD",
    autoNumber: true,
    showLogo: true,
    showSignature: false,
    note: "Cảm ơn quý khách!",
  },
  print: {
    paperSize: "80mm",
    showStoreName: true,
    showStoreAddress: true,
    showStorePhone: true,
    showBarcode: true,
    showQr: false,
    copies: 1,
  },
  delivery: {
    defaultFee: 30000,
    freeShippingThreshold: 500000,
    allowCod: true,
    codFee: 15000,
  },
  payment: {
    bankName: "Vietcombank",
    bankAccount: "1234567890",
    bankHolder: "NGUYEN VAN A",
    momoPhone: "0909123456",
    vnpayEnabled: false,
  },
  notification: {
    orderNew: true,
    orderCompleted: true,
    stockLow: true,
    stockLowThreshold: 10,
    customerNew: false,
    paymentReceived: true,
    emailNotify: false,
    soundEnabled: true,
  },
  language: {
    locale: "vi",
    currency: "VND",
    dateFormat: "DD/MM/YYYY",
    timezone: "Asia/Ho_Chi_Minh",
  },
};

// --- localStorage helpers ---

const STORAGE_KEY = "onebiz_settings";

function loadSettings(): AppSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);
    // Deep merge with defaults to handle new keys added later
    return deepMerge(defaultSettings, parsed) as AppSettings;
  } catch {
    return defaultSettings;
  }
}

function saveSettings(settings: AppSettings) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage quota exceeded or disabled - silently ignore
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// --- Context ---

interface SettingsContextValue {
  settings: AppSettings;
  /** Update a settings section. Automatically persists to localStorage. */
  updateSettings: <K extends keyof AppSettings>(
    section: K,
    values: Partial<AppSettings[K]>
  ) => void;
  /** Reset all settings to defaults */
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage on mount (client only)
  useEffect(() => {
    setSettings(loadSettings());
    setHydrated(true);
  }, []);

  // Persist on every change (after initial hydration)
  useEffect(() => {
    if (hydrated) {
      saveSettings(settings);
    }
  }, [settings, hydrated]);

  const updateSettings = useCallback(
    <K extends keyof AppSettings>(
      section: K,
      values: Partial<AppSettings[K]>
    ) => {
      setSettings((prev) => ({
        ...prev,
        [section]: { ...prev[section], ...values },
      }));
    },
    []
  );

  const resetSettings = useCallback(() => {
    setSettings(defaultSettings);
  }, []);

  return (
    <SettingsContext.Provider
      value={{ settings, updateSettings, resetSettings }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return ctx;
}

export { defaultSettings };
