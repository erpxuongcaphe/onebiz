/**
 * Supabase service: Inventory operations
 *
 * - inventory_checks: from Supabase (read + apply)
 * - disposal_exports, internal_exports: from Supabase (read + filter)
 * - manufacturing: removed — handled by production.ts
 *
 * Apply flow:
 *   `applyInventoryCheck(checkId)` delegates to `apply_inventory_check_atomic`.
 *   The RPC claims the check, writes stock_movements, updates products.stock
 *   and branch_stock, then flips status to `balanced` in one DB transaction.
 */

import type { InventoryCheck, DisposalExport, InternalExport, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getCurrentContext, getCurrentTenantId, getPaginationRange, handleError } from "./base";
import { isRpcUnavailable } from "./rpc-utils";
import { roundDecimals } from "@/lib/format";
import { applyCreatedAtRangeFilter } from "@/lib/utils/list-date-preset-range";

// --- Disposal Exports / Xuất hủy (Supabase) ---

const disposalStatusNameMap: Record<string, string> = {
  draft: "Phiếu tạm",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};

// QueryParams.filters accepts both a single value and a checkbox array.
// Inventory list pages use checkbox filters, so an array must be translated
// to PostgREST `.in(...)`; `.eq(...)` with an array returns no rows.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyStatusFilter(query: any, statusFilter: string | string[] | undefined) {
  if (Array.isArray(statusFilter)) {
    const statuses = statusFilter.filter((s) => s && s !== "all");
    return statuses.length > 0 ? query.in("status", statuses) : query;
  }

  if (statusFilter && statusFilter !== "all" && statusFilter !== "") {
    return query.eq("status", statusFilter);
  }

  return query;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCreatedAtRange(query: any, filters: QueryParams["filters"] | undefined) {
  return applyCreatedAtRangeFilter(query, filters);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDisposalExport(row: any): DisposalExport {
  const profile = row.profiles as { full_name: string } | null;
  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    totalProducts: 0, // Cần aggregate từ disposal_export_items — bỏ qua ở list view
    totalAmount: Number(row.total_amount ?? 0),
    reason: row.reason ?? "",
    status: row.status === "completed" ? "completed" : "draft",
    statusName: disposalStatusNameMap[row.status] ?? row.status,
    createdBy: row.created_by ?? "",
    createdByName: profile?.full_name ?? "",
    branchId: row.branch_id ?? undefined,
  };
}

export async function getDisposalExports(params: QueryParams): Promise<QueryResult<DisposalExport>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("disposal_exports")
    .select("*, profiles!disposal_exports_created_by_fkey(full_name)", { count: "exact" })
    .eq("tenant_id", tenantId);

  // Search theo mã phiếu
  if (params.search) {
    query = query.ilike("code", `%${params.search}%`);
  }

  query = applyStatusFilter(query, params.filters?.status);
  query = applyCreatedAtRange(query, params.filters);

  // Filter: branch
  if (params.branchId) {
    query = query.eq("branch_id", params.branchId);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getDisposalExports");

  const exports: DisposalExport[] = (data ?? []).map(mapDisposalExport);
  return { data: exports, total: count ?? 0 };
}

export function getDisposalStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "completed", label: "Hoàn thành" },
    { value: "draft", label: "Phiếu tạm" },
  ];
}

// --- Internal Exports / Xuất dùng nội bộ (Supabase) ---

const internalExportStatusNameMap: Record<string, string> = {
  draft: "Phiếu tạm",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapInternalExport(row: any): InternalExport {
  const profile = row.profiles as { full_name: string } | null;
  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    totalProducts: 0, // Cần aggregate từ internal_export_items — bỏ qua ở list view
    totalAmount: Number(row.total_amount ?? 0),
    status: row.status === "completed" ? "completed" : "draft",
    statusName: internalExportStatusNameMap[row.status] ?? row.status,
    note: row.note ?? undefined,
    createdBy: row.created_by ?? "",
    createdByName: profile?.full_name ?? "",
    branchId: row.branch_id ?? undefined,
  };
}

