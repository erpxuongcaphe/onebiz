/**
 * F&B Delivery Fee Tiers Service (CEO 21/05/2026 — migration 00108)
 *
 * Cấu hình phí giao hàng theo cấp ngưỡng km (near/mid/far). Mỗi tenant có
 * 3 tier mặc định, có thể override per-branch nếu các quán khác nhau dùng
 * mức phí khác nhau (vd quán trung tâm bán kính ngắn → tier 'near' rẻ hơn).
 *
 * Quy tắc lookup:
 *   1. Tìm row branch-specific (branch_id = X) → ưu tiên cao
 *   2. Nếu không có → tìm row tenant-level (branch_id IS NULL) → fallback
 *   3. Nếu cả hai đều thiếu → fee = 0 (cashier phải nhập tay custom)
 */

import { getClient, handleError, getCurrentTenantId } from "./base";

export type DeliveryTierCode = "near" | "mid" | "far";

export interface DeliveryFeeTier {
  id: string;
  tenantId: string;
  /** null = áp dụng cho toàn tenant; có giá trị = override cho branch cụ thể */
  branchId: string | null;
  tierCode: DeliveryTierCode;
  tierLabel: string;
  fee: number;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Mapper DB row → DeliveryFeeTier
 */
function mapTier(row: Record<string, unknown>): DeliveryFeeTier {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    branchId: (row.branch_id as string | null) ?? null,
    tierCode: row.tier_code as DeliveryTierCode,
    tierLabel: row.tier_label as string,
    fee: Number(row.fee ?? 0),
    displayOrder: Number(row.display_order ?? 0),
    isActive: row.is_active !== false,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Lấy danh sách tier áp dụng cho branch (ưu tiên branch-specific, fallback tenant).
 *
 * Output: 3 row (near, mid, far) theo `display_order`. Nếu branch có override
 * tier_code nào → dùng override; còn lại lấy từ tenant-level.
 */
export async function getDeliveryFeeTiersForBranch(
  branchId: string | null,
): Promise<DeliveryFeeTier[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("fnb_delivery_fee_tiers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("display_order");
  if (error) handleError(error, "getDeliveryFeeTiersForBranch");

  const all = (data ?? []).map((r) => mapTier(r as Record<string, unknown>));
  // Merge: branch-specific wins over tenant-level (branch_id IS NULL)
  const byCode = new Map<DeliveryTierCode, DeliveryFeeTier>();
  // First pass: tenant-level
  all
    .filter((t) => t.branchId === null)
    .forEach((t) => byCode.set(t.tierCode, t));
  // Second pass: branch-specific overrides (if branchId provided)
  if (branchId) {
    all
      .filter((t) => t.branchId === branchId)
      .forEach((t) => byCode.set(t.tierCode, t));
  }
  return Array.from(byCode.values()).sort(
    (a, b) => a.displayOrder - b.displayOrder,
  );
}

/**
 * Lấy toàn bộ tier (cả tenant + tất cả branch) — dùng cho trang cài đặt.
 */
export async function getAllDeliveryFeeTiers(): Promise<DeliveryFeeTier[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("fnb_delivery_fee_tiers")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("branch_id", { nullsFirst: true })
    .order("display_order");
  if (error) handleError(error, "getAllDeliveryFeeTiers");

  return (data ?? []).map((r) => mapTier(r as Record<string, unknown>));
}

/**
 * Update fee + label cho 1 tier (theo id).
 */
export async function updateDeliveryFeeTier(
  id: string,
  updates: { tierLabel?: string; fee?: number; isActive?: boolean },
): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const payload: Record<string, unknown> = {};
  if (updates.tierLabel !== undefined) payload.tier_label = updates.tierLabel;
  if (updates.fee !== undefined) payload.fee = updates.fee;
  if (updates.isActive !== undefined) payload.is_active = updates.isActive;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("fnb_delivery_fee_tiers").update as any)(payload)
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) handleError(error, "updateDeliveryFeeTier");
}

/**
 * Tạo override cho 1 branch (vd branch "Quán Nguyễn Du" muốn tier 'near' thu 20k thay vì 15k mặc định).
 */
export async function upsertBranchTierOverride(input: {
  branchId: string;
  tierCode: DeliveryTierCode;
  tierLabel: string;
  fee: number;
  displayOrder?: number;
}): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const orderMap: Record<DeliveryTierCode, number> = { near: 1, mid: 2, far: 3 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("fnb_delivery_fee_tiers").upsert as any)(
    {
      tenant_id: tenantId,
      branch_id: input.branchId,
      tier_code: input.tierCode,
      tier_label: input.tierLabel,
      fee: input.fee,
      display_order: input.displayOrder ?? orderMap[input.tierCode],
      is_active: true,
    },
    { onConflict: "tenant_id,branch_id,tier_code" },
  );
  if (error) handleError(error, "upsertBranchTierOverride");
}

/**
 * Xóa override branch (rollback về tier mặc định tenant).
 */
export async function deleteBranchTierOverride(
  branchId: string,
  tierCode: DeliveryTierCode,
): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { error } = await supabase
    .from("fnb_delivery_fee_tiers")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("tier_code", tierCode);
  if (error) handleError(error, "deleteBranchTierOverride");
}
