// Branches service — CRUD with code convention (CNH/BOF/XRA)
//
// Multi-tenant safety: filter tenant_id mọi query đọc.

import { getClient } from "./base";
import { getCurrentTenantId } from "./base";

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
  // Day 20/05/2026 (CEO): thông tin pháp nhân (Migration 00107)
  legalEntityType?: "company" | "household" | "sole_proprietorship" | "individual";
  legalEntityName?: string;
  legalTaxCode?: string;
  legalRegistrationNo?: string;
  /**
   * CEO 03/06/2026 — Sprint 3 (Migration 00123): chế độ tồn kho.
   * - 'production' = Kho/Xưởng. Bán/xuất SKU has_bom=true → cascade BOM trừ NVL gốc.
   * - 'outlet'     = Quán/Cửa hàng. Bán SKU has_bom=true mà BOM chỉ global →
   *                  trừ tồn SKU trực tiếp (an toàn, không đụng NVL không tồn ở Quán).
   * Default 'outlet'. Auto-set 'production' cho warehouse/factory khi migrate.
   */
  cascadeMode: "production" | "outlet";
  /**
   * CEO 05/06/2026 — Migration 00127: giờ chốt ca (0-23).
   * Ca mở quá cutoff hour của hôm nay → auto pending_reconcile.
   * Default 3h sáng (đủ cho quán cà phê đóng cửa muộn 1-2h).
   */
  shiftCutoffHour: number;
  createdAt: string;
  updatedAt: string;
}

export async function getBranches(options?: {
  includeInactive?: boolean;
}): Promise<BranchDetail[]> {
  const tenantId = await getCurrentTenantId();
  let query = supabase
    .from("branches")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("is_default", { ascending: false })
    .order("name");

  if (!options?.includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
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
  /**
   * CEO 13/05: Bảng giá mặc định cho POS FnB / Retail của chi nhánh này.
   * null/undefined = dùng giá niêm yết (không áp tier).
   */
  priceTierId?: string | null;
  // Day 20/05/2026 (CEO): thông tin pháp nhân optional
  legalEntityType?: "company" | "household" | "sole_proprietorship" | "individual" | null;
  legalEntityName?: string | null;
  legalTaxCode?: string | null;
  legalRegistrationNo?: string | null;
  /**
   * CEO 03/06/2026 — Sprint 3: chế độ tồn kho.
   * - 'production' cho Kho/Xưởng (cascade BOM trừ NVL khi bán/xuất SKU).
   * - 'outlet' cho Quán (trừ tồn SKU trực tiếp).
   * Nếu không truyền: backend mặc định 'outlet'. UI có thể auto-suggest dựa
   * vào branchType (warehouse/factory → production).
   */
  cascadeMode?: "production" | "outlet";
  /** CEO 05/06/2026: giờ chốt ca 0-23, default 3 */
  shiftCutoffHour?: number;
}): Promise<BranchDetail> {
  const tenantId = await getCurrentTenantId();
  if (branch.tenantId && branch.tenantId !== tenantId) {
    throw new Error("Tenant chi nhánh không khớp phiên đăng nhập.");
  }
  const { data, error } = await (supabase.rpc as any)("save_branch_atomic", {
    p_branch_id: null,
    p_payload: {
      name: branch.name,
      code: branch.code ?? null,
      branch_type: branch.branchType ?? "store",
      address: branch.address ?? null,
      phone: branch.phone ?? null,
      is_default: branch.isDefault ?? false,
      price_tier_id: branch.priceTierId ?? null,
      legal_entity_type: branch.legalEntityType ?? null,
      legal_entity_name: branch.legalEntityName ?? null,
      legal_tax_code: branch.legalTaxCode ?? null,
      legal_registration_no: branch.legalRegistrationNo ?? null,
      cascade_mode:
        branch.cascadeMode ??
        ((branch.branchType ?? "store") === "warehouse" ||
        (branch.branchType ?? "store") === "factory"
          ? "production"
          : "outlet"),
      shift_cutoff_hour:
        typeof branch.shiftCutoffHour === "number"
          ? Math.max(0, Math.min(23, Math.round(branch.shiftCutoffHour)))
          : 3,
    },
  });
  if (error) throw error;
  if (!data) throw new Error("Máy chủ không trả về chi nhánh đã tạo.");
  return mapBranch(data as Record<string, unknown>);
}

/**
 * Set chi nhánh làm mặc định. Đồng bộ clear default cũ (chỉ 1 default/tenant).
 */
