/**
 * Sơ đồ bàn — CRUD khu vực + cập nhật vị trí bàn.
 * CEO 04/06/2026 — Sprint 5 Phase A.
 *
 * F1a 15/08/2026: TOÀN BỘ đường ghi chuyển sang RPC 00323
 * (`fnb_floor_zone_config_atomic` + `fnb_floor_layout_update_atomic`) —
 * quyền floor_plan.edit_global/edit_branch chốt phía máy chủ. Đọc giữ nguyên.
 * `bulkSaveTableLayouts` (vòng lặp không nguyên tử, 0 caller) đã gỡ — dùng
 * `updateTableLayouts` (lô, một giao dịch) khi cần lưu nhiều bàn.
 */

import { getClient, getCurrentContext, handleError } from "./base";

// ─── Types ───

export type TableShape =
  | "round"
  | "square"
  | "rect"
  | "sofa"
  | "booth"
  | "bar-seat";

export interface FloorPlanZone {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  sortOrder: number;
  canvasWidth: number;
  canvasHeight: number;
  backgroundUrl: string | null;
  backgroundOpacity: number;
  gridSize: number;
  overlayColor: string | null;
  floorLevel: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TableLayout {
  id: string;
  zoneId: string | null;
  shape: TableShape;
  width: number;
  height: number;
  rotation: number;
  positionX: number;
  positionY: number;
  color: string | null;
  locked: boolean;
}

// ─── Zones CRUD ───

export async function getFloorPlanZones(
  branchId: string,
): Promise<FloorPlanZone[]> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("floor_plan_zones")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .order("floor_level", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) handleError(error, "getZonesByBranch");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map(mapZone) as FloorPlanZone[];
}

/** Gọi RPC cấu hình khu sơ đồ — một cửa cho mọi thao tác ghi zone. */
async function goiCauHinhKhuSoDo(
  action: string,
  branchId: string,
  payload: Record<string, unknown>,
  context: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const { data, error } = await supabase.rpc("fnb_floor_zone_config_atomic", {
    p_action: action,
    p_branch_id: branchId,
    p_payload: payload,
  });
  if (error) handleError(error, context);
  return data;
}

export async function createFloorPlanZone(input: {
  branchId: string;
  name: string;
  canvasWidth?: number;
  canvasHeight?: number;
  floorLevel?: number;
}): Promise<FloorPlanZone> {
  const payload: Record<string, unknown> = { name: input.name };
  if (input.canvasWidth !== undefined) payload.canvas_width = input.canvasWidth;
  if (input.canvasHeight !== undefined) payload.canvas_height = input.canvasHeight;
  if (input.floorLevel !== undefined) payload.floor_level = input.floorLevel;
  const data = await goiCauHinhKhuSoDo("create", input.branchId, payload, "createZone");
  return mapZone(data?.zone ?? {});
}

export async function updateFloorPlanZone(
  branchId: string,
  id: string,
  patch: Partial<
    Omit<FloorPlanZone, "id" | "tenantId" | "branchId" | "isActive" | "createdAt" | "updatedAt">
  >,
): Promise<void> {
  const payload: Record<string, unknown> = { zone_id: id };
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.sortOrder !== undefined) payload.sort_order = patch.sortOrder;
  if (patch.canvasWidth !== undefined) payload.canvas_width = patch.canvasWidth;
  if (patch.canvasHeight !== undefined) payload.canvas_height = patch.canvasHeight;
  if (patch.backgroundUrl !== undefined) payload.background_url = patch.backgroundUrl ?? "";
  if (patch.backgroundOpacity !== undefined)
    payload.background_opacity = patch.backgroundOpacity;
  if (patch.gridSize !== undefined) payload.grid_size = patch.gridSize;
  if (patch.overlayColor !== undefined) payload.overlay_color = patch.overlayColor ?? "";
  if (patch.floorLevel !== undefined) payload.floor_level = patch.floorLevel;
  await goiCauHinhKhuSoDo("update", branchId, payload, "updateZone");
}

