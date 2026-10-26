import { searchOptions } from "@/lib/search-options";
export interface PurchaseForecastSearchableRow {
  code: string;
  name: string;
}

export function normalizePurchaseForecastQuery(query: string): string {
  return query.trim().toLocaleLowerCase("vi");
}

export function filterPurchaseForecastRows<
  T extends PurchaseForecastSearchableRow,
>(rows: T[], query: string): T[] {
  const normalized = normalizePurchaseForecastQuery(query);
  if (!normalized) return rows;

  return searchOptions(rows, query, row => ({name: row.name, identifiers: [row.code]})).map(result => result.item);
}
