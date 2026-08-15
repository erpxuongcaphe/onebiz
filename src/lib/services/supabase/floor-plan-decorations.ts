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

/**
 * F1a 15/08: ghi qua RPC 00323 `fnb_floor_decoration_config_atomic` — tenant,
 * quyền floor_plan.edit_* và chi nhánh chốt phía máy chủ (chi nhánh suy từ
 * zone, tham số branchId giữ cho tương thích nhưng không còn được tin).
 */
async function goiCauHinhTrangTri(
  action: string,
  payload: Record<string, unknown>,
  context: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const { data, error } = await supabase.rpc("fnb_floor_decoration_config_atomic", {
    p_action: action,
    p_payload: payload,
  });
  if (error) handleError(error, context);
  return data;
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
  const payload: Record<string, unknown> = {
    zone_id: input.zoneId,
    kind: input.kind,
    position_x: Math.round(input.positionX),
    position_y: Math.round(input.positionY),
  };
  if (input.label !== undefined) payload.label = input.label;
  if (input.width !== undefined) payload.width = Math.round(input.width);
  if (input.height !== undefined) payload.height = Math.round(input.height);
  if (input.color !== undefined) payload.color = input.color;
  if (input.icon !== undefined) payload.icon = input.icon;
  const data = await goiCauHinhTrangTri("create", payload, "createDecoration");
  return mapDecoration(data?.decoration ?? {});
}

export async function updateDecoration(
  id: string,
  patch: Partial<Omit<FloorPlanDecoration, "id" | "zoneId">>,
): Promise<void> {
  const payload: Record<string, unknown> = { decoration_id: id };
  if (patch.kind !== undefined) payload.kind = patch.kind;
  if (patch.label !== undefined) payload.label = patch.label ?? "";
  if (patch.positionX !== undefined) payload.position_x = Math.round(patch.positionX);
  if (patch.positionY !== undefined) payload.position_y = Math.round(patch.positionY);
  if (patch.width !== undefined) payload.width = Math.round(patch.width);
  if (patch.height !== undefined) payload.height = Math.round(patch.height);
  if (patch.rotation !== undefined) payload.rotation = Math.round(patch.rotation);
  if (patch.color !== undefined) payload.color = patch.color ?? "";
  if (patch.icon !== undefined) payload.icon = patch.icon ?? "";
  if (patch.locked !== undefined) payload.locked = patch.locked;
  if (patch.zIndex !== undefined) payload.z_index = patch.zIndex;
  await goiCauHinhTrangTri("update", payload, "updateDecoration");
}

/** Xoá CỨNG (giữ hành vi cũ) — nhưng máy chủ audit TRƯỚC khi xoá. */
export async function deleteDecoration(id: string): Promise<void> {
  await goiCauHinhTrangTri("delete", { decoration_id: id }, "deleteDecoration");
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
