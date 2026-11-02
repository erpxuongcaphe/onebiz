import Decimal from "decimal.js-light";
import type { InventoryMovementV2Report, InventoryMovementV2Row } from "./inventory-movement-v2-contract";
import type { ExcelSheet } from "@/lib/utils/excel-export";
import { searchOptions } from "@/lib/search-options";
import { formatDate } from "@/lib/format";

const D = Decimal.clone({ precision: 256 });

export const INVENTORY_REVIEW_LABELS = {
  negative_stock: "Tồn âm",
  invalid_reservation: "Giữ hàng không hợp lệ",
  reserved_without_stock: "Có giữ hàng, chưa có tồn",
  reconcile_history: "Lệch lịch sử kho",
  review_no_outflow: "Chưa xuất dùng trên 60 ngày",
  insufficient_history: "Thiếu lịch sử",
  recent_movement: "Có luân chuyển gần đây",
};
export const INVENTORY_VALUE_LABELS = {
  supported: "Giá trị sổ kho",
  reference_only: "Giá trị tham chiếu",
  incomplete: "Chưa đủ giá trị",
};
const AGE_REASONS: Record<InventoryMovementV2Row["age_reason"], string> = {
  no_stock: "Không có tồn",
  negative_stock: "Tồn âm",
  unsupported_movement: "Có biến động cần kiểm tra",
  future_movement: "Có biến động sau thời điểm báo cáo",
  no_history: "Thiếu lịch sử kho",
  balance_mismatch: "Số dư chưa khớp lịch sử",
  ambiguous_order: "Chưa rõ thứ tự biến động",
  coverage_not_certified: "Chưa xác nhận đủ lịch sử lớp hàng",
};
const NUMERIC_KEYS = new Set(["current_qty", "reserved_qty", "available_qty", "movement_net", "movement_difference", "unitCost", "stockValue"]);
const DATE_KEYS = new Set(["last_receipt_at", "last_stock_out_at", "last_recorded_usage_at", "last_direct_sale_out_at"]);
const DATE_ALIASES: Record<string, string> = { receiptLabel: "last_receipt_at", outflowLabel: "last_stock_out_at", usageLabel: "last_recorded_usage_at", saleLabel: "last_direct_sale_out_at" };

export type InventoryMovementV2ViewRow = ReturnType<typeof inventoryMovementV2View>[number];
export type InventoryMovementV2Filters = { search: string; branch: string; unit: string; review: string; valuation: string };
export type InventoryMovementV2Sort = { id: string; direction: "asc" | "desc" } | null;

export function inventoryMovementV2View(report: InventoryMovementV2Report, conversions?: ReadonlyMap<string, string>) {
  return report.rows.map(row => ({
    ...row,
    id: `${row.branch_id}:${row.product_id}`,
    unitLabel: row.catalog_unit?.trim() || "Chưa có ĐVT",
    conversionLabel: conversions ? conversions.get(row.product_id) || "Không có quy đổi phụ" : "Chưa tải quy đổi",
    reviewLabel: INVENTORY_REVIEW_LABELS[row.review_status],
    ageLabel: row.age_status === "unverified" ? "Chưa đủ căn cứ" : "Không áp dụng",
    ageReason: AGE_REASONS[row.age_reason],
    valueLabel: row.valuation ? INVENTORY_VALUE_LABELS[row.valuation.status] : "",
    unitCost: row.valuation?.unit_cost ?? null,
    stockValue: row.valuation?.value ?? null,
    receiptLabel: row.last_receipt_at ? formatDate(row.last_receipt_at) : "",
    outflowLabel: row.last_stock_out_at ? formatDate(row.last_stock_out_at) : "",
    usageLabel: row.last_recorded_usage_at ? formatDate(row.last_recorded_usage_at) : "",
    saleLabel: row.last_direct_sale_out_at ? formatDate(row.last_direct_sale_out_at) : "",
  }));
}

export function filterInventoryMovementV2(rows: InventoryMovementV2ViewRow[], filters: InventoryMovementV2Filters) {
  return searchOptions(rows, filters.search, row => ({ name: `${row.name} ${row.branch_name}`, identifiers: [row.code] }))
    .map(result => result.item)
    .filter(row => (!filters.branch || row.branch_id === filters.branch) && (!filters.unit || row.unitLabel === filters.unit)
      && (!filters.review || row.review_status === filters.review) && (!filters.valuation || row.valuation?.status === filters.valuation));
}

