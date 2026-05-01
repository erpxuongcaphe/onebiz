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
