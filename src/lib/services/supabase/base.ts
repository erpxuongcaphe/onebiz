/**
 * Supabase service base utilities.
 * Shared helpers for building queries from QueryParams.
 */

import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { QueryParams } from "@/lib/types";

// Singleton client for browser-side services
let client: SupabaseClient<Database> | null = null;

export function getClient(): SupabaseClient<Database> {
  if (!client) {
    client = createClient();
  }
  return client;
}

/**
 * Apply pagination to a Supabase query builder.
 * Returns the range [from, to] for `.range()`.
 */
export function getPaginationRange(params: QueryParams): { from: number; to: number } {
  const from = params.page * params.pageSize;
  const to = from + params.pageSize - 1;
  return { from, to };
}

/**
 * Map sort order string to Supabase ascending boolean.
 */
export function isAscending(params: QueryParams): boolean {
  return params.sortOrder === "asc";
}

/**
 * Handle Supabase query errors consistently.
 * Throws a descriptive error if the query failed.
 */
export function handleError(error: { message: string; code?: string }, context: string): never {
  throw new Error(`[${context}] ${error.message} (code: ${error.code ?? "unknown"})`);
}

/**
 * Extract a single filter value from QueryParams.filters.
 * Handles the string | string[] union by taking first element if array.
 */
export function getFilterValue(filters: Record<string, string | string[]> | undefined, key: string): string | undefined {
  if (!filters) return undefined;
  const val = filters[key];
  if (!val) return undefined;
  return Array.isArray(val) ? val[0] : val;
}

/**
 * Get the current authenticated user's tenant_id (cached per page load).
 *
 * DEV FALLBACK: when `NEXT_PUBLIC_BYPASS_AUTH=true` and there is no auth
 * session, we transparently return the first tenant row. Production builds
 * (BYPASS_AUTH unset) still require a real auth user.
 */
let cachedTenantId: string | null = null;
export async function getCurrentTenantId(): Promise<string> {
  if (cachedTenantId) return cachedTenantId;
  const supabase = getClient();
  const { data: userData } = await supabase.auth.getUser();

  if (userData.user) {
    const { data, error } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userData.user.id)
      .single();
    if (error || !data?.tenant_id) throw new Error("Không tìm thấy tenant");
    cachedTenantId = data.tenant_id;
    return cachedTenantId;
  }

  // DEV bypass
  if (process.env.NEXT_PUBLIC_BYPASS_AUTH === "true") {
    const { data: firstTenant } = await supabase
      .from("tenants")
      .select("id")
      .limit(1)
      .single();
    if (firstTenant?.id) {
      cachedTenantId = firstTenant.id;
      return cachedTenantId;
    }
  }

  throw new Error("Chưa đăng nhập");
}

/**
 * Get the current (tenantId, branchId, userId) context for write operations.
 *
 * In production this maps to the authenticated user's profile + default branch.
 * In DEV bypass mode it falls back to the first tenant + its default branch
 * and a synthetic userId so inserts still satisfy NOT NULL constraints.
 */
export interface CurrentContext {
  tenantId: string;
  branchId: string;
  userId: string;
}

let cachedContext: CurrentContext | null = null;
export async function getCurrentContext(): Promise<CurrentContext> {
  if (cachedContext) return cachedContext;
  const supabase = getClient();
  const { data: userData } = await supabase.auth.getUser();

  // --- Real authenticated path ---
  if (userData.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, branch_id")
      .eq("id", userData.user.id)
      .single();
    if (!profile?.tenant_id) throw new Error("Không tìm thấy tenant");

    let branchId = profile.branch_id;
    if (!branchId) {
      const { data: branch } = await supabase
        .from("branches")
        .select("id")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_default", true)
        .limit(1)
        .single();
      branchId = branch?.id ?? null;
    }
    if (!branchId) throw new Error("Không tìm thấy chi nhánh");

    cachedContext = {
      tenantId: profile.tenant_id,
      branchId,
      userId: userData.user.id,
    };
    return cachedContext;
  }

  // --- DEV bypass path ---
  if (process.env.NEXT_PUBLIC_BYPASS_AUTH !== "true") {
    throw new Error("Chưa đăng nhập");
  }

  const { data: firstTenant } = await supabase
    .from("tenants")
    .select("id")
    .limit(1)
    .single();
  if (!firstTenant?.id) throw new Error("DEV: Không có tenant nào trong DB");

  const { data: firstBranch } = await supabase
    .from("branches")
    .select("id")
    .eq("tenant_id", firstTenant.id)
    .order("is_default", { ascending: false })
    .limit(1)
    .single();
  if (!firstBranch?.id) throw new Error("DEV: Không có chi nhánh nào trong DB");

  // Try to grab a real profile id so FK to created_by succeeds
  const { data: firstProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("tenant_id", firstTenant.id)
    .limit(1)
    .single();

  cachedContext = {
    tenantId: firstTenant.id,
    branchId: firstBranch.id,
    // Fall back to tenant id if no profile exists — triggers FK error loudly
    // instead of silently inserting a random UUID.
    userId: firstProfile?.id ?? firstTenant.id,
  };
  return cachedContext;
}

/**
 * Sinh mã code tiếp theo cho prefix + group, ví dụ: NVL-BAO-022.
 * LƯU Ý: Mỗi lần gọi sẽ tăng counter — chỉ gọi tại thời điểm insert.
 */
export async function nextGroupCode(prefix: string, groupCode: string): Promise<string> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase.rpc("next_group_code", {
    p_tenant_id: tenantId,
    p_prefix: prefix,
    p_group_code: groupCode,
  });
  if (error) handleError(error, "nextGroupCode");
  return data as string;
}

/**
 * Preview mã group code TIẾP THEO mà KHÔNG tăng counter.
 *
 * Dùng cho UI tạo SP hiển thị mã thật (`NVL-CPH-014`) ngay khi user chọn
 * nhóm — không phải placeholder `XXX`. next_group_code() chỉ gọi khi save.
 *
 * Nếu peek thất bại (RPC chưa migrate / network) → fallback `{prefix}-{group}-XXX`
 * để UI vẫn render được, không block luồng.
 */
export async function peekNextGroupCode(
  prefix: string,
  groupCode: string,
): Promise<string> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase.rpc("peek_next_group_code", {
    p_tenant_id: tenantId,
    p_prefix: prefix,
    p_group_code: groupCode,
  });
  if (error || !data) {
    return `${prefix}-${groupCode}-XXX`;
  }
  return data as string;
}
