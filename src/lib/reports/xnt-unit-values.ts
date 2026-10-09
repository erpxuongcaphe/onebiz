import type { XntRow } from "@/lib/services/supabase/xnt-report";

export function historicalUnitValue(quantity: number, value: number | null): number | null {
  if (!Number.isFinite(quantity) || Math.abs(quantity) < 1e-9 || value === null || !Number.isFinite(value)) return null;
  return value / quantity;
}

export function withXntUnitValues(row: XntRow) {
  const details = Object.fromEntries(XNT_MOVEMENT_BUCKETS.flatMap(({ key }) => {
    const amount = Object.hasOwn(row.movementValues ?? {}, key) ? row.movementValues![key] : row[key] === 0 ? 0 : null;
    return [[`${key}Value`, amount], [`${key}UnitValue`, historicalUnitValue(row[key], amount)]];
  })) as Record<`${XntMovementBucket}Value` | `${XntMovementBucket}UnitValue`, number | null>;
  return {
    ...row,
    ...details,
    openingUnitValue: historicalUnitValue(row.openingQty, row.openingValue),
    inUnitValue: historicalUnitValue(row.totalIn, row.inValue),
    outUnitValue: historicalUnitValue(row.totalOut, row.outValue),
    closingUnitValue: historicalUnitValue(row.closingQty, row.closingValue),
  };
}

export type XntValuedRow = ReturnType<typeof withXntUnitValues>;

export const XNT_MOVEMENT_BUCKETS = [
  { key: "inSupplier", label: "Nhập từ NCC" }, { key: "inCheck", label: "Kiểm kê (+)" },
  { key: "inReturn", label: "Khách trả / hoàn nhập" }, { key: "inTransfer", label: "Chuyển đến" },
  { key: "inProduction", label: "Sản xuất nhập" }, { key: "inOther", label: "Nhập khác" },
  { key: "outSale", label: "Bán hàng / BOM" }, { key: "outDisposal", label: "Xuất hủy" },
  { key: "outSupplierReturn", label: "Trả NCC" }, { key: "outCheck", label: "Kiểm kê (-)" },
  { key: "outTransfer", label: "Chuyển đi" }, { key: "outProduction", label: "Sản xuất xuất" },
  { key: "outInternal", label: "Xuất nội bộ" }, { key: "outOther", label: "Xuất khác" },
] as const;
export type XntMovementBucket = typeof XNT_MOVEMENT_BUCKETS[number]["key"];

export function xntMovementValueTotals(rows: XntValuedRow[]) {
  return Object.fromEntries(XNT_MOVEMENT_BUCKETS.map(({ key }) => {
    const valueKey = `${key}Value` as const;
    return [valueKey, rows.some(row => row[valueKey] === null) ? null : rows.reduce((sum, row) => sum + (row[valueKey] ?? 0), 0)];
  })) as Record<`${XntMovementBucket}Value`, number | null>;
}

export const XNT_DETAIL_COLUMN_GROUPS = [
  { label: "MẶT HÀNG", span: 3 }, { label: "ĐẦU KỲ", span: 2 },
  ...XNT_MOVEMENT_BUCKETS.map(({ key, label }) => ({ label, span: 3, variant: key.startsWith("in") ? "input" as const : "output" as const })),
  { label: "CUỐI KỲ", span: 2 },
];

export function expandXntExcelColumns<T extends { key: string; label: string; width: number; format?: "number" | "currency"; decimalPlaces?: number }>(columns: T[]) {
  return columns.flatMap(column => XNT_MOVEMENT_BUCKETS.some(bucket => bucket.key === column.key) ? [
    { ...column, label: "Số lượng", width: 16 },
    { ...column, key: `${column.key}UnitValue`, label: "Đơn giá BQ", width: 18, format: "number" as const },
    { ...column, key: `${column.key}Value`, label: "Thành tiền", width: 20, format: "currency" as const },
  ] : [column]);
}

export const XNT_VALUE_GROUPS = [
  { label: "ĐẦU KỲ", quantity: "openingQty", price: "openingUnitValue", value: "openingValue", variant: "default" },
  { label: "NHẬP TRONG KỲ", quantity: "totalIn", price: "inUnitValue", value: "inValue", variant: "input" },
  { label: "XUẤT TRONG KỲ", quantity: "totalOut", price: "outUnitValue", value: "outValue", variant: "output" },
  { label: "CUỐI KỲ", quantity: "closingQty", price: "closingUnitValue", value: "closingValue", variant: "default" },
] as const;

export const XNT_SUMMARY_EXCEL_COLUMNS = [
  { label: "Mã hàng", key: "code", width: 18, hideable: false },
  { label: "Tên hàng", key: "name", width: 36 },
  { label: "ĐVT", key: "unit", width: 10 },
  ...XNT_VALUE_GROUPS.flatMap((group) => [
    { label: "Số lượng", key: group.quantity, width: 16, format: "number" as const, decimalPlaces: 4 },
    { label: "Đơn giá BQ", key: group.price, width: 18, format: "number" as const, decimalPlaces: 4 },
    { label: "Thành tiền", key: group.value, width: 20, format: "currency" as const },
  ]),
];

export const XNT_SUMMARY_COLUMN_GROUPS = [
  { label: "MẶT HÀNG", span: 3 },
  ...XNT_VALUE_GROUPS.map((group) => ({ label: group.label, span: 3, variant: group.variant })),
];