export async function setBranchDefault(
  branchId: string,
  tenantId: string,
): Promise<void> {
  const currentTenantId = await getCurrentTenantId();
  if (tenantId && tenantId !== currentTenantId) {
    throw new Error("Tenant chi nhánh không khớp phiên đăng nhập.");
  }
  const { error } = await (supabase.rpc as any)("save_branch_atomic", {
    p_branch_id: branchId,
    p_payload: { is_default: true },
  });
  if (error) throw error;
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
    isDefault: boolean;
    /** null để clear tier (về giá niêm yết) */
    priceTierId: string | null;
    // Day 20/05/2026 (CEO): pháp nhân
    legalEntityType: "company" | "household" | "sole_proprietorship" | "individual" | null;
    legalEntityName: string | null;
    legalTaxCode: string | null;
    legalRegistrationNo: string | null;
    // CEO 03/06/2026 — Sprint 3: cascade mode
    cascadeMode: "production" | "outlet";
    // CEO 05/06/2026: giờ chốt ca
    shiftCutoffHour: number;
  }>
) {
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.code !== undefined) payload.code = updates.code;
  if (updates.branchType !== undefined) payload.branch_type = updates.branchType;
  if (updates.address !== undefined) payload.address = updates.address;
  if (updates.phone !== undefined) payload.phone = updates.phone;
  if (updates.isActive !== undefined) payload.is_active = updates.isActive;
  if (updates.isDefault) payload.is_default = true;
  if (updates.priceTierId !== undefined) payload.price_tier_id = updates.priceTierId;
  if (updates.legalEntityType !== undefined) payload.legal_entity_type = updates.legalEntityType;
  if (updates.legalEntityName !== undefined) payload.legal_entity_name = updates.legalEntityName;
  if (updates.legalTaxCode !== undefined) payload.legal_tax_code = updates.legalTaxCode;
  if (updates.legalRegistrationNo !== undefined) payload.legal_registration_no = updates.legalRegistrationNo;
  if (updates.cascadeMode !== undefined) payload.cascade_mode = updates.cascadeMode;
  if (updates.shiftCutoffHour !== undefined) {
    payload.shift_cutoff_hour = Math.max(0, Math.min(23, Math.round(updates.shiftCutoffHour)));
  }

  const { error } = await (supabase.rpc as any)("save_branch_atomic", {
    p_branch_id: id,
    p_payload: payload,
  });
  if (error) throw error;
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
  const payload: Record<string, unknown> = {};
  if (patch.posZoneOrder !== undefined) payload.pos_zone_order = patch.posZoneOrder;
  if (patch.posLayoutMode !== undefined) payload.pos_layout_mode = patch.posLayoutMode;
  if (patch.posCanvasWidth !== undefined) payload.pos_canvas_width = patch.posCanvasWidth;
  if (patch.posCanvasHeight !== undefined) payload.pos_canvas_height = patch.posCanvasHeight;
  if (patch.posCartPosition !== undefined) payload.pos_cart_position = patch.posCartPosition;

  const { error } = await (supabase.rpc as any)("update_branch_settings_atomic", {
    p_branch_id: branchId,
    p_patch: payload,
  });
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
    // Day 20/05/2026 (CEO): pháp nhân
    legalEntityType:
      (row.legal_entity_type as BranchDetail["legalEntityType"]) ?? undefined,
    legalEntityName: (row.legal_entity_name as string) ?? undefined,
    legalTaxCode: (row.legal_tax_code as string) ?? undefined,
    legalRegistrationNo: (row.legal_registration_no as string) ?? undefined,
    // CEO 03/06/2026 — Sprint 3: cascade mode (default outlet nếu null)
    cascadeMode:
      ((row.cascade_mode as string) === "production"
        ? "production"
        : "outlet") as BranchDetail["cascadeMode"],
    shiftCutoffHour: Number(row.shift_cutoff_hour ?? 3),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// Branch type labels (Vietnamese)
// CEO 13/05: phân định rõ FnB vs Retail. Cửa hàng = mảng FnB. Kho tổng = mảng Retail.
export const BRANCH_TYPE_LABELS: Record<BranchDetail["branchType"], string> = {
  store: "Cửa hàng FnB",
  warehouse: "Kho tổng",
  factory: "Xưởng sản xuất",
  office: "Văn phòng",
};

// Mô tả ngắn cho từng loại — hiển thị dưới dropdown để user hiểu rõ.
export const BRANCH_TYPE_DESCRIPTIONS: Record<BranchDetail["branchType"], string> = {
  store: "Quán bán đồ uống — POS FnB + KDS bếp/bar",
  warehouse: "Bán sỉ hạt rang + máy móc — POS Retail",
  factory: "Rang hạt cà phê — không POS bán hàng",
  office: "Văn phòng HQ — ghi nhận chi phí điều hành (lương, VPP, điện nước)",
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
