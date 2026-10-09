import type { XntRow } from "@/lib/services/supabase/xnt-report";

export function historicalUnitValue(quantity: number, value: number | null): number | null {
  if (!Number.isFinite(quantity) || Math.abs(quantity) < 1e-9 || value === null || !Number.isFinite(value)) return null;
  return value / quantity;
}

export function withXntUnitValues(row: XntRow) {
  return {
    ...row,
    openingUnitValue: historicalUnitValue(row.openingQty, row.openingValue),
    inUnitValue: historicalUnitValue(row.totalIn, row.inValue),
    outUnitValue: historicalUnitValue(row.totalOut, row.outValue),
    closingUnitValue: historicalUnitValue(row.closingQty, row.closingValue),
  };
}

export type XntValuedRow = ReturnType<typeof withXntUnitValues>;

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
    { label: "Số lượng", key: group.quantity, width: 16, format: "number" as const },
    { label: "Đơn giá BQ", key: group.price, width: 18, format: "number" as const },
    { label: "Thành tiền", key: group.value, width: 20, format: "currency" as const },
  ]),
];

export const XNT_SUMMARY_COLUMN_GROUPS = [
  { label: "MẶT HÀNG", span: 3 },
  ...XNT_VALUE_GROUPS.map((group) => ({ label: group.label, span: 3, variant: group.variant })),
];