export function sortInventoryMovementV2(rows: InventoryMovementV2ViewRow[], sort: InventoryMovementV2Sort) {
  if (!sort) return rows;
  const key = DATE_ALIASES[sort.id] ?? sort.id;
  const collator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });
  return rows.map((row, index) => ({ row, index })).sort((left, right) => {
    const a = left.row[key as keyof InventoryMovementV2ViewRow];
    const b = right.row[key as keyof InventoryMovementV2ViewRow];
    const aEmpty = a === null || a === undefined || a === "", bEmpty = b === null || b === undefined || b === "";
    if (aEmpty || bEmpty) return Number(aEmpty) - Number(bEmpty) || left.index - right.index;
    const comparison = NUMERIC_KEYS.has(key) ? new D(String(a)).cmp(String(b))
      : DATE_KEYS.has(key) ? Date.parse(String(a)) - Date.parse(String(b))
        : collator.compare(String(a), String(b));
    return (sort.direction === "asc" ? comparison : -comparison) || left.index - right.index;
  }).map(item => item.row);
}

export function inventoryMovementV2Totals(rows: InventoryMovementV2ViewRow[]) {
  const sum = (status: "supported" | "reference_only") => rows.filter(row => row.valuation?.status === status)
    .reduce((total, row) => total.plus(row.valuation!.value!), new D(0)).toFixed();
  const incomplete = rows.filter(row => row.valuation?.status === "incomplete").length;
  const references = rows.filter(row => row.valuation?.status === "reference_only").length;
  return {
    count: rows.length,
    products: new Set(rows.map(row => row.product_id)).size,
    negative: rows.filter(row => new D(row.current_qty).lt(0)).length,
    reconcile: rows.filter(row => row.review_status === "reconcile_history").length,
    unverified: rows.filter(row => row.age_status === "unverified").length,
    ledgerSubtotal: sum("supported"), referenceSubtotal: sum("reference_only"), incomplete, references,
    ledgerTotal: incomplete || references ? null : sum("supported"),
  };
}

export function inventoryMovementV2Columns(costVisible: boolean): ExcelSheet["columns"] {
  return [
    { key: "branch_name", label: "Chi nhánh", width: 28 },
    { key: "code", label: "Mã hàng", width: 18, hideable: false },
    { key: "name", label: "Mặt hàng", width: 32 },
    { key: "unitLabel", label: "ĐVT hiện tại", width: 16 },
    { key: "conversionLabel", label: "Quy đổi hiện tại", width: 30 },
    ...["current_qty", "reserved_qty", "available_qty"].map((key, index) => ({ key, label: ["Tồn hiện tại", "Đang giữ", "Khả dụng"][index], width: 18, format: "number" as const, decimalPlaces: 4 })),
    ...(costVisible ? [
      { key: "unitCost", label: "Đơn giá theo nguồn", width: 23, format: "currency" as const, decimalPlaces: 4 },
      { key: "stockValue", label: "Giá trị theo nguồn", width: 24, format: "currency" as const, decimalPlaces: 4 },
      { key: "valueLabel", label: "Cơ sở giá trị", width: 24 },
    ] : []),
    { key: "receiptLabel", label: "Nhập cuối (VN)", width: 24 },
    { key: "outflowLabel", label: "Xuất cuối (VN)", width: 24 },
    { key: "usageLabel", label: "Xuất dùng/BOM cuối (VN)", width: 27 },
    { key: "saleLabel", label: "Xuất bán trực tiếp cuối (VN)", width: 28 },
    { key: "movement_net", label: "Nhập − xuất ghi nhận", width: 23, format: "number", decimalPlaces: 4 },
    { key: "movement_difference", label: "Chênh với lịch sử", width: 22, format: "number", decimalPlaces: 4 },
    { key: "reviewLabel", label: "Cần kiểm tra", width: 30 },
    { key: "ageLabel", label: "Tuổi lớp hàng", width: 23 },
    { key: "ageReason", label: "Căn cứ tuổi tồn", width: 38 },
  ];
}

export function inventoryMovementV2Sheet(rows: InventoryMovementV2ViewRow[], costVisible: boolean, name = "Chi tiết tồn kho"): ExcelSheet {
  return {
    name, columns: inventoryMovementV2Columns(costVisible), rows,
    tablePreferenceKey: "report.inventory-movement.v2",
    footer: { code: "TỔNG", name: `${rows.length} dòng chi nhánh/mặt hàng`, unitLabel: "Không cộng khác ĐVT" },
  };
}
