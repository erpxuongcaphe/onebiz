import { getClient, handleError } from "./base";
import type { CustomerListWorkspaceParams } from "./customers";
import type { SupplierListWorkspaceParams } from "./suppliers";
import { normalizeCreatedAtRange } from "@/lib/utils/list-date-preset-range";
import { parsePartyDirectoryPage, readPartyDirectoryPages, type PartyDirectoryKind } from "./party-directory-reader";

interface ReadOptions { exportAll?: boolean; signal?: AbortSignal }
type DirectoryParams = { page: number; pageSize: number; branchId: string | null };
type SortParams = { sortBy?: string; sortDesc?: boolean };
type RpcArgs = Record<string, string | number | boolean | string[] | null>;

function optional(value: string | undefined): string | null {
  return !value || value === "all" ? null : value;
}
function numberFilter(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Khoảng giá trị lọc không hợp lệ.");
  return parsed;
}
function dateFilters(params: { dateFrom?: string; dateTo?: string }): RpcArgs {
  const { from, toExclusive } = normalizeCreatedAtRange(params);
  if ((from && !from.includes("T")) || (toExclusive && !toExclusive.includes("T"))
    || (from && toExclusive && Date.parse(from) >= Date.parse(toExclusive))) {
    throw new Error("Khoảng thời gian lọc không hợp lệ.");
  }
  return { p_created_from: from ?? null, p_created_to_exclusive: toExclusive ?? null };
}
function range(min: number | null, max: number | null): void {
  if (min !== null && max !== null && min > max) throw new Error("Giá trị từ không được lớn hơn giá trị đến.");
}
async function readDirectory(kind: PartyDirectoryKind, params: DirectoryParams, filters: RpcArgs, options: ReadOptions) {
  if ((!options.exportAll && (!Number.isSafeInteger(params.page) || params.page < 0
    || !Number.isSafeInteger(params.pageSize) || params.pageSize < 1 || params.pageSize > 200))
    || (params.branchId !== null && !params.branchId.trim())) throw new Error("Phạm vi danh sách không hợp lệ.");
  const rpcName = kind === "customer" ? "get_customer_list_workspace_scoped" : "get_supplier_list_workspace_scoped";
  const read = async (request: DirectoryParams) => {
    options.signal?.throwIfAborted();
    // Staged source: callers switch only after the scoped RPC is installed and accepted.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = (getClient().rpc as any)(rpcName, {
      ...filters, p_branch_id: request.branchId, p_page: request.page, p_page_size: request.pageSize,
      p_for_export: options.exportAll === true,
    });
    const { data, error } = await (options.signal && typeof query.abortSignal === "function" ? query.abortSignal(options.signal) : query);
    options.signal?.throwIfAborted();
    if (error) handleError(error, rpcName);
    return data as unknown;
  };
  if (options.exportAll) return readPartyDirectoryPages(kind, params.branchId, read, options.signal);
  return parsePartyDirectoryPage(kind, await read(params), params);
}

export function getScopedCustomerDirectory(
  params: Omit<CustomerListWorkspaceParams, "branchId"> & { branchId: string | null } & SortParams, options: ReadOptions = {},
) {
  const birthdayMonth = optional(params.birthdayMonth) === null ? null : Number(params.birthdayMonth);
  if (birthdayMonth !== null && (!Number.isInteger(birthdayMonth) || birthdayMonth < 1 || birthdayMonth > 12)) {
    throw new Error("Tháng sinh không hợp lệ.");
  }
  return readDirectory("customer", params, {
    ...dateFilters(params), ...sortFilters("customer", params), p_search: params.search?.trim() || null, p_search_field: params.searchField || "all",
    p_group_ids: params.groupIds?.length ? [...params.groupIds] : null,
    p_customer_type: optional(params.customerType), p_gender: optional(params.gender),
    p_debt_filter: optional(params.debtFilter), p_sales_range: optional(params.salesRange),
    p_orders_range: optional(params.ordersRange), p_last_purchase: optional(params.lastPurchase),
    p_birthday_month: birthdayMonth, p_tags: params.tags?.length ? [...params.tags] : null,
    p_province: optional(params.province),
  }, options);
}

export function getScopedSupplierDirectory(
  params: SupplierListWorkspaceParams & { branchId: string | null } & SortParams, options: ReadOptions = {},
) {
  const debtMin = numberFilter(params.debtFrom), debtMax = numberFilter(params.debtTo);
  const purchasesMin = numberFilter(params.totalPurchaseFrom), purchasesMax = numberFilter(params.totalPurchaseTo);
  range(debtMin, debtMax); range(purchasesMin, purchasesMax);
  return readDirectory("supplier", params, {
    ...dateFilters(params), ...sortFilters("supplier", params), p_search: params.search?.trim() || null, p_search_field: params.searchField || "all",
    p_statuses: params.statuses?.length ? [...params.statuses] : null, p_province: optional(params.province),
    p_debt_min: debtMin, p_debt_max: debtMax, p_total_purchase_min: purchasesMin, p_total_purchase_max: purchasesMax,
  }, options);
}
function sortFilters(kind: PartyDirectoryKind, params: SortParams): RpcArgs {
  const allowed = kind === "customer" ? ["createdAt", "code", "name", "phone", "currentDebt", "totalSales", "totalSalesMinusReturns", "loyaltyPoints"]
    : ["createdAt", "code", "name", "phone", "email", "currentDebt", "totalPurchases"];
  if (params.sortBy !== undefined && !allowed.includes(params.sortBy) || params.sortDesc !== undefined && typeof params.sortDesc !== "boolean") {
    throw new Error("Chỉ tiêu sắp xếp không hợp lệ.");
  }
  return { p_sort_by: params.sortBy ?? "createdAt", p_sort_desc: params.sortDesc ?? true };
}
