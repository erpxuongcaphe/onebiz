// Branches service — CRUD with code convention (CNH/BOF/XRA)
//
// Multi-tenant safety: filter tenant_id mọi query đọc.

import { getClient } from "./base";
import { getCurrentTenantId } from "./base";
import { recordAuditLog } from "./audit";

const supabase = getClient();

export interface BranchDetail {
  id: string;
  tenantId: string;
  name: string;
  code?: string;
  branchType: "store" | "warehouse" | "factory" | "office";
  address?: string;
  phone?: string;
  isDefault: boolean;
  isActive: boolean;
  /** Bảng giá mặc định cho POS FnB của chi nhánh này. NULL = giá niêm yết. */
  priceTierId?: string;
  createdAt: string;
  updatedAt: string;
}

export async function getBranches(): Promise<BranchDetail[]> {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("branches")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .order("name");

  if (error) throw error;
  return (data ?? []).map(mapBranch);
}

export async function createBranch(branch: {
  /** Tenant của user hiện tại — bắt buộc pass đúng, không để Supabase tự infer. */
  tenantId: string;
  name: string;
  code?: string;
  branchType?: "store" | "warehouse" | "factory" | "office";
  address?: string;
  phone?: string;
  isDefault?: boolean;
}): Promise<BranchDetail> {
  if (!branch.tenantId) {
    throw new Error("Thiếu tenantId khi tạo chi nhánh");
  }
  // Nếu đánh dấu default thì clear default cũ trước để không vi phạm
  // nguyên tắc "mỗi tenant 1 default".
  if (branch.isDefault) {
    await supabase
      .from("branches")
      .update({ is_default: false })
      .eq("tenant_id", branch.tenantId)
      .eq("is_default", true);
  }
  const { data, error } = await supabase
    .from("branches")
    .insert({
      tenant_id: branch.tenantId,
      name: branch.name,
      code: branch.code ?? null,
      branch_type: branch.branchType ?? "store",
      address: branch.address ?? null,
      phone: branch.phone ?? null,
      is_default: branch.isDefault ?? false,
    })
    .select()
    .single();

  if (error) throw error;

  await recordAuditLog({
    entityType: "branch",
    entityId: data.id,
    action: "create",
    newData: {
      name: data.name,
      code: data.code,
      branch_type: data.branch_type,
      is_default: data.is_default,
    },
  });

  return mapBranch(data);
}

/**
 * Set chi nhánh làm mặc định. Đồng bộ clear default cũ (chỉ 1 default/tenant).
 */
export async function setBranchDefault(
  branchId: string,
  tenantId: string,
): Promise<void> {
  // 1. Clear default cũ
  const { error: clearErr } = await supabase
    .from("branches")
    .update({ is_default: false })
    .eq("tenant_id", tenantId)
    .eq("is_default", true);
  if (clearErr) throw clearErr;

  // 2. Set default mới
  const { error: setErr } = await supabase
    .from("branches")
    .update({ is_default: true })
    .eq("id", branchId);
  if (setErr) throw setErr;
}

export async function updateBranch(
  id: string,
  updates: Partial<{
    name: string;
    code: string;
    branchType: string;
    address: string;
    phone: string;
    isActive: boolean;
    /** null để clear tier (về giá niêm yết) */
    priceTierId: string | null;
  }>
) {
  const tenantId = await getCurrentTenantId();

  // Snapshot trước update cho audit log
  const { data: prev } = await supabase
    .from("branches")
    .select("name, code, branch_type, address, phone, is_active, price_tier_id")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  const updateObj: Record<string, unknown> = {};
  if (updates.name !== undefined) updateObj.name = updates.name;
  if (updates.code !== undefined) updateObj.code = updates.code;
  if (updates.branchType !== undefined) updateObj.branch_type = updates.branchType;
  if (updates.address !== undefined) updateObj.address = updates.address;
  if (updates.phone !== undefined) updateObj.phone = updates.phone;
  if (updates.isActive !== undefined) updateObj.is_active = updates.isActive;
  if (updates.priceTierId !== undefined) updateObj.price_tier_id = updates.priceTierId;

  const { error } = await supabase
    .from("branches")
    .update(updateObj)
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) throw error;

  await recordAuditLog({
    entityType: "branch",
    entityId: id,
    // Detect deactivate vs general update để label đúng trong audit timeline
    action:
      updates.isActive === false
        ? "deactivate"
        : updates.isActive === true
          ? "activate"
          : "update",
    oldData: (prev as Record<string, unknown>) ?? null,
    newData: updateObj,
  });
}

