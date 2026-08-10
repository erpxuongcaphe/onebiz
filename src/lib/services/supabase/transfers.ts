/**
 * Supabase service: Stock Transfers (Chuyển kho giữa chi nhánh)
 *
 * Sprint 7 "Toàn Cảnh"
 *
 * Workflow:
 *   draft → in_transit → completed
 *   draft → cancelled
 *   in_transit → cancelled
 *
 * Stock effects:
 *   - completeStockTransfer():
 *     1. Delegates to `complete_stock_transfer_atomic`
 *     2. Writes OUT/IN stock_movements and source/target branch_stock in one DB transaction
 *     3. Keeps company-wide products.stock unchanged because this is an inter-branch move
 */

import type { QueryParams, QueryResult } from "@/lib/types";
import {
  getClient,
  getCurrentContext,
  getCurrentTenantId,
  getPaginationRange,
  handleError,
} from "./base";
import { isRpcUnavailable } from "./rpc-utils";
import { applyCreatedAtRangeFilter } from "@/lib/utils/list-date-preset-range";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface StockTransfer {
  id: string;
  code: string;
  fromBranchId: string;
  fromBranchCode: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchCode: string;
  toBranchName: string;
  status: StockTransferStatus;
  totalItems: number;
  note: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type StockTransferStatus = "draft" | "in_transit" | "completed" | "cancelled";

export interface StockTransferItem {
  productId: string;
  productName: string;
  productCode: string;
  unit?: string;
  quantity: number;
  note?: string;
}

export interface CreateStockTransferInput {
  fromBranchId: string;
  toBranchId: string;
  items: StockTransferItem[];
  note?: string;
}

export interface StockTransferExportRow {
  code: string;
  status: string;
  fromBranchCode: string;
  fromBranchName: string;
  toBranchCode: string;
  toBranchName: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  note: string;
  createdByName: string;
  createdAt: string;
  completedAt: string;
}

/* ------------------------------------------------------------------ */
/*  State machine                                                      */
/* ------------------------------------------------------------------ */

const VALID_TRANSITIONS: Record<StockTransferStatus, StockTransferStatus[]> = {
  draft: ["in_transit", "cancelled"],
  in_transit: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};
const VALID_TRANSFER_STATUSES = new Set<StockTransferStatus>([
  "draft",
  "in_transit",
  "completed",
  "cancelled",
]);

export function canTransitionTransfer(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from as StockTransferStatus];
  if (!allowed) return false;
  return allowed.includes(to as StockTransferStatus);
}

export function getTransferStatusMeta(): Record<
  StockTransferStatus,
  { label: string; color: string }
> {
  return {
    draft: { label: "Phiếu tạm", color: "#94a3b8" },
    in_transit: { label: "Đang chuyển", color: "#004AC6" },
    completed: { label: "Hoàn thành", color: "#10b981" },
    cancelled: { label: "Đã hủy", color: "#ef4444" },
  };
}

/* ------------------------------------------------------------------ */
/*  Queries                                                            */
/* ------------------------------------------------------------------ */

