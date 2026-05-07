/**
 * Kitchen Stations Service — Sprint KITCHEN-1 (CEO 07/05).
 *
 * Trạm chế biến (Bar/Bếp/Quầy bánh...). Mỗi quán có 1+ station, mỗi
 * category gán vào 1 station → khi gửi bếp tự split items + in 1 phiếu/station.
 *
 * Migration 00054_kitchen_stations.sql tạo bảng + seed default "Bar pha chế"
 * cho mỗi branch FnB hiện có.
 *
 * Lưu ý: TS Database types chưa regen sau migration → cast `as any` cho
 * Supabase calls. Sau khi user chạy `supabase gen types` có thể bỏ.
 */

import { getClient, getCurrentTenantId, handleError } from "./base";
import { recordAuditLog } from "./audit";

export interface KitchenStation {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  color: string;
  icon: string;
  settings: KitchenStationSettings;
  createdAt: string;
  updatedAt: string;
}

export interface KitchenStationSettings {
  /** Tự động in phiếu khi có item gán cho station này (default true). */
  auto_print?: boolean;
  /** Hiện trên KDS (default true). Tắt nếu station chỉ in giấy. */
  show_on_kds?: boolean;
  /** Header text custom cho phiếu in (default = name uppercase). */
  header_text?: string;
  /** Font size header in phiếu: "S" | "M" | "L" | "XL" (default "L"). */
  header_size?: "S" | "M" | "L" | "XL";
  /** Printer config ID — gán máy in riêng cho station (Sprint KITCHEN-2). */
  printer_config_id?: string | null;
}

export interface CreateKitchenStationInput {
  branchId: string;
  name: string;
  sortOrder?: number;
  color?: string;
  icon?: string;
  settings?: KitchenStationSettings;
}

export interface UpdateKitchenStationInput {
  name?: string;
  sortOrder?: number;
  isActive?: boolean;
  color?: string;
  icon?: string;
  settings?: KitchenStationSettings;
}

// ============================================================
// Mappers
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapStation(row: any): KitchenStation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    name: row.name,
    sortOrder: row.sort_order ?? 0,
    isActive: row.is_active ?? true,
    color: row.color ?? "#2563eb",
    icon: row.icon ?? "restaurant",
    settings: (row.settings ?? {}) as KitchenStationSettings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Queries
// ============================================================

export async function getKitchenStationsByBranch(
  branchId: string,
): Promise<KitchenStation[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("kitchen_stations")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    // Migration 00054 chưa apply → bảng không tồn tại. Fallback empty
    // để UI render OK, không crash.
    console.warn("[getKitchenStationsByBranch]", error.message);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(mapStation);
}

/**
 * Đọc tất cả station của tenant (cross-branch). Dùng cho admin tổng hợp.
 */
export async function getAllKitchenStations(): Promise<KitchenStation[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("kitchen_stations")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("branch_id, sort_order", { ascending: true });

  if (error) {
    console.warn("[getAllKitchenStations]", error.message);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(mapStation);
}

// ============================================================
// Mutations
// ============================================================

export async function createKitchenStation(
  input: CreateKitchenStationInput,
): Promise<KitchenStation> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const insertData = {
    tenant_id: tenantId,
    branch_id: input.branchId,
    name: input.name,
    sort_order: input.sortOrder ?? 999,
    color: input.color ?? "#2563eb",
    icon: input.icon ?? "restaurant",
    settings: input.settings ?? {},
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("kitchen_stations")
    .insert(insertData)
    .select()
    .single();

  if (error) handleError(error, "createKitchenStation");
  if (!data) throw new Error("Không tạo được trạm");

  await recordAuditLog({
    entityType: "kitchen_station",
    entityId: data.id,
    action: "create",
    newData: insertData,
  });

  return mapStation(data);
}

export async function updateKitchenStation(
  id: string,
  patch: UpdateKitchenStationInput,
): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Snapshot cho audit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prev } = await (supabase as any)
    .from("kitchen_stations")
    .select("name, sort_order, is_active, color, icon, settings")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.name !== undefined) updateData.name = patch.name;
  if (patch.sortOrder !== undefined) updateData.sort_order = patch.sortOrder;
  if (patch.isActive !== undefined) updateData.is_active = patch.isActive;
  if (patch.color !== undefined) updateData.color = patch.color;
  if (patch.icon !== undefined) updateData.icon = patch.icon;
  if (patch.settings !== undefined) updateData.settings = patch.settings;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("kitchen_stations")
    .update(updateData)
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) handleError(error, "updateKitchenStation");

  await recordAuditLog({
    entityType: "kitchen_station",
    entityId: id,
    action: "update",
    oldData: (prev as Record<string, unknown>) ?? null,
    newData: updateData,
  });
}

/**
 * Soft-delete: set is_active = false. Categories đã gán vào station này
 * vẫn giữ kitchen_station_id (FK SET NULL khi station thực bị DELETE,
 * nhưng soft-delete chỉ flip flag → categories vẫn ref ID cũ).
 */
export async function deleteKitchenStation(id: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("kitchen_stations")
    .update({ is_active: false })
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) handleError(error, "deleteKitchenStation");

  await recordAuditLog({
    entityType: "kitchen_station",
    entityId: id,
    action: "delete",
  });
}

/**
 * Gán station cho category. NULL để bỏ gán (category sẽ dùng default station).
 */
export async function assignCategoryToStation(
  categoryId: string,
  stationId: string | null,
): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("categories")
    .update({ kitchen_station_id: stationId })
    .eq("tenant_id", tenantId)
    .eq("id", categoryId);

  if (error) handleError(error, "assignCategoryToStation");
}

/**
 * Bulk: lookup station_id cho list product_ids qua category → station chain.
 * Dùng khi sendToKitchen để fill kitchen_station_id vào kitchen_order_items.
 *
 * Trả Map<productId, stationId | null>. Product không có category → null →
 * caller fallback default station hoặc skip station_id.
 */
export async function getStationsByProductIds(
  productIds: string[],
): Promise<Map<string, string | null>> {
  if (productIds.length === 0) return new Map();
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("products")
    .select("id, category_id, categories!inner(kitchen_station_id)")
    .eq("tenant_id", tenantId)
    .in("id", productIds);

  if (error) {
    console.warn("[getStationsByProductIds]", error.message);
    return new Map();
  }

  const map = new Map<string, string | null>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const stationId =
      (row.categories?.kitchen_station_id as string | null) ?? null;
    map.set(row.id as string, stationId);
  }
  return map;
}
