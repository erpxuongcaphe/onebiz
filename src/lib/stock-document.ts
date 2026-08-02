import { REFERENCE_TYPE_LABELS } from "@/lib/constants/stock-movement-refs";

export type StockDocumentKind =
  | "invoice"
  | "purchase_order"
  | "input_invoice"
  | "production_order"
  | "inventory_check"
  | "disposal_export"
  | "sales_return"
  | "internal_sale"
  | "internal_export"
  | "stock_transfer"
  | "supplier_return"
  | "unsupported";

const KIND_BY_REFERENCE: Record<string, StockDocumentKind> = {
  invoice: "invoice",
  bom_consume: "invoice",
  modifier_topping: "invoice",
  invoice_void: "invoice",
  purchase_order: "purchase_order",
  po_receive: "purchase_order",
  purchase_order_revert: "purchase_order",
  goods_receipt: "purchase_order",
  purchase_entry: "purchase_order",
  input_invoice: "input_invoice",
  production_order: "production_order",
  production_reconcile: "production_order",
  production_complete: "production_order",
  production_consume: "production_order",
  inventory_check: "inventory_check",
  disposal: "disposal_export",
  disposal_export: "disposal_export",
  sales_return: "sales_return",
  return: "sales_return",
  return_bom_restore: "sales_return",
  internal_sale: "internal_sale",
  internal_export: "internal_export",
  transfer: "stock_transfer",
  stock_transfer: "stock_transfer",
  supplier_return: "supplier_return",
  purchase_return: "supplier_return",
};

export function getStockDocumentKind(referenceType?: string | null): StockDocumentKind {
  if (!referenceType) return "unsupported";
  return KIND_BY_REFERENCE[referenceType.toLowerCase()] ?? "unsupported";
}

export function getStockDocumentLabel(referenceType?: string | null): string {
  if (!referenceType) return "Biến động kho";
  return REFERENCE_TYPE_LABELS[referenceType] ?? "Chứng từ kho";
}

export function canOpenStockDocument(
  referenceType?: string | null,
  referenceId?: string | null,
): boolean {
  return Boolean(referenceId) && getStockDocumentKind(referenceType) !== "unsupported";
}

// Trang list của từng loại chứng từ — đích cho nút "Mở trang chứng từ".
const ROUTE_BY_KIND: Partial<Record<StockDocumentKind, string>> = {
  invoice: "/don-hang/hoa-don",
  purchase_order: "/hang-hoa/nhap-hang",
  input_invoice: "/hang-hoa/hoa-don-dau-vao",
  production_order: "/hang-hoa/san-xuat",
  inventory_check: "/hang-hoa/kiem-kho",
  disposal_export: "/hang-hoa/xuat-huy",
  sales_return: "/don-hang/tra-hang",
  internal_sale: "/hang-hoa/ban-noi-bo",
  internal_export: "/hang-hoa/xuat-dung-noi-bo",
  stock_transfer: "/hang-hoa/chuyen-kho",
  supplier_return: "/hang-hoa/tra-hang-nhap",
};

/** URL trang chứng từ, kèm ?tim=<mã> để trang đích tự đổ vào ô tìm kiếm. */
export function getStockDocumentRoute(
  referenceType?: string | null,
  code?: string | null,
): string | null {
  const route = ROUTE_BY_KIND[getStockDocumentKind(referenceType)];
  if (!route) return null;
  return code && code !== "—" ? `${route}?tim=${encodeURIComponent(code)}` : route;
}