export async function getInternalExports(params: QueryParams): Promise<QueryResult<InternalExport>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("internal_exports")
    .select("*, profiles!internal_exports_created_by_fkey(full_name)", { count: "exact" })
    .eq("tenant_id", tenantId);

  // Search theo mã phiếu
  if (params.search) {
    query = query.ilike("code", `%${params.search}%`);
  }

  query = applyStatusFilter(query, params.filters?.status);
  query = applyCreatedAtRange(query, params.filters);

  // Filter: branch
  if (params.branchId) {
    query = query.eq("branch_id", params.branchId);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getInternalExports");

  const exports: InternalExport[] = (data ?? []).map(mapInternalExport);
  return { data: exports, total: count ?? 0 };
}

export function getInternalExportStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "completed", label: "Hoàn thành" },
    { value: "draft", label: "Phiếu tạm" },
  ];
}

// --- Complete / Cancel Disposal Export ---

/**
 * Hoàn thành phiếu xuất hủy:
 *   1. Atomic claim: UPDATE status='completed' WHERE status='draft'
 *   2. Load disposal_export_items
 *   3. Apply stock-out via applyManualStockMovement
 */
export async function completeDisposalExport(disposalId: string): Promise<void> {
  const supabase = getClient();
  // CEO 14/05 (migration 00074): gọi RPC atomic — status + stock 3 lớp +
  // audit log trong 1 transaction Postgres. Tránh drift khi mạng đứt giữa
  // step status update và stock movement.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "apply_disposal_export_atomic",
    { p_disposal_id: disposalId },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC apply_disposal_export_atomic. Vui lòng chạy migration 00074 trước.",
      );
    }
    handleError(error, "completeDisposalExport");
  }

  if (!data || !(data as { success?: boolean }).success) {
    throw new Error("Server không trả kết quả hoàn tất phiếu hợp lệ.");
  }
}

/**
 * Hủy phiếu xuất hủy.
 *
 * - draft   → chỉ lật trạng thái (chưa trừ kho nên không phải hoàn gì).
 * - completed → gọi RPC 00228 hoàn kho theo sổ cái rồi mới đánh dấu huỷ.
 *
 * CEO 28/07: phiếu xuất huỷ được tạo thẳng ở 'completed', trước đây nút Huỷ
 * chỉ nhận 'draft' nên là nút chết — nhập nhầm phải đi điều chỉnh tồn tay.
 */
export async function cancelDisposalExport(
  disposalId: string,
  reason?: string,
): Promise<void> {
  const supabase = getClient();
  const { error } = await (supabase.rpc as any)(
    "cancel_disposal_export_atomic_v2",
    {
      p_disposal_id: disposalId,
      p_reason: reason?.trim() || "Hủy từ giao diện xuất hủy",
    },
  );
  if (error) handleError(error, "cancelDisposalExport");
}

// --- Complete / Cancel Internal Export ---

/**
 * Hoàn thành phiếu xuất nội bộ:
 *   1. Atomic claim: UPDATE status='completed' WHERE status='draft'
 *   2. Load internal_export_items
 *   3. Apply stock-out via applyManualStockMovement
 */
export async function completeInternalExport(exportId: string): Promise<void> {
  const supabase = getClient();
  // CEO 14/05 (migration 00074): gọi RPC atomic — tương tự disposal.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "apply_internal_export_atomic",
    { p_export_id: exportId },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC apply_internal_export_atomic. Vui lòng chạy migration 00074 trước.",
      );
    }
    handleError(error, "completeInternalExport");
  }

  if (!data || !(data as { success?: boolean }).success) {
    throw new Error("Server không trả kết quả hoàn tất phiếu hợp lệ.");
  }
}

/**
 * Hủy phiếu xuất dùng nội bộ.
 *
 * Cùng cơ chế cancelDisposalExport: draft thì lật trạng thái, completed thì
 * gọi RPC 00228 hoàn kho theo sổ cái trước khi đánh dấu huỷ.
 */
export async function cancelInternalExport(
  exportId: string,
  reason?: string,
): Promise<void> {
  const supabase = getClient();
  const { error } = await (supabase.rpc as any)(
    "cancel_internal_export_atomic_v2",
    {
      p_export_id: exportId,
      p_reason: reason?.trim() || "Hủy từ giao diện xuất nội bộ",
    },
  );
  if (error) handleError(error, "cancelInternalExport");
}

// --- Create Internal Export / Xuất nội bộ ---