/**
 * Xoá mềm khu sơ đồ. Khu còn bàn → máy chủ CHẶN: "Chuyển bàn sang khu khác
 * trước khi xoá" (trước đây xoá được và để bàn mồ côi khu đã ẩn).
 */
export async function deleteFloorPlanZone(branchId: string, id: string): Promise<void> {
  await goiCauHinhKhuSoDo("delete", branchId, { zone_id: id }, "deleteZone");
}

// ─── Tables (layout-focused) ───

export async function getTablesByZone(zoneId: string): Promise<TableLayout[]> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("restaurant_tables")
    .select(
      "id, zone_id, shape, width, height, rotation, position_x, position_y, color, locked",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("zone_id", zoneId)
    .eq("is_active", true);
  if (error) handleError(error, "getTablesByZone");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id: r.id,
    zoneId: r.zone_id,
    shape: (r.shape ?? "round") as TableShape,
    width: r.width ?? 80,
    height: r.height ?? 80,
    rotation: r.rotation ?? 0,
    positionX: r.position_x ?? 0,
    positionY: r.position_y ?? 0,
    color: r.color,
    locked: r.locked ?? false,
  }));
}

type LayoutPatch = Partial<
  Pick<
    TableLayout,
    "shape" | "width" | "height" | "rotation" | "positionX" | "positionY" | "color" | "locked" | "zoneId"
  >
>;

function toLayoutItem(tableId: string, patch: LayoutPatch): Record<string, unknown> {
  const item: Record<string, unknown> = { table_id: tableId };
  if (patch.shape !== undefined) item.shape = patch.shape;
  if (patch.width !== undefined) item.width = Math.round(patch.width);
  if (patch.height !== undefined) item.height = Math.round(patch.height);
  if (patch.rotation !== undefined) item.rotation = Math.round(patch.rotation);
  if (patch.positionX !== undefined) item.position_x = Math.round(patch.positionX);
  if (patch.positionY !== undefined) item.position_y = Math.round(patch.positionY);
  if (patch.color !== undefined) item.color = patch.color ?? "";
  if (patch.locked !== undefined) item.locked = patch.locked;
  if (patch.zoneId !== undefined) item.zone_id = patch.zoneId;
  return item;
}

/**
 * Cập nhật layout MỘT bàn (debounced ở UI — giữ nguyên trải nghiệm kéo-thả
 * từng thao tác). Đi qua RPC lô với 1 phần tử.
 */
export async function updateTableLayout(
  tableId: string,
  patch: LayoutPatch,
): Promise<void> {
  await updateTableLayouts([{ id: tableId, ...patch }]);
}

/**
 * Cập nhật layout NHIỀU bàn trong MỘT giao dịch (thay cho vòng lặp
 * bulkSaveTableLayouts cũ — lỗi giữa chừng là hỏng nửa sơ đồ).
 */
export async function updateTableLayouts(
  layouts: Array<Pick<TableLayout, "id"> & LayoutPatch>,
): Promise<void> {
  if (layouts.length === 0) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const { error } = await supabase.rpc("fnb_floor_layout_update_atomic", {
    p_items: layouts.map(({ id, ...patch }) => toLayoutItem(id, patch)),
  });
  if (error) handleError(error, "updateTableLayout");
}

// ─── Mappers ───

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapZone(row: any): FloorPlanZone {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    name: row.name,
    sortOrder: row.sort_order ?? 0,
    canvasWidth: row.canvas_width ?? 1024,
    canvasHeight: row.canvas_height ?? 720,
    backgroundUrl: row.background_url ?? null,
    backgroundOpacity: row.background_opacity ?? 30,
    gridSize: row.grid_size ?? 16,
    overlayColor: row.overlay_color ?? null,
    floorLevel: row.floor_level ?? 1,
    isActive: row.is_active ?? true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
