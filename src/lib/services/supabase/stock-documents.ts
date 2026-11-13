import { getStockDocumentKind, getStockDocumentLabel } from "@/lib/stock-document";
import { getClient, getCurrentTenantId, handleError } from "./base";

export interface StockDocumentItem {
  id: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice?: number;
  amount?: number;
  systemStock?: number;
  actualStock?: number;
  note?: string;
}

export interface StockDocumentDetail {
  id: string;
  code: string;
  kindLabel: string;
  status: string;
  date: string;
  branchName?: string;
  relatedBranchName?: string;
  counterparty?: string;
  creatorName?: string;
  note?: string;
  reason?: string;
  totalAmount?: number;
  paidAmount?: number;
  debtAmount?: number;
  itemSectionLabel: string;
  items: StockDocumentItem[];
}

interface DocumentConfig {
  headerTable: string;
  itemTable?: string;
  itemForeignKey?: string;
  itemSectionLabel?: string;
}

const DOCUMENT_CONFIG: Record<string, DocumentConfig> = {
  invoice: { headerTable: "invoices", itemTable: "invoice_items", itemForeignKey: "invoice_id", itemSectionLabel: "Hàng hóa trên hóa đơn" },
  purchase_order: { headerTable: "purchase_orders", itemTable: "purchase_order_items", itemForeignKey: "purchase_order_id", itemSectionLabel: "Hàng hóa trên phiếu nhập" },
  input_invoice: { headerTable: "input_invoices", itemSectionLabel: "Hàng hóa theo phiếu nhập liên kết" },
  production_order: { headerTable: "production_orders", itemTable: "production_order_materials", itemForeignKey: "production_order_id", itemSectionLabel: "Nguyên vật liệu của lệnh sản xuất" },
  inventory_check: { headerTable: "inventory_checks", itemTable: "inventory_check_items_scoped", itemForeignKey: "check_id", itemSectionLabel: "Kết quả kiểm kê" },
  disposal_export: { headerTable: "disposal_exports", itemTable: "disposal_export_items", itemForeignKey: "disposal_id", itemSectionLabel: "Hàng hóa xuất hủy" },
  sales_return: { headerTable: "sales_returns", itemTable: "return_items", itemForeignKey: "return_id", itemSectionLabel: "Hàng hóa trả lại" },
  internal_sale: { headerTable: "internal_sales", itemTable: "internal_sale_items", itemForeignKey: "internal_sale_id", itemSectionLabel: "Hàng hóa bán nội bộ" },
  internal_export: { headerTable: "internal_exports", itemTable: "internal_export_items", itemForeignKey: "export_id", itemSectionLabel: "Hàng hóa xuất dùng nội bộ" },
  stock_transfer: { headerTable: "stock_transfers", itemTable: "stock_transfer_items", itemForeignKey: "transfer_id", itemSectionLabel: "Hàng hóa chuyển kho" },
  supplier_return: { headerTable: "supplier_returns", itemTable: "supplier_return_items", itemForeignKey: "return_id", itemSectionLabel: "Hàng hóa trả nhà cung cấp" },
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Phiếu tạm", confirmed: "Đã xác nhận", completed: "Hoàn thành",
  cancelled: "Đã hủy", ordered: "Đã đặt hàng", partial: "Nhập một phần",
  in_progress: "Đang xử lý", balanced: "Đã cân bằng", recorded: "Đã ghi nhận",
  unrecorded: "Chưa ghi nhận", planned: "Đã lập kế hoạch",
  material_check: "Kiểm tra nguyên liệu", in_production: "Đang sản xuất",
  quality_check: "Kiểm tra chất lượng", in_transit: "Đang chuyển",
};

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstText(...values: unknown[]): string | undefined {
  const value = values.find((item) => typeof item === "string" && item.trim());
  return typeof value === "string" ? value : undefined;
}