export interface CreateExportItemInput {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  /** Giá vốn per unit — dùng để tính total_amount cho P&L. */
  unitPrice: number;
}

export interface CreateInternalExportInput {
  /** Phòng ban / nơi nhận / mục đích sử dụng. */
  department: string;
  note?: string;
  items: CreateExportItemInput[];
}

/**
 * Tạo phiếu xuất dùng nội bộ + insert items + apply stock-out trong một luồng.
 *
 * Trước đây dialog chỉ gọi applyManualStockMovement → stock_movements có ghi
 * nhưng header internal_exports không ghi → list view không hiển thị phiếu vừa
 * tạo (ghost record). Fix: insert header (status='completed') → items → stock.
 *
 * NOT atomic cross-table — nếu stock movement fail ở giữa, header/items đã ghi
 * thì auto-flip status='cancelled' để list không show phiếu hỏng. RPC
 * transactional sẽ replace trong sprint KHO-2.
 */
export async function createInternalExport(
  input: CreateInternalExportInput,
): Promise<{ id: string; code: string }> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  const { data, error } = await (supabase.rpc as any)(
    "create_internal_export_atomic",
    {
      p_branch_id: ctx.branchId,
      p_department: input.department,
      p_note: input.note ?? null,
      p_items: input.items.map((item) => ({
        product_id: item.productId,
        quantity: Number(item.quantity),
      })),
    },
  );
  if (error) handleError(error, "createInternalExport");
  const result = data as Record<string, unknown> | null;
  if (!result?.id || !result.code) {
    throw new Error("Máy chủ không trả về phiếu xuất nội bộ hợp lệ.");
  }
  return { id: String(result.id), code: String(result.code) };
}

// --- Create Disposal Export / Xuất hủy ---

export interface CreateDisposalExportInput {
  /** Lý do xuất hủy (hỏng, hết hạn, vỡ...). */
  reason: string;
  note?: string;
  items: CreateExportItemInput[];
}

/**
 * Tạo phiếu xuất hủy + insert items + apply stock-out.
 * Same rationale as createInternalExport above.
 */
export async function createDisposalExport(
  input: CreateDisposalExportInput,
): Promise<{ id: string; code: string }> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  const { data, error } = await (supabase.rpc as any)(
    "create_disposal_export_atomic",
    {
      p_branch_id: ctx.branchId,
      p_reason: input.reason,
      p_note: input.note ?? null,
      p_items: input.items.map((item) => ({
        product_id: item.productId,
        quantity: Number(item.quantity),
      })),
    },
  );
  if (error) handleError(error, "createDisposalExport");
  const result = data as Record<string, unknown> | null;
  if (!result?.id || !result.code) {
    throw new Error("Máy chủ không trả về phiếu xuất hủy hợp lệ.");
  }
  return { id: String(result.id), code: String(result.code) };
}

// --- Inventory Checks (Supabase) ---

export async function getInventoryChecks(params: QueryParams): Promise<QueryResult<InventoryCheck>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("inventory_checks")
    .select("*, profiles!inventory_checks_created_by_fkey(full_name), inventory_check_items(id, system_stock, actual_stock, difference, products(cost_price))", { count: "exact" })
    .eq("tenant_id", tenantId);

  // Search
  if (params.search) {
    query = query.ilike("code", `%${params.search}%`);
  }

  query = applyStatusFilter(query, params.filters?.status);
  query = applyCreatedAtRange(query, params.filters);

  // Filter: branch
  if (params.branchId) {
    query = query.eq("branch_id", params.branchId);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getInventoryChecks");

  const checks: InventoryCheck[] = (data ?? []).map(mapInventoryCheck);
  return { data: checks, total: count ?? 0 };
}

export function getInventoryCheckStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "balanced", label: "Đã cân bằng" },
    { value: "in_progress", label: "Đang xử lý" },
    { value: "draft", label: "Phiếu tạm" },
    { value: "cancelled", label: "Đã hủy" },
  ];
}

/* ------------------------------------------------------------------ */
/*  Apply inventory check — commits real stock deltas atomically      */
/* ------------------------------------------------------------------ */

/**
 * Apply inventory check via one Postgres transaction.
 *
 * The RPC validates status, reads variance rows, writes ledger/snapshots, and
 * flips `inventory_checks.status = 'balanced'` all-or-nothing.
 */
