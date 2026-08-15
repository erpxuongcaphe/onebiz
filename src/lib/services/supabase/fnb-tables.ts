/**
 * F&B Service: Restaurant Tables.
 *
 * F1a 15/08/2026: TOÀN BỘ đường ghi cấu hình chuyển sang RPC 00323
 * `fnb_table_config_atomic` — tenant/quyền chốt phía máy chủ, client không
 * còn truyền tenant_id. Đọc vẫn qua PostgREST như cũ.
 *
 * Các hàm vận hành trạng thái bàn (chuyển/gộp/nhả) KHÔNG nằm ở đây — dùng
 * RPC riêng (00275/00321/00322). updateTableStatus/claimTable/releaseTable
 * đã bị gỡ (0 caller — cùng đợt dọn với PR #217).
 */

import type { RestaurantTable } from "@/lib/types/fnb";
import { getClient, handleError, getCurrentTenantId } from "./base";

// ── Mappers ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTable(row: any): RestaurantTable {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    tableNumber: row.table_number,
    name: row.name,
    zone: row.zone,
    capacity: row.capacity,
    status: row.status,
    currentOrderId: row.current_order_id,
    positionX: row.position_x,
    positionY: row.position_y,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

/** Gọi RPC cấu hình bàn — một cửa duy nhất cho mọi thao tác ghi. */
async function goiCauHinhBan(
  action: string,
  branchId: string,
  payload: Record<string, unknown>,
  context: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const { data, error } = await supabase.rpc("fnb_table_config_atomic", {
    p_action: action,
    p_branch_id: branchId,
    p_payload: payload,
  });
  if (error) handleError(error, context);
  return data;
}

// ── Queries (giữ nguyên — chỉ đọc) ──

export async function getTablesByBranch(branchId: string): Promise<RestaurantTable[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("restaurant_tables")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) handleError(error, "getTablesByBranch");
  return (data ?? []).map(mapTable);
}

/**
 * Get distinct zones for a branch (for zone management UI).
 */
export async function getZonesByBranch(branchId: string): Promise<string[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("restaurant_tables")
    .select("zone")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("is_active", true);

  if (error) handleError(error, "getZonesByBranch");

  const zones = new Set<string>();
  for (const row of data ?? []) {
    if (row.zone) zones.add(row.zone);
  }
  return Array.from(zones).sort();
}

// ── Mutations — tất cả qua RPC 00323 ──

export async function createTable(input: {
  branchId: string;
  tableNumber: number;
  name: string;
  zone?: string;
  capacity?: number;
  /** Gán luôn vào sơ đồ (khu + hình + vị trí) trong CÙNG một giao dịch. */
  zoneId?: string;
  shape?: string;
  positionX?: number;
  positionY?: number;
}): Promise<RestaurantTable> {
  const payload: Record<string, unknown> = {
    table_number: input.tableNumber,
    name: input.name,
  };
  if (input.zone !== undefined) payload.zone = input.zone;
  if (input.capacity !== undefined) payload.capacity = input.capacity;
  if (input.zoneId !== undefined) payload.zone_id = input.zoneId;
  if (input.shape !== undefined) payload.shape = input.shape;
  if (input.positionX !== undefined) payload.position_x = input.positionX;
  if (input.positionY !== undefined) payload.position_y = input.positionY;

  const data = await goiCauHinhBan("create", input.branchId, payload, "createTable");
  return mapTable(data?.table ?? {});
}

/**
 * Mark table as available (after cleaning) — RPC vận hành có sẵn (00275).
 */
export async function markTableAvailable(tableId: string): Promise<void> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)(
    "mark_fnb_table_available_atomic",
    { p_table_id: tableId },
  );
  if (error) handleError(error, "markTableAvailable.rpc");
}

// ── Table Management (Admin CRUD) ──

export async function updateTable(
  branchId: string,
  tableId: string,
  input: {
    name?: string;
    tableNumber?: number;
    zone?: string | null;
    capacity?: number;
    sortOrder?: number;
    positionX?: number;
    positionY?: number;
  }
): Promise<RestaurantTable> {
  const payload: Record<string, unknown> = { table_id: tableId };
  if (input.name !== undefined) payload.name = input.name;
  if (input.tableNumber !== undefined) payload.table_number = input.tableNumber;
  if (input.zone !== undefined) payload.zone = input.zone ?? "";
  if (input.capacity !== undefined) payload.capacity = input.capacity;
  if (input.sortOrder !== undefined) payload.sort_order = input.sortOrder;
  if (input.positionX !== undefined) payload.position_x = input.positionX;
  if (input.positionY !== undefined) payload.position_y = input.positionY;

  const data = await goiCauHinhBan("update", branchId, payload, "updateTable");
  return mapTable(data?.table ?? {});
}

/**
 * Xoá mềm 1 bàn. Bàn đang phục vụ hoặc còn đơn → máy chủ CHẶN và báo tiếng
 * Việt rõ (trước đây im lặng không xoá).
 */
export async function deleteTable(branchId: string, tableId: string): Promise<void> {
  await goiCauHinhBan("delete", branchId, { table_id: tableId }, "deleteTable");
}

/**
 * Bulk-create tables for a zone (e.g., "Tầng 1" with 8 tables).
 */
export async function bulkCreateTables(input: {
  branchId: string;
  zone: string;
  count: number;
  startNumber: number;
  capacity?: number;
}): Promise<void> {
  const payload: Record<string, unknown> = {
    zone: input.zone,
    count: input.count,
    start_number: input.startNumber,
  };
  if (input.capacity !== undefined) payload.capacity = input.capacity;
  await goiCauHinhBan("bulk_create", input.branchId, payload, "bulkCreateTables");
}

/**
 * Rename a zone. Máy chủ đồng bộ luôn tên khu sơ đồ trùng tên (nếu có) để hai
 * màn không lệch nhau.
 */
export async function renameZone(
  branchId: string,
  oldZone: string,
  newZone: string
): Promise<void> {
  await goiCauHinhBan(
    "zone_rename",
    branchId,
    { old_zone: oldZone, new_zone: newZone },
    "renameZone",
  );
}

/**
 * Xoá mềm cả khu (toàn bộ bàn trong khu). Còn BẤT KỲ bàn nào đang phục vụ /
 * còn đơn → máy chủ chặn TOÀN BỘ thao tác (trước đây xoá một phần im lặng).
 */
export async function deleteZone(
  branchId: string,
  zone: string
): Promise<void> {
  await goiCauHinhBan("zone_delete", branchId, { zone }, "deleteZone");
}