export async function getStockDocumentDetail(
  referenceType: string,
  referenceId: string,
): Promise<StockDocumentDetail | null> {
  const kind = getStockDocumentKind(referenceType);
  const config = DOCUMENT_CONFIG[kind];
  if (!config) return null;

  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // Several warehouse tables were introduced after generated Supabase types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  if (kind === "disposal_export" || kind === "internal_export") {
    // The server applies branch/action and cost permissions before returning
    // fields, without widening access to the cost-bearing tables.
    const { data: safe, error } = await db.rpc("get_stock_work_document_detail", { p_kind: kind, p_id: referenceId });
    if (error?.code === "42501") return null;
    if (error) handleError(error, "getStockDocumentDetail.workProjection");
    if (!safe || safe.id !== referenceId || !Array.isArray(safe.items) ||
      (safe.totalAmount != null && !Number.isFinite(Number(safe.totalAmount))) ||
      safe.items.some((row: Record<string, unknown>) => !row || typeof row.id !== "string" ||
        row.quantity == null || !Number.isFinite(Number(row.quantity)) ||
        (row.unitPrice != null && !Number.isFinite(Number(row.unitPrice))) ||
        (row.amount != null && !Number.isFinite(Number(row.amount))))) {
      throw new Error("Dữ liệu chi tiết phiếu không hợp lệ.");
    }
    return {
      id: safe.id,
      code: firstText(safe.code) ?? "—",
      kindLabel: getStockDocumentLabel(referenceType),
      status: STATUS_LABELS[String(safe.status ?? "")] ?? String(safe.status ?? "—"),
      date: firstText(safe.createdAt) ?? "",
      branchName: firstText(safe.branchName),
      creatorName: firstText(safe.createdByName),
      totalAmount: safe.totalAmount == null ? undefined : asNumber(safe.totalAmount),
      counterparty: firstText(safe.department),
      note: firstText(safe.note),
      reason: firstText(safe.reason),
      itemSectionLabel: config.itemSectionLabel ?? "Chi tiết hàng hóa",
      items: safe.items.map((row: Record<string, unknown>) => ({
        id: String(row.id), productCode: firstText(row.productCode) ?? "—", productName: firstText(row.productName) ?? "—",
        unit: firstText(row.unit) ?? "—", quantity: asNumber(row.quantity),
        unitPrice: row.unitPrice == null ? undefined : asNumber(row.unitPrice),
        amount: row.amount == null ? undefined : asNumber(row.amount),
      })),
    };
  }
  const { data: header, error: headerError } = await db
    .from(config.headerTable).select("*").eq("tenant_id", tenantId)
    .eq("id", referenceId).maybeSingle();
  if (headerError) handleError(headerError, "getStockDocumentDetail.header");
  if (!header) return null;

  let itemRows: Record<string, unknown>[] = [];
  // Retail invoice lines moved behind the branch-scoped read view. Keep the
  // other document/F&B paths unchanged; never restore direct table grants.
  let itemTable = kind === "invoice" && header.source === "pos"
    ? "invoice_items_scoped" : config.itemTable;
  let itemForeignKey = config.itemForeignKey;
  let itemReferenceId = referenceId;
  if (kind === "input_invoice" && header.purchase_order_id) {
    itemTable = "purchase_order_items";
    itemForeignKey = "purchase_order_id";
    itemReferenceId = header.purchase_order_id;
  }
  if (itemTable && itemForeignKey) {
    const { data: items, error: itemError } = await db
      .from(itemTable).select("*").eq(itemForeignKey, itemReferenceId);
    if (itemError) handleError(itemError, "getStockDocumentDetail.items");
    itemRows = items ?? [];
  }

  const productIds = Array.from(new Set(itemRows.map((item) => item.product_id)
    .filter((id): id is string => typeof id === "string" && Boolean(id))));
  const branchIds = Array.from(new Set(
    [header.branch_id, header.from_branch_id, header.to_branch_id]
      .filter((id): id is string => typeof id === "string" && Boolean(id)),
  ));
  const [productsResult, branchesResult, creatorResult] = await Promise.all([
    productIds.length
      ? db.from("products_scoped").select("id, code, name, unit").eq("tenant_id", tenantId).in("id", productIds)
      : Promise.resolve({ data: [] }),
    branchIds.length
      ? db.from("branches").select("id, name").eq("tenant_id", tenantId).in("id", branchIds)
      : Promise.resolve({ data: [] }),
    header.created_by
      ? db.from("profiles").select("full_name").eq("id", header.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const productMap = new Map<string, Record<string, unknown>>(
    (productsResult.data ?? []).map((row: Record<string, unknown>) => [String(row.id), row]),
  );
  const branchMap = new Map<string, string>(
    (branchesResult.data ?? []).map((row: Record<string, unknown>) => [String(row.id), String(row.name ?? "")]),
  );
  const items: StockDocumentItem[] = itemRows.map((row) => {
    const product = row.product_id ? productMap.get(String(row.product_id)) : undefined;
    const quantity = kind === "inventory_check"
      ? asNumber(row.difference)
      : kind === "production_order"
        ? asNumber(row.actual_qty ?? row.planned_qty)
        : asNumber(row.quantity);
    return {
      id: String(row.id),
      productCode: firstText(row.product_code, product?.code) ?? "—",
      productName: firstText(row.product_name, product?.name) ?? "—",
      unit: firstText(row.unit, product?.unit) ?? "—",
      quantity,
      unitPrice: row.unit_price == null ? undefined : asNumber(row.unit_price),
      amount: row.total == null && row.amount == null ? undefined : asNumber(row.total ?? row.amount),
      systemStock: row.system_stock == null ? undefined : asNumber(row.system_stock),
      actualStock: row.actual_stock == null ? undefined : asNumber(row.actual_stock),
      note: firstText(row.note),
    };
  });
  const fromBranch = header.from_branch_id ? branchMap.get(String(header.from_branch_id)) : undefined;
  const toBranch = header.to_branch_id ? branchMap.get(String(header.to_branch_id)) : undefined;
  const branchName = header.branch_id ? branchMap.get(String(header.branch_id)) : fromBranch;

  return {
    id: String(header.id),
    code: firstText(header.code) ?? "—",
    kindLabel: getStockDocumentLabel(referenceType),
    status: STATUS_LABELS[String(header.status ?? "")] ?? String(header.status ?? "—"),
    date: firstText(header.created_at, header.date, header.completed_at) ?? "",
    branchName,
    relatedBranchName: fromBranch && toBranch ? fromBranch + " → " + toBranch : toBranch,
    counterparty: firstText(header.customer_name, header.supplier_name, header.department, toBranch),
    creatorName: firstText(creatorResult.data?.full_name),
    note: firstText(header.note, header.notes),
    reason: firstText(header.reason),
    totalAmount: header.total == null && header.total_amount == null ? undefined : asNumber(header.total ?? header.total_amount),
    paidAmount: header.paid == null ? undefined : asNumber(header.paid),
    debtAmount: header.debt == null ? undefined : asNumber(header.debt),
    itemSectionLabel: config.itemSectionLabel ?? "Chi tiết hàng hóa",
    items,
  };
}
