export type FnbTender = "cash" | "transfer" | "card";
export type FnbMethodPreferences = Record<FnbTender, boolean>;
export const DEFAULT_FNB_METHODS: FnbMethodPreferences = { cash: true, transfer: true, card: true };
export const FNB_TENDERS = ["cash", "transfer", "card"] as const;
export function normalizeFnbMethods(value: unknown): FnbMethodPreferences {
  if (!value || typeof value !== "object") return { ...DEFAULT_FNB_METHODS };
  const raw = value as Record<string, unknown>;
  const result = Object.fromEntries(FNB_TENDERS.map(key => [key, typeof raw[key] === "boolean" ? raw[key] : true])) as FnbMethodPreferences;
  if (!FNB_TENDERS.some(key => result[key])) throw new Error("Cần bật ít nhất một phương thức thanh toán.");
  return result;
}
export function availableFnbMethods(value: FnbMethodPreferences): (FnbTender | "mixed")[] {
  const tenders = FNB_TENDERS.filter(key => value[key]);
  return tenders.length > 1 ? [...tenders, "mixed"] : tenders;
}