export async function applyInventoryCheck(checkId: string): Promise<void> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)("apply_inventory_check_atomic", {
    p_tenant_id: ctx.tenantId,
    p_check_id: checkId,
    p_created_by: ctx.userId,
  });
  if (error) handleError(error, "applyInventoryCheck.atomic_rpc");
}

/* ------------------------------------------------------------------ */
/*  Per-item variance detail (for inline detail panel)                 */
/* ------------------------------------------------------------------ */

export interface InventoryCheckItemRow {
  id: string;
  productId: string;
  productName: string;
  productCode?: string;
  unit?: string;
  systemStock: number;
  actualStock: number;
  difference: number;
  /** Latest cost × |difference| — signed same as difference */
  valueImpact: number;
  note?: string;
}

/**
 * Fetch per-product rows for an inventory check, joined with products to pull
 * code/unit/cost. Used by the detail panel to show a "sổ chênh lệch" table and
 * by the apply-modal preview to show expected impact before committing.
 */
export async function getInventoryCheckItems(
  checkId: string
): Promise<InventoryCheckItemRow[]> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data, error } = await sb
    .from("inventory_check_items")
    .select(
      "id, product_id, product_name, system_stock, actual_stock, difference, products(code, unit, cost_price)"
    )
    .eq("check_id", checkId)
    .order("difference", { ascending: true });

  if (error) handleError(error, "getInventoryCheckItems");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => {
    const diff = Number(row.difference ?? 0);
    const cost = Number(row.products?.cost_price ?? 0);
    return {
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      productCode: row.products?.code ?? undefined,
      unit: row.products?.unit ?? undefined,
      systemStock: Number(row.system_stock ?? 0),
      actualStock: Number(row.actual_stock ?? 0),
      difference: diff,
      valueImpact: diff * cost,
    };
  });
}

/**
 * Hủy phiếu kiểm kho — chỉ cho phép hủy khi phiếu ở trạng thái draft/in_progress.
 */
export async function cancelInventoryCheck(checkId: string): Promise<void> {
  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "cancel_inventory_check_atomic",
    { p_check_id: checkId },
  );
  if (error) handleError(error, "cancelInventoryCheck");

  const result = data as Record<string, unknown> | null;
  if (!result?.check_id || result.status !== "cancelled") {
    throw new Error("Máy chủ không xác nhận hủy phiếu kiểm kho.");
  }
}

// --- Mapper ---

const checkStatusNameMap: Record<string, string> = {
  draft: "Phiếu tạm",
  in_progress: "Đang xử lý",
  balanced: "Đã cân bằng",
  cancelled: "Đã hủy",
};

// Map DB status to frontend status
const checkStatusMap: Record<string, InventoryCheck["status"]> = {
  draft: "processing",
  in_progress: "processing",
  balanced: "balanced",
  cancelled: "unbalanced",
};

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function relationCostPrice(relation: unknown): number {
  const value = Array.isArray(relation) ? relation[0] : relation;
  if (!value || typeof value !== "object") return 0;
  return toNumber((value as { cost_price?: unknown }).cost_price);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapInventoryCheck(row: any): InventoryCheck {
  const profile = row.profiles as { full_name: string } | null;
  const items = Array.isArray(row.inventory_check_items)
    ? (row.inventory_check_items as Array<{
        system_stock?: unknown;
        actual_stock?: unknown;
        difference?: unknown;
        products?: unknown;
      }>)
    : [];

  let increaseQty = 0;
  let decreaseQty = 0;
  let increaseAmount = 0;
  let decreaseAmount = 0;

  for (const item of items) {
    const diff = item.difference == null
      ? toNumber(item.actual_stock) - toNumber(item.system_stock)
      : toNumber(item.difference);
    const valueImpact = Math.abs(diff) * relationCostPrice(item.products);

    if (diff > 0) {
      increaseQty += diff;
      increaseAmount += valueImpact;
    } else if (diff < 0) {
      decreaseQty += Math.abs(diff);
      decreaseAmount += valueImpact;
    }
  }

  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    status: checkStatusMap[row.status] ?? "processing",
    statusName: checkStatusNameMap[row.status] ?? row.status,
    totalProducts: items.length,
    increaseQty: roundDecimals(increaseQty),
    decreaseQty: roundDecimals(decreaseQty),
    increaseAmount: roundDecimals(increaseAmount),
    decreaseAmount: roundDecimals(decreaseAmount),
    note: row.note ?? undefined,
    createdBy: row.created_by,
    createdByName: profile?.full_name ?? "",
  };
}
// ============================================================
// Bulk gắn HSD cho tồn cũ (CEO 18/05/2026, migration 00104)
//
// Khi setup data từ phần mềm cũ → 270 NVL có tồn nhưng không có HSD.
// Bulk RPC tạo nhiều adjustment lots cùng lúc — atomic per item, owner/admin.
// ============================================================