export async function getStockTransfers(
  params: QueryParams
): Promise<QueryResult<StockTransfer>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  const search = params.search?.trim();
  const fromBranchRelation =
    search &&
    (params.searchField === "from_branch_code" ||
      params.searchField === "from_branch_name")
      ? "from_branch:branches!stock_transfers_from_branch_id_fkey!inner(code, name, tenant_id)"
      : "from_branch:branches!stock_transfers_from_branch_id_fkey(code, name)";
  const toBranchRelation =
    search &&
    (params.searchField === "to_branch_code" ||
      params.searchField === "to_branch_name")
      ? "to_branch:branches!stock_transfers_to_branch_id_fkey!inner(code, name, tenant_id)"
      : "to_branch:branches!stock_transfers_to_branch_id_fkey(code, name)";
  const creatorRelation =
    search && params.searchField === "creator_name"
      ? "creator:profiles!stock_transfers_created_by_fkey!inner(full_name, tenant_id)"
      : "creator:profiles!stock_transfers_created_by_fkey(full_name)";
  const itemRelation =
    search &&
    (params.searchField === "product_code" ||
      params.searchField === "product_name")
      ? ", item_match:stock_transfer_items!inner(product_code, product_name)"
      : "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("stock_transfers")
    .select(
      `*, ${fromBranchRelation}, ${toBranchRelation}, ${creatorRelation}${itemRelation}`,
      { count: "exact" }
    )
    .eq("tenant_id", tenantId);

  const rawStatuses = params.filters?.status;
  if (rawStatuses && rawStatuses !== "all") {
    const statuses = (Array.isArray(rawStatuses) ? rawStatuses : [rawStatuses]).filter(
      (status): status is StockTransferStatus =>
        VALID_TRANSFER_STATUSES.has(status as StockTransferStatus),
    );
    if (statuses.length > 0) query = query.in("status", statuses);
  }

  query = applyCreatedAtRangeFilter(query, params.filters);

  // Filter: chi nhánh — hiện transfer có CN này là source hoặc destination.
  // Tránh leak giữa các CN không liên quan.
  const branchFilter = params.branchId ?? params.filters?.branchId;
  if (typeof branchFilter === "string" && branchFilter && branchFilter !== "all") {
    query = query.or(`from_branch_id.eq.${branchFilter},to_branch_id.eq.${branchFilter}`);
  }

  const fromBranchId = params.filters?.fromBranchId;
  const toBranchId = params.filters?.toBranchId;
  const createdBy = params.filters?.createdBy;
  if (typeof fromBranchId === "string" && fromBranchId) {
    query = query.eq("from_branch_id", fromBranchId);
  }
  if (typeof toBranchId === "string" && toBranchId) {
    query = query.eq("to_branch_id", toBranchId);
  }
  if (typeof createdBy === "string" && createdBy) {
    query = query.eq("created_by", createdBy);
  }

  const itemCountMin = Number(params.filters?.itemCountMin);
  const itemCountMax = Number(params.filters?.itemCountMax);
  if (Number.isFinite(itemCountMin) && itemCountMin >= 0) {
    query = query.gte("total_items", itemCountMin);
  }
  if (Number.isFinite(itemCountMax) && itemCountMax >= 0) {
    query = query.lte("total_items", itemCountMax);
  }

  if (search) {
    const escaped = search.replace(/[%_]/g, "\\$&");
    switch (params.searchField) {
      case "from_branch_code":
        query = query
          .eq("from_branch.tenant_id", tenantId)
          .ilike("from_branch.code", `%${escaped}%`);
        break;
      case "from_branch_name":
        query = query
          .eq("from_branch.tenant_id", tenantId)
          .ilike("from_branch.name", `%${escaped}%`);
        break;
      case "to_branch_code":
        query = query
          .eq("to_branch.tenant_id", tenantId)
          .ilike("to_branch.code", `%${escaped}%`);
        break;
      case "to_branch_name":
        query = query
          .eq("to_branch.tenant_id", tenantId)
          .ilike("to_branch.name", `%${escaped}%`);
        break;
      case "creator_name":
        query = query
          .eq("creator.tenant_id", tenantId)
          .ilike("creator.full_name", `%${escaped}%`);
        break;
      case "product_code":
        query = query.ilike("item_match.product_code", `%${escaped}%`);
        break;
      case "product_name":
        query = query.ilike("item_match.product_name", `%${escaped}%`);
        break;
      case "note":
        query = query.ilike("note", `%${escaped}%`);
        break;
      case "code":
      default:
        query = query.ilike("code", `%${escaped}%`);
        break;
    }
  }

  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getStockTransfers");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transfers: StockTransfer[] = (data ?? []).map((row: any) => ({
    id: row.id,
    code: row.code,
    fromBranchId: row.from_branch_id,
    fromBranchCode: row.from_branch?.code ?? "",
    fromBranchName: row.from_branch?.name ?? "—",
    toBranchId: row.to_branch_id,
    toBranchCode: row.to_branch?.code ?? "",
    toBranchName: row.to_branch?.name ?? "—",
    status: row.status as StockTransferStatus,
    totalItems: row.total_items ?? 0,
    note: row.note ?? "",
    createdBy: row.created_by ?? "",
    createdByName: (row.creator as { full_name: string } | null)?.full_name ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
  }));

  return { data: transfers, total: count ?? 0 };
}

