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

  return rows.filter(
    (row) =>
      row.code.toLocaleLowerCase("vi").includes(normalized) ||
      row.name.toLocaleLowerCase("vi").includes(normalized),
  );
}