// ============================================================
// Sprint E — CEO 06/05: Branch settings JSONB (mockup v3)
// ============================================================
// Lưu trữ per-branch layout preferences cho POS FnB:
//   - pos_zone_order: thứ tự sảnh hiển thị trên floor plan
//   - pos_layout_mode: "auto" (grid) | "manual" (positionX/Y absolute)
//   - pos_canvas_width / pos_canvas_height: kích thước canvas editor
//   - pos_cart_position: "right" | "bottom" (Sprint sau)
//
// Schema dùng JSONB để mở rộng không cần migration mỗi key mới. Service
// merge partial — chỉ update key được truyền vào, giữ key cũ.

export interface BranchSettings {
  /** Thứ tự sảnh hiển thị trên floor plan tab (admin sắp xếp). */
  posZoneOrder?: string[];
  /** Floor plan dùng position absolute (manual) hay auto-grid (auto). */
  posLayoutMode?: "auto" | "manual";
  /** Canvas width/height khi mode manual. Default 1024×720. */
  posCanvasWidth?: number;
  posCanvasHeight?: number;
  /** Cart position trên POS view (Sprint sau implement). */
  posCartPosition?: "right" | "bottom";
}

export async function getBranchSettings(
  branchId: string,
): Promise<BranchSettings> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Cast `any` vì DB types chưa regen sau migration 00052 — `settings` JSONB
  // chưa có trong Database types. Sau khi user chạy `supabase gen types`
  // có thể bỏ cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("branches")
    .select("settings")
    .eq("tenant_id", tenantId)
    .eq("id", branchId)
    .maybeSingle();

  if (error || !data) return {};
  const raw = (data.settings ?? {}) as Record<string, unknown>;

  return {
    posZoneOrder: Array.isArray(raw.pos_zone_order)
      ? (raw.pos_zone_order as string[])
      : undefined,
    posLayoutMode:
      raw.pos_layout_mode === "auto" || raw.pos_layout_mode === "manual"
        ? raw.pos_layout_mode
        : undefined,
    posCanvasWidth:
      typeof raw.pos_canvas_width === "number"
        ? raw.pos_canvas_width
        : undefined,
    posCanvasHeight:
      typeof raw.pos_canvas_height === "number"
        ? raw.pos_canvas_height
        : undefined,
    posCartPosition:
      raw.pos_cart_position === "right" || raw.pos_cart_position === "bottom"
        ? raw.pos_cart_position
        : undefined,
  };
}

/**
 * Merge partial settings vào branches.settings JSONB.
 * Key truyền vào sẽ update, key không truyền giữ nguyên.
 */
export async function updateBranchSettings(
  branchId: string,
  patch: BranchSettings,
): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Read current settings để merge — tránh ghi đè key cũ
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabase as any)
    .from("branches")
    .select("settings")
    .eq("tenant_id", tenantId)
    .eq("id", branchId)
    .maybeSingle();

  const current = ((row?.settings as Record<string, unknown>) ?? {}) as Record<
    string,
    unknown
  >;

  // Map camelCase → snake_case cho DB
  const next: Record<string, unknown> = { ...current };
  if (patch.posZoneOrder !== undefined) next.pos_zone_order = patch.posZoneOrder;
  if (patch.posLayoutMode !== undefined) next.pos_layout_mode = patch.posLayoutMode;
  if (patch.posCanvasWidth !== undefined) next.pos_canvas_width = patch.posCanvasWidth;
  if (patch.posCanvasHeight !== undefined) next.pos_canvas_height = patch.posCanvasHeight;
  if (patch.posCartPosition !== undefined) next.pos_cart_position = patch.posCartPosition;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("branches")
    .update({ settings: next })
    .eq("tenant_id", tenantId)
    .eq("id", branchId);

  if (error) throw error;
}

function mapBranch(row: Record<string, unknown>): BranchDetail {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    name: row.name as string,
    code: (row.code as string) ?? undefined,
    branchType: (row.branch_type as BranchDetail["branchType"]) ?? "store",
    address: (row.address as string) ?? undefined,
    phone: (row.phone as string) ?? undefined,
    isDefault: (row.is_default as boolean) ?? false,
    isActive: (row.is_active as boolean) ?? true,
    priceTierId: (row.price_tier_id as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// Branch type labels (Vietnamese)
export const BRANCH_TYPE_LABELS: Record<BranchDetail["branchType"], string> = {
  store: "Cửa hàng",
  warehouse: "Kho",
  factory: "Xưởng sản xuất",
  office: "Văn phòng",
};

// Branch code prefix based on type
export const BRANCH_CODE_PREFIX: Record<BranchDetail["branchType"], string> = {
  store: "CNH",
  warehouse: "BOF",
  factory: "XRA",
  office: "BOF",
};

/**
 * Gọi RPC seed_internal_entities để tạo customer/supplier nội bộ cho mỗi branch.
 * Idempotent — gọi nhiều lần không lỗi.
 */
export async function syncInternalEntities(tenantId: string): Promise<void> {
  const { error } = await supabase.rpc("seed_internal_entities", {
    p_tenant_id: tenantId,
  });
  if (error) throw error;
}