export async function getStockTransfersForExport(
  params: Omit<QueryParams, "page" | "pageSize">,
): Promise<StockTransferExportRow[]> {
  const supabase = getClient();
  const headers: StockTransfer[] = [];
  const batchSize = 500;

  for (let page = 0; ; page += 1) {
    const result = await getStockTransfers({
      ...params,
      page,
      pageSize: batchSize,
    });
    headers.push(...result.data);
    if (headers.length >= result.total || result.data.length < batchSize) break;
  }
  if (headers.length === 0) return [];

  const transferIds = headers.map((header) => header.id);
  const itemRows: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < transferIds.length; offset += 200) {
    const { data, error } = await supabase
      .from("stock_transfer_items")
      .select("transfer_id, product_code, product_name, unit, quantity")
      .in("transfer_id", transferIds.slice(offset, offset + 200));
    if (error) handleError(error, "getStockTransfersForExport.items");
    itemRows.push(...((data ?? []) as Array<Record<string, unknown>>));
  }

  const itemsByTransfer = new Map<string, Array<Record<string, unknown>>>();
  for (const item of itemRows) {
    const transferId = item.transfer_id as string;
    const current = itemsByTransfer.get(transferId) ?? [];
    current.push(item);
    itemsByTransfer.set(transferId, current);
  }

  const statusMeta = getTransferStatusMeta();
  const rows: StockTransferExportRow[] = [];
  for (const header of headers) {
    const items = itemsByTransfer.get(header.id) ?? [null];
    for (const item of items) {
      rows.push({
        code: header.code,
        status: statusMeta[header.status].label,
        fromBranchCode: header.fromBranchCode,
        fromBranchName: header.fromBranchName,
        toBranchCode: header.toBranchCode,
        toBranchName: header.toBranchName,
        productCode: item ? String(item.product_code ?? "") : "",
        productName: item ? String(item.product_name ?? "") : "",
        unit: item ? String(item.unit ?? "") : "",
        quantity: item ? Number(item.quantity ?? 0) : 0,
        note: header.note,
        createdByName: header.createdByName ?? "",
        createdAt: header.createdAt,
        completedAt: header.completedAt ?? "",
      });
    }
  }
  return rows;
}

export function getTransferStatuses() {
  const meta = getTransferStatusMeta();
  return (Object.keys(meta) as StockTransferStatus[]).map((value) => ({
    label: meta[value].label,
    value,
    count: 0,
  }));
}

/**
 * Lấy chi tiết phiếu chuyển kho — bao gồm items — dùng cho InlineDetailPanel.
 */
