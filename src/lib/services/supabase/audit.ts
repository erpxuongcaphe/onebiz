/**
 * Supabase service: Audit Log (Lịch sử thao tác)
 *
 * Sprint 7 "Toàn Cảnh"
 *
 * Reads from `audit_log` table (created by triggers in 00001_initial_schema).
 * Provides filtered, paginated queries for the audit page.
 */

import type { QueryParams, QueryResult } from "@/lib/types";
import {
  getClient,
  getPaginationRange,
  handleError,
} from "./base";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  actionLabel: string;
  entityType: string;
  entityTypeLabel: string;
  entityId: string;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditFilters {
  action?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
}

/* ------------------------------------------------------------------ */
/*  Label maps (Vietnamese)                                            */
/* ------------------------------------------------------------------ */

const ACTION_LABELS: Record<string, string> = {
  create: "Tạo mới",
  update: "Cập nhật",
  delete: "Xóa",
  complete: "Hoàn thành",
  cancel: "Hủy",
  approve: "Duyệt",
  receive: "Nhập hàng",
  return: "Trả hàng",
  transfer: "Chuyển kho",
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  invoice: "Hóa đơn",
  product: "Sản phẩm",
  customer: "Khách hàng",
  supplier: "Nhà cung cấp",
  purchase_order: "Đơn nhập hàng",
  cash_transaction: "Phiếu thu/chi",
  sales_order: "Đơn đặt hàng",
  stock_movement: "Phiếu kho",
  stock_transfer: "Chuyển kho",
  production_order: "Lệnh sản xuất",
  disposal_export: "Phiếu xuất hủy",
  internal_export: "Phiếu xuất nội bộ",
  return: "Phiếu trả hàng",
  input_invoice: "Hóa đơn đầu vào",
  internal_sale: "Bán hàng nội bộ",
  inventory_check: "Kiểm kho",
  purchase_return: "Phiếu trả hàng nhập",
};

export function getActionOptions() {
  return Object.entries(ACTION_LABELS).map(([value, label]) => ({
    value,
    label,
  }));
}

export function getEntityTypeOptions() {
  return Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => ({
    value,
    label,
  }));
}

/* ------------------------------------------------------------------ */
/*  Query                                                              */
/* ------------------------------------------------------------------ */

export async function getAuditLogs(
  params: QueryParams & { filters?: AuditFilters }
): Promise<QueryResult<AuditLogEntry>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("audit_log")
    .select(
      "id, user_id, action, entity_type, entity_id, old_data, new_data, ip_address, created_at, profiles!audit_log_user_id_fkey(full_name)",
      { count: "exact" }
    );

  // Filters
  const filters = params.filters as AuditFilters | undefined;

  if (filters?.action && filters.action !== "all") {
    query = query.eq("action", filters.action);
  }
  if (filters?.entityType && filters.entityType !== "all") {
    query = query.eq("entity_type", filters.entityType);
  }
  if (filters?.dateFrom) {
    query = query.gte("created_at", filters.dateFrom);
  }
  if (filters?.dateTo) {
    // Add 1 day to include the full day
    const endDate = new Date(filters.dateTo);
    endDate.setDate(endDate.getDate() + 1);
    query = query.lt("created_at", endDate.toISOString());
  }

  // Search — by entity_id or user name
  if (params.search) {
    query = query.or(
      `entity_id.ilike.%${params.search}%,action.ilike.%${params.search}%`
    );
  }

  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) {
    // audit_log might not have FK — graceful fallback
    console.warn("getAuditLogs error:", error.message);
    return { data: [], total: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries: AuditLogEntry[] = (data ?? []).map((row: any) => {
    const profile = row.profiles as { full_name: string } | null;
    const action = row.action as string;
    const entityType = row.entity_type as string;

    return {
      id: row.id,
      userId: row.user_id ?? "",
      userName: profile?.full_name ?? "Hệ thống",
      action,
      actionLabel: ACTION_LABELS[action] ?? action,
      entityType,
      entityTypeLabel: ENTITY_TYPE_LABELS[entityType] ?? entityType,
      entityId: row.entity_id ?? "",
      oldData: row.old_data ?? null,
      newData: row.new_data ?? null,
      ipAddress: row.ip_address ?? null,
      createdAt: row.created_at,
    };
  });

  return { data: entries, total: count ?? 0 };
}

/* ------------------------------------------------------------------ */
/*  Lookup by entity — dùng cho InlineDetailPanel "Lịch sử" tab        */
/* ------------------------------------------------------------------ */

/**
 * Lấy audit log của một entity cụ thể (theo entity_type + entity_id).
 * Dùng cho tab "Lịch sử" trong InlineDetailPanel. Giới hạn 50 bản ghi
 * gần nhất theo `created_at DESC`.
 */
export async function getAuditLogsByEntity(
  entityType: string,
  entityId: string,
  limit: number = 50
): Promise<AuditLogEntry[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select(
      "id, user_id, action, entity_type, entity_id, old_data, new_data, ip_address, created_at, profiles!audit_log_user_id_fkey(full_name)"
    )
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("getAuditLogsByEntity error:", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => {
    const profile = row.profiles as { full_name: string } | null;
    const action = row.action as string;
    const et = row.entity_type as string;
    return {
      id: row.id,
      userId: row.user_id ?? "",
      userName: profile?.full_name ?? "Hệ thống",
      action,
      actionLabel: ACTION_LABELS[action] ?? action,
      entityType: et,
      entityTypeLabel: ENTITY_TYPE_LABELS[et] ?? et,
      entityId: row.entity_id ?? "",
      oldData: row.old_data ?? null,
      newData: row.new_data ?? null,
      ipAddress: row.ip_address ?? null,
      createdAt: row.created_at,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Stats (summary for audit page header)                              */
/* ------------------------------------------------------------------ */

export async function getAuditStats(): Promise<{
  totalToday: number;
  totalWeek: number;
  topAction: string;
  topEntity: string;
}> {
  const supabase = getClient();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString();

  const [todayRes, weekRes] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStart),
    supabase
      .from("audit_log")
      .select("action, entity_type")
      .gte("created_at", weekStart),
  ]);

  const totalToday = todayRes.count ?? 0;
  const weekData = weekRes.data ?? [];
  const totalWeek = weekData.length;

  // Find most common action and entity
  const actionCounts = new Map<string, number>();
  const entityCounts = new Map<string, number>();
  for (const row of weekData) {
    const a = row.action as string;
    const e = row.entity_type as string;
    actionCounts.set(a, (actionCounts.get(a) ?? 0) + 1);
    entityCounts.set(e, (entityCounts.get(e) ?? 0) + 1);
  }

  let topAction = "—";
  let topActionCount = 0;
  for (const [k, v] of actionCounts) {
    if (v > topActionCount) {
      topActionCount = v;
      topAction = ACTION_LABELS[k] ?? k;
    }
  }

  let topEntity = "—";
  let topEntityCount = 0;
  for (const [k, v] of entityCounts) {
    if (v > topEntityCount) {
      topEntityCount = v;
      topEntity = ENTITY_TYPE_LABELS[k] ?? k;
    }
  }

  return { totalToday, totalWeek, topAction, topEntity };
}
