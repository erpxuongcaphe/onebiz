/**
 * Sơ đồ bàn — CRUD khu vực + cập nhật vị trí bàn.
 * CEO 04/06/2026 — Sprint 5 Phase A.
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

export async function createFloorPlanZone(input: {
  branchId: string;
  name: string;
  canvasWidth?: number;
  canvasHeight?: number;
  floorLevel?: number;
}): Promise<FloorPlanZone> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("floor_plan_zones")
    .insert({
      tenant_id: ctx.tenantId,
      branch_id: input.branchId,
      name: input.name,
      canvas_width: input.canvasWidth ?? 1024,
      canvas_height: input.canvasHeight ?? 720,
      floor_level: input.floorLevel ?? 1,
    })
    .select("*")
    .single();
  if (error) handleError(error, "createZone");
  return mapZone(data);
}

export async function updateFloorPlanZone(
  id: string,
  patch: Partial<
    Omit<FloorPlanZone, "id" | "tenantId" | "branchId" | "createdAt" | "updatedAt">
  >,
): Promise<void> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  const updateObj: Record<string, unknown> = {};
  if (patch.name !== undefined) updateObj.name = patch.name;
  if (patch.sortOrder !== undefined) updateObj.sort_order = patch.sortOrder;
  if (patch.canvasWidth !== undefined) updateObj.canvas_width = patch.canvasWidth;
  if (patch.canvasHeight !== undefined) updateObj.canvas_height = patch.canvasHeight;
  if (patch.backgroundUrl !== undefined) updateObj.background_url = patch.backgroundUrl;
  if (patch.backgroundOpacity !== undefined)
    updateObj.background_opacity = patch.backgroundOpacity;
  if (patch.gridSize !== undefined) updateObj.grid_size = patch.gridSize;
  if (patch.overlayColor !== undefined) updateObj.overlay_color = patch.overlayColor;
  if (patch.floorLevel !== undefined) updateObj.floor_level = patch.floorLevel;
  if (patch.isActive !== undefined) updateObj.is_active = patch.isActive;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("floor_plan_zones")
    .update(updateObj)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) handleError(error, "updateZone");
}

export async function deleteFloorPlanZone(id: string): Promise<void> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // Soft delete: set is_active = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("floor_plan_zones")
    .update({ is_active: false })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) handleError(error, "deleteZone");
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

/** Cập nhật vị trí + kích thước + xoay 1 bàn (debounced ở UI). */
export async function updateTableLayout(
  tableId: string,
  patch: Partial<
    Pick<
      TableLayout,
      "shape" | "width" | "height" | "rotation" | "positionX" | "positionY" | "color" | "locked" | "zoneId"
    >
  >,
): Promise<void> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  const updateObj: Record<string, unknown> = {};
  if (patch.shape !== undefined) updateObj.shape = patch.shape;
  if (patch.width !== undefined) updateObj.width = Math.round(patch.width);
  if (patch.height !== undefined) updateObj.height = Math.round(patch.height);
  if (patch.rotation !== undefined)
    updateObj.rotation = Math.round(patch.rotation) % 360;
  if (patch.positionX !== undefined) updateObj.position_x = Math.round(patch.positionX);
  if (patch.positionY !== undefined) updateObj.position_y = Math.round(patch.positionY);
  if (patch.color !== undefined) updateObj.color = patch.color;
  if (patch.locked !== undefined) updateObj.locked = patch.locked;
  if (patch.zoneId !== undefined) updateObj.zone_id = patch.zoneId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("restaurant_tables")
    .update(updateObj)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", tableId);
  if (error) handleError(error, "updateTableLayout");
}

/** Bulk save toàn bộ vị trí trong 1 zone (dùng khi user bấm "Lưu sơ đồ"). */
export async function bulkSaveTableLayouts(
  layouts: Array<Pick<TableLayout, "id"> & Partial<TableLayout>>,
): Promise<void> {
  for (const l of layouts) {
    const { id, ...rest } = l;
    await updateTableLayout(id, rest);
  }
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