export interface ProductWithBranchStock {
  productId: string;
  productCode: string;
  productName: string;
  productType: string;
  stockUnit: string;
  categoryId: string | null;
  categoryName: string | null;
  branchStock: number;
  earliestLotExpiry: string | null; // YYYY-MM-DD or null nếu chưa có lot active
  totalLotsActive: number;
}

export interface BulkAdjustmentLotItem {
  productId: string;
  branchId: string;
  qty: number;
  expiryDate: string; // YYYY-MM-DD
  lotNumber?: string;
  note?: string;
}

export interface BulkAdjustmentLotFailure {
  product_id: string;
  product_code?: string;
  reason: string;
}

export interface BulkAdjustmentLotsResult {
  success: boolean;
  created: number;
  failed: BulkAdjustmentLotFailure[];
  failedCount: number;
  total: number;
}

/**
 * List SP có tồn > 0 ở chi nhánh kèm thông tin lot active sớm nhất.
 * Dùng cho dialog "Gắn HSD cho tồn cũ" — filter theo nhóm / NCC / "chỉ chưa có lot".
 */
export async function getProductsWithBranchStock(
  branchId: string,
  opts?: {
    categoryId?: string | null;
    supplierId?: string | null;
    onlyWithoutLots?: boolean;
  },
): Promise<ProductWithBranchStock[]> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_products_with_branch_stock",
    {
      p_branch_id: branchId,
      p_category_id: opts?.categoryId ?? null,
      p_supplier_id: opts?.supplierId ?? null,
      p_only_without_lots: opts?.onlyWithoutLots ?? false,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC get_products_with_branch_stock. Vui lòng chạy migration 00104 trước.",
      );
    }
    handleError(error, "getProductsWithBranchStock");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    productType: row.product_type,
    stockUnit: row.stock_unit ?? "",
    categoryId: row.category_id ?? null,
    categoryName: row.category_name ?? null,
    branchStock: Number(row.branch_stock ?? 0),
    earliestLotExpiry: row.earliest_lot_expiry ?? null,
    totalLotsActive: Number(row.total_lots_active ?? 0),
  }));
}

/**
 * Tạo nhiều adjustment lots cùng lúc — RPC server-side validate per item.
 * Items hợp lệ → tạo lot + audit log. Items lỗi → push vào failed[] với reason.
 * Return summary để UI hiển thị "đã tạo X / Y, lỗi Z dòng".
 */
export async function bulkCreateAdjustmentLots(
  items: BulkAdjustmentLotItem[],
  defaultNote?: string,
): Promise<BulkAdjustmentLotsResult> {
  const supabase = getClient();

  const payload = items.map((it) => ({
    product_id: it.productId,
    branch_id: it.branchId,
    qty: it.qty,
    expiry_date: it.expiryDate,
    lot_number: it.lotNumber ?? null,
    note: it.note ?? null,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "bulk_create_adjustment_lots_atomic",
    {
      p_items: payload,
      p_default_note: defaultNote ?? null,
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có RPC bulk_create_adjustment_lots_atomic. Vui lòng chạy migration 00104 trước.",
      );
    }
    handleError(error, "bulkCreateAdjustmentLots");
  }

  const r = (data ?? {}) as Record<string, unknown>;
  return {
    success: Boolean(r.success),
    created: Number(r.created ?? 0),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    failed: ((r.failed as any) ?? []) as BulkAdjustmentLotFailure[],
    failedCount: Number(r.failed_count ?? 0),
    total: Number(r.total ?? 0),
  };
}
