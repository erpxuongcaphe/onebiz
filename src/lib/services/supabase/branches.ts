// Branches service — CRUD with code convention (CNH/BOF/XRA)

import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

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
  createdAt: string;
  updatedAt: string;
}

export async function getBranches(): Promise<BranchDetail[]> {
  const { data, error } = await supabase
    .from("branches")
    .select("*")
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .order("name");

  if (error) throw error;
  return (data ?? []).map(mapBranch);
}

export async function createBranch(branch: {
  name: string;
  code?: string;
  branchType?: "store" | "warehouse" | "factory" | "office";
  address?: string;
  phone?: string;
}): Promise<BranchDetail> {
  const { data, error } = await supabase
    .from("branches")
    .insert({
      tenant_id: "",
      name: branch.name,
      code: branch.code ?? null,
      branch_type: branch.branchType ?? "store",
      address: branch.address ?? null,
      phone: branch.phone ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return mapBranch(data);
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
  }>
) {
  const updateObj: Record<string, unknown> = {};
  if (updates.name !== undefined) updateObj.name = updates.name;
  if (updates.code !== undefined) updateObj.code = updates.code;
  if (updates.branchType !== undefined) updateObj.branch_type = updates.branchType;
  if (updates.address !== undefined) updateObj.address = updates.address;
  if (updates.phone !== undefined) updateObj.phone = updates.phone;
  if (updates.isActive !== undefined) updateObj.is_active = updates.isActive;

  const { error } = await supabase
    .from("branches")
    .update(updateObj)
    .eq("id", id);

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
