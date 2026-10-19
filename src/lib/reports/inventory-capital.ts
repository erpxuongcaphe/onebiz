import type { XntRow } from "@/lib/services/supabase/xnt-report";
import { XNT_MOVEMENT_BUCKETS, XNT_VALUE_GROUPS } from "./xnt-unit-values";
import { sortReportRows } from "./table-sort";

export const INVENTORY_REVIEW_LABELS = {
  all: "Tất cả kiểm tra", negative: "Tồn cuối âm", missing: "Thiếu giá trị cuối kỳ",
  noOut: "Còn tồn, chưa xuất trong kỳ", mismatch: "Lệch cân đối nhập xuất tồn",
};
export type InventoryReview = keyof typeof INVENTORY_REVIEW_LABELS;
export const INVENTORY_METRIC_FIELDS = [
  ...XNT_VALUE_GROUPS.flatMap(group => [{ key: group.quantity, label: `${group.label} · Số lượng` }, { key: group.price, label: `${group.label} · Đơn giá BQ` }, { key: group.value, label: `${group.label} · Thành tiền` }]),
  ...XNT_MOVEMENT_BUCKETS.flatMap(bucket => [{ key: bucket.key, label: `${bucket.label} · Số lượng` }, { key: `${bucket.key}UnitValue`, label: `${bucket.label} · Đơn giá BQ` }, { key: `${bucket.key}Value`, label: `${bucket.label} · Thành tiền` }]),
];
export function inventoryBalance(row: XntRow) {
  const quantityDifference = row.openingQty + row.totalIn - row.totalOut - row.closingQty;
  const valueDifference = row.openingValue === null || row.inValue === null || row.outValue === null || row.closingValue === null ? null : row.openingValue + row.inValue - row.outValue - row.closingValue;
  return { quantityDifference, valueDifference, mismatch: Math.abs(quantityDifference) > 1e-7 || (valueDifference !== null && Math.abs(valueDifference) >= 0.01) };
}
export function matchesInventoryReview(row: XntRow, review: InventoryReview) {
  return review === "all" || (review === "negative" && row.closingQty < -1e-9) || (review === "missing" && row.closingValue === null) ||
    (review === "noOut" && row.closingQty > 1e-9 && Math.abs(row.totalOut) < 1e-9) || (review === "mismatch" && inventoryBalance(row).mismatch);
}
export function inventoryCapitalSummary(rows: XntRow[]) {
  const missing = rows.filter(row => row.closingValue === null).length;
  const knownClosingValue = rows.reduce((sum, row) => sum + (row.closingValue ?? 0), 0);
  const noOut = rows.filter(row => matchesInventoryReview(row, "noOut"));
  return { products: rows.length, closingValue: missing ? null : knownClosingValue, knownClosingValue, missing,
    negative: rows.filter(row => matchesInventoryReview(row, "negative")).length,
    mismatch: rows.filter(row => matchesInventoryReview(row, "mismatch")).length,
    noOut: noOut.length, noOutValue: noOut.some(row => row.closingValue === null) ? null : noOut.reduce((sum, row) => sum + (row.closingValue ?? 0), 0) };
}
export function inventoryCapitalCategories(rows: XntRow[], sort: { id: string; direction: "asc" | "desc" } | null = null) {
  const groups = new Map<string, XntRow[]>();
  for (const row of rows) {
    const key = row.categoryName ?? "";
    const group = groups.get(key) ?? [];
    group.push(row); groups.set(key, group);
  }
  const result = [...groups].map(([category, entries]) => ({ category: category || "Chưa phân nhóm", ...inventoryCapitalSummary(entries) }));
  return sort ? sortReportRows(result, row => row[sort.id as keyof typeof row], sort.direction) : result;
}
export function inventoryReviewExportRows(rows: XntRow[]) {
  return rows.map(row => ({ code: row.code, name: row.name, category: row.categoryName ?? "Chưa phân nhóm", unit: row.unit,
    closingQty: row.closingQty, closingValue: row.closingValue,
    negative: matchesInventoryReview(row, "negative") ? "Có" : "", missing: row.closingValue === null ? "Có" : "",
    noOut: matchesInventoryReview(row, "noOut") ? "Có" : "", ...inventoryBalance(row),
  }));
}
