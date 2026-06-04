/**
 * Đồ trang trí + ảnh nền cho sơ đồ bàn.
 * CEO 04/06/2026 — Sprint 5 Phase B.
 */

import { getClient, getCurrentContext, handleError } from "./base";

export type DecorationKind =
  | "door"
  | "plant"
  | "bar"
  | "restroom"
  | "window"
  | "tv"
  | "stairs"
  | "wall"
  | "custom";

export interface FloorPlanDecoration {
  id: string;
  zoneId: string;
  kind: DecorationKind;
  label: string | null;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  rotation: number;
  color: string | null;
  icon: string | null;
  locked: boolean;
  zIndex: number;
}

// ─── CRUD ───

export async function getDecorationsByZone(
  zoneId: string,
): Promise<FloorPlanDecoration[]> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("floor_plan_decorations")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("zone_id", zoneId)
    .order("z_index", { ascending: true });
  if (error) handleError(error, "getDecorationsByZone");
  return (data ?? []).map(mapDecoration);
}

export async function createDecoration(input: {
  branchId: string;
  zoneId: string;
  kind: DecorationKind;
  label?: string;
  positionX: number;
  positionY: number;
  width?: number;
  height?: number;
  color?: string;
  icon?: string;
}): Promise<FloorPlanDecoration> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("floor_plan_decorations")
    .insert({
      tenant_id: ctx.tenantId,
      branch_id: input.branchId,
      zone_id: input.zoneId,
      kind: input.kind,
      label: input.label ?? null,
      position_x: Math.round(input.positionX),
      position_y: Math.round(input.positionY),
      width: input.width ?? 60,
      height: input.height ?? 60,
      color: input.color ?? null,
      icon: input.icon ?? null,
    })
    .select("*")
    .single();
  if (error) handleError(error, "createDecoration");
  return mapDecoration(data);
}

export async function updateDecoration(
  id: string,
  patch: Partial<Omit<FloorPlanDecoration, "id" | "zoneId">>,
): Promise<void> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  const updateObj: Record<string, unknown> = {};
  if (patch.kind !== undefined) updateObj.kind = patch.kind;
  if (patch.label !== undefined) updateObj.label = patch.label;
  if (patch.positionX !== undefined) updateObj.position_x = Math.round(patch.positionX);
  if (patch.positionY !== undefined) updateObj.position_y = Math.round(patch.positionY);
  if (patch.width !== undefined) updateObj.width = Math.round(patch.width);
  if (patch.height !== undefined) updateObj.height = Math.round(patch.height);
  if (patch.rotation !== undefined) updateObj.rotation = Math.round(patch.rotation) % 360;
  if (patch.color !== undefined) updateObj.color = patch.color;
  if (patch.icon !== undefined) updateObj.icon = patch.icon;
  if (patch.locked !== undefined) updateObj.locked = patch.locked;
  if (patch.zIndex !== undefined) updateObj.z_index = patch.zIndex;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("floor_plan_decorations")
    .update(updateObj)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) handleError(error, "updateDecoration");
}

export async function deleteDecoration(id: string): Promise<void> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("floor_plan_decorations")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) handleError(error, "deleteDecoration");
}

// ─── Storage: ảnh nền ───

export async function uploadFloorPlanBackground(
  branchId: string,
  zoneId: string,
  file: File,
): Promise<string> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `${ctx.tenantId}/${branchId}/${zoneId}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("floor-plans")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadErr) handleError(uploadErr, "uploadFloorPlanBackground");

  // Public URL
  const { data } = supabase.storage.from("floor-plans").getPublicUrl(path);
  return data.publicUrl;
}

export async function removeFloorPlanBackground(
  branchId: string,
  zoneId: string,
): Promise<void> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // Thử xoá các extension phổ biến
  const exts = ["jpg", "jpeg", "png", "webp"];
  for (const ext of exts) {
    const path = `${ctx.tenantId}/${branchId}/${zoneId}.${ext}`;
    try {
      await supabase.storage.from("floor-plans").remove([path]);
    } catch {
      /* ignore */
    }
  }
}

// ─── Mappers ───

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDecoration(row: any): FloorPlanDecoration {
  return {
    id: row.id,
    zoneId: row.zone_id,
    kind: row.kind,
    label: row.label,
    positionX: row.position_x ?? 0,
    positionY: row.position_y ?? 0,
    width: row.width ?? 60,
    height: row.height ?? 60,
    rotation: row.rotation ?? 0,
    color: row.color,
    icon: row.icon,
    locked: row.locked ?? false,
    zIndex: row.z_index ?? 0,
  };
}
