import { getClient, getCurrentTenantId, handleError } from "./base";
import { currentUnitRules, recordedCountUnits, type StockReportUnits } from "@/lib/reports/stock-unit-context";
import type { UOMConversion } from "@/lib/types";

interface UnitQuery extends PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> {
  select(columns: string): UnitQuery;
  eq(column: string, value: unknown): UnitQuery;
  in(column: string, values: string[]): UnitQuery;
  order(column: string, options: { ascending: boolean }): UnitQuery;
  range(from: number, to: number): UnitQuery;
}
export interface StockUnitReference { referenceId: string; productId: string; actualQuantity: number }
export const stockUnitReferenceKey = (referenceId: string, productId: string) => `${referenceId}:${productId}`;

/** Read only IDs already returned by the authorized report; never scan all products. */
export async function getStockReportUnits(lines: StockUnitReference[], kind: "inventory_check" | "disposal" | "current_stock" = "inventory_check"): Promise<Map<string, StockReportUnits>> {
  const result = new Map<string, StockReportUnits>();
  if (!lines.length) return result;
  const tenant = await getCurrentTenantId();
  const from = getClient().from.bind(getClient()) as unknown as (table: string) => UnitQuery;
  async function read(table: string, columns: string, key: string, ids: string[], snapshot = false) {
    const rows: Record<string, unknown>[] = [];
    const unique = [...new Set(ids.filter(Boolean))];
    for (let start = 0; start < unique.length; start += 100) for (let offset = 0; ; offset += 500) {
      let query = from(table).select(columns).eq("tenant_id", tenant).in(key, unique.slice(start, start + 100));
      if (snapshot) query = query.eq("reference_type", kind).order("created_at", { ascending: false }).order("request_id", { ascending: false });
      else query = query.order("id", { ascending: true });
      const { data, error } = await query.range(offset, offset + 499);
      if (error) handleError(error, "getStockReportUnits");
      rows.push(...(data ?? []));
      if (!data || data.length < 500) break;
    }
    return rows;
  }
  const [products, conversions, snapshots] = await Promise.all([
    read("products_scoped", "id,code,unit", "id", lines.map(line => line.productId)),
    read("uom_conversions", "id,product_id,from_unit,to_unit,factor,is_active", "product_id", lines.map(line => line.productId)),
    kind === "current_stock" ? Promise.resolve([]) : read("operational_uom_requests", "reference_id,snapshots", "reference_id", lines.map(line => line.referenceId), true),
  ]);
  const productMap = new Map(products.map(row => [String(row.id), row]));
  const conversionMap = new Map<string, UOMConversion[]>();
  for (const row of conversions) {
    const id = String(row.product_id);
    const list = conversionMap.get(id) ?? [];
    list.push({ id: String(row.id), productId: id, fromUnit: String(row.from_unit ?? ""), toUnit: String(row.to_unit ?? ""), factor: Number(row.factor), isActive: row.is_active === true, tenantId: tenant, createdAt: "" });
    conversionMap.set(id, list);
  }
  const snapshotMap = new Map<string, Record<string, unknown>>();
  for (const entry of snapshots) if (Array.isArray(entry.snapshots)) for (const value of entry.snapshots) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const key = stockUnitReferenceKey(String(entry.reference_id), String(row.productId));
    if (!snapshotMap.has(key)) snapshotMap.set(key, row);
  }
  for (const line of lines) {
    const key = stockUnitReferenceKey(line.referenceId, line.productId);
    const product = productMap.get(line.productId);
    const snapshot = snapshotMap.get(key);
    const unit = typeof product?.unit === "string" ? product.unit.trim() : "";
    const choices = conversionMap.get(line.productId) ?? [];
    result.set(key, {
      productCode: typeof snapshot?.productCode === "string" ? snapshot.productCode : typeof product?.code === "string" ? product.code : null,
      catalogUnit: unit || null,
      currentConversion: currentUnitRules(unit, choices) || (choices.some(choice => choice.isActive) ? "Quy đổi cần kiểm tra" : "Chưa có quy đổi phụ"),
      ...recordedCountUnits(snapshot, line.actualQuantity),
      ...(kind === "current_stock" ? { recordedUnit: unit || null } : {}),
    });
  }
  return result;
}