export async function getStockTransferById(id: string): Promise<{
  transfer: StockTransfer;
  items: StockTransferItem[];
} | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: headerRow, error: headerErr } = await (supabase as any)
    .from("stock_transfers")
    .select(
      `*,
       from_branch:from_branch_id(code, name),
       to_branch:to_branch_id(code, name)`
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .single();

  if (headerErr || !headerRow) {
    if (headerErr) handleError(headerErr, "getStockTransferById:header");
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: itemRows, error: itemErr } = await (supabase as any)
    .from("stock_transfer_items")
    .select("product_id, product_name, product_code, unit, quantity, note")
    .eq("transfer_id", id);

  if (itemErr) handleError(itemErr, "getStockTransferById:items");

  const transfer: StockTransfer = {
    id: headerRow.id,
    code: headerRow.code,
    fromBranchId: headerRow.from_branch_id,
    fromBranchCode: headerRow.from_branch?.code ?? "",
    fromBranchName: headerRow.from_branch?.name ?? "—",
    toBranchId: headerRow.to_branch_id,
    toBranchCode: headerRow.to_branch?.code ?? "",
    toBranchName: headerRow.to_branch?.name ?? "—",
    status: headerRow.status as StockTransferStatus,
    totalItems: headerRow.total_items ?? 0,
    note: headerRow.note ?? "",
    createdBy: headerRow.created_by ?? "",
    createdAt: headerRow.created_at,
    updatedAt: headerRow.updated_at,
    completedAt: headerRow.completed_at ?? null,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: StockTransferItem[] = (itemRows ?? []).map((r: any) => ({
    productId: r.product_id,
    productName: r.product_name ?? "",
    productCode: r.product_code ?? "",
    unit: r.unit ?? undefined,
    quantity: Number(r.quantity ?? 0),
    note: r.note ?? undefined,
  }));

  return { transfer, items };
}

/* ------------------------------------------------------------------ */
/*  Create                                                             */
/* ------------------------------------------------------------------ */

export async function createStockTransfer(
  input: CreateStockTransferInput
): Promise<{ id: string; code: string }> {
  if (input.fromBranchId === input.toBranchId) {
    throw new Error("Chi nhánh nguồn và đích không được trùng nhau");
  }
  if (!input.items.length) {
    throw new Error("Phiếu chuyển kho phải có ít nhất 1 sản phẩm");
  }
  for (const item of input.items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error(
        "Số lượng của " + item.productName + " phải lớn hơn 0",
      );
    }
  }

  const supabase = getClient();
  // Máy chủ tự xác định tenant, người thao tác và dữ liệu sản phẩm.
  // Đầu phiếu và toàn bộ dòng hàng được ghi cùng một giao dịch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "create_stock_transfer_atomic",
    {
      p_from_branch_id: input.fromBranchId,
      p_to_branch_id: input.toBranchId,
      p_note: input.note?.trim() || null,
      p_items: input.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
        note: item.note?.trim() || null,
      })),
    },
  );

  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có migration 00256. Không thể tạo phiếu chuyển kho an toàn.",
      );
    }
    handleError(error, "createStockTransfer.atomic");
  }

  const result = data as { transfer_id?: string; code?: string } | null;
  if (!result?.transfer_id || !result.code) {
    throw new Error("Máy chủ trả về kết quả tạo phiếu chuyển kho không hợp lệ");
  }
  return { id: result.transfer_id, code: result.code };
}

/* ------------------------------------------------------------------ */
/*  Complete — commits stock movement                                  */
/* ------------------------------------------------------------------ */

/**
 * Complete a stock transfer via one Postgres transaction.
 *
 * The RPC claims the transfer, writes OUT/IN ledger rows, and rebalances
 * branch_stock for source/target branches. products.stock stays unchanged.
 */
export async function completeStockTransfer(transferId: string): Promise<void> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)("complete_stock_transfer_atomic", {
    p_tenant_id: ctx.tenantId,
    p_transfer_id: transferId,
    p_created_by: ctx.userId,
  });
  if (error) handleError(error, "completeStockTransfer.atomic_rpc");
}

/* ------------------------------------------------------------------ */
/*  Cancel                                                             */
/* ------------------------------------------------------------------ */

export async function cancelStockTransfer(transferId: string): Promise<void> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)(
    "set_stock_transfer_state_atomic",
    {
      p_transfer_id: transferId,
      p_new_status: "cancelled",
    },
  );
  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có migration 00256. Không thể hủy phiếu chuyển kho an toàn.",
      );
    }
    handleError(error, "cancelStockTransfer.atomic");
  }
}

/* ------------------------------------------------------------------ */
/*  Update status (generic transition)                                 */
/* ------------------------------------------------------------------ */

export async function updateTransferStatus(
  transferId: string,
  newStatus: StockTransferStatus
): Promise<void> {
  if (newStatus === "completed") {
    await completeStockTransfer(transferId);
    return;
  }
  if (newStatus === "cancelled") {
    await cancelStockTransfer(transferId);
    return;
  }
  if (newStatus !== "in_transit") {
    throw new Error("Không thể chuyển phiếu sang trạng thái " + newStatus);
  }

  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)(
    "set_stock_transfer_state_atomic",
    {
      p_transfer_id: transferId,
      p_new_status: "in_transit",
    },
  );
  if (error) {
    if (isRpcUnavailable(error)) {
      throw new Error(
        "Chưa có migration 00256. Không thể đổi trạng thái chuyển kho an toàn.",
      );
    }
    handleError(error, "updateTransferStatus.atomic");
  }
}
