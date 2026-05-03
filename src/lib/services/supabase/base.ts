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
// PERF F8: Profile cache shared cho cả `getCurrentTenantId` và
// `getCurrentContext`. Trước đây mỗi function tự cache riêng → cùng page
// mount fire 2-3 fetch profile (1 cho tenant, 1 cho context, 1 cho
// AuthContext). Giờ cả 2 đều derive từ cùng `cachedProfile`.
//
// Quy ước: cachedProfile = null → chưa load. Sau load thành công, các
// public function trả về synchronous từ cache (cho đến signOut clear).
interface CachedProfile {
  tenantId: string;
  branchId: string | null;
  userId: string;
}
let cachedProfile: CachedProfile | null = null;
// In-flight promise dedup. Khi N services cùng gọi loadProfile() lần đầu
// (cache trống), TẤT CẢ chia sẻ 1 promise duy nhất thay vì mỗi cái call
// supabase.auth.getUser() + profile query riêng. Tránh lock contention
// "@supabase/gotrue-js Lock auth-token was not released within 5000ms".
let inflightProfilePromise: Promise<CachedProfile> | null = null;

async function loadProfile(): Promise<CachedProfile> {
  if (cachedProfile) return cachedProfile;
  if (inflightProfilePromise) return inflightProfilePromise;

  inflightProfilePromise = (async () => {
    try {
      const supabase = getClient();
      // getSession() đọc cookie/localStorage instant (0 RTT) thay vì
      // getUser() HTTP roundtrip. Trade-off: session expired → query sau
      // sẽ fail → user redirect login (acceptable).
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;

      if (user) {
        const { data, error } = await supabase
          .from("profiles")
          .select("tenant_id, branch_id")
          .eq("id", user.id)
          .single();
        if (error || !data?.tenant_id) {
          throw new Error("Không tìm thấy tenant");
        }
        const profile: CachedProfile = {
          tenantId: data.tenant_id,
          branchId: data.branch_id ?? null,
          userId: user.id,
        };
        cachedProfile = profile;
        return profile;
      }

      // DEV bypass
      if (process.env.NEXT_PUBLIC_BYPASS_AUTH === "true") {
        const { data: firstTenant } = await supabase
          .from("tenants")
          .select("id")
          .limit(1)
          .single();
        if (firstTenant?.id) {
          const profile: CachedProfile = {
            tenantId: firstTenant.id,
            branchId: null,
            userId: "dev-bypass",
          };
          cachedProfile = profile;
          return profile;
        }
      }

      throw new Error("Chưa đăng nhập");
    } finally {
      inflightProfilePromise = null;
    }
  })();

  return inflightProfilePromise;
}

export async function getCurrentTenantId(): Promise<string> {
  return (await loadProfile()).tenantId;
}

/**
 * Reset cache khi user signOut hoặc switch account — gọi trong AuthContext
 * onAuthStateChange (event=SIGNED_OUT). Không sử dụng public từ service.
 */
export function _clearProfileCache(): void {
  cachedProfile = null;
  cachedContext = null;
  inflightProfilePromise = null;
  inflightContextPromise = null;
}

/**
 * PERF F11: Cho AuthContext seed cache profile sau khi nó tự fetch.
 * Tránh service layer refetch profile lần 2 ngay sau page mount.
 * Internal — chỉ AuthContext nên import.
 */
export function _seedProfileCache(profile: {
  tenantId: string;
  branchId: string | null;
  userId: string;
}): void {
  cachedProfile = profile;
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
let inflightContextPromise: Promise<CurrentContext> | null = null;

export async function getCurrentContext(): Promise<CurrentContext> {
  if (cachedContext) return cachedContext;
  if (inflightContextPromise) return inflightContextPromise;

  inflightContextPromise = (async () => {
    try {
      return await loadContext();
    } finally {
      inflightContextPromise = null;
    }
  })();
  return inflightContextPromise;
}

async function loadContext(): Promise<CurrentContext> {
  // PERF F8: Reuse cachedProfile thay vì fetch riêng lần nữa.
  // Trước: getCurrentContext fetch profile mới → duplicate với getCurrentTenantId.
  const profile = await loadProfile();
  const supabase = getClient();

  // --- Real authenticated path ---
  if (profile.userId !== "dev-bypass") {
    let branchId: string | null = profile.branchId;
    if (!branchId) {
      const { data: branch } = await supabase
        .from("branches")
        .select("id")
        .eq("tenant_id", profile.tenantId)
        .eq("is_default", true)
        .limit(1)
        .single();
      branchId = branch?.id ?? null;
    }
    if (!branchId) throw new Error("Không tìm thấy chi nhánh");

    cachedContext = {
      tenantId: profile.tenantId,
      branchId,
      userId: profile.userId,
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

// ============================================================
// TENANT SCOPING HELPERS (Layer 2 of multi-tenant safety)
// ============================================================
//
// Quy tắc bất di bất dịch của project: MỌI query đọc dữ liệu (SELECT) trên
// table có cột `tenant_id` BẮT BUỘC phải filter theo tenant hiện tại.
//
// Tại sao: trong giai đoạn dev BYPASS_AUTH=true, RLS bị tắt (migration
// 00010_dev_disable_rls). Nếu service không tự filter thì query trả về
// data của TẤT CẢ tenants → user thấy data của tenant khác. CEO test demo
// nhiều lần → DB có 4-5 tenant → search "Đắk" hiện 4 row trùng từ 4 tenant.
//
// Khi production bật RLS lại (migration sẽ chuẩn bị sẵn), policy sẽ là
// defense-in-depth — nhưng KHÔNG được tin RLS một mình; vẫn filter ở FE
// để tránh lỗi nếu RLS policy có sót.
//
// Dùng helper `tenantScopedFrom(table)` thay vì `supabase.from(table)` —
// helper trả về query builder ĐÃ có `.eq("tenant_id", ...)` áp sẵn,
// không thể quên.
//
// Tables KHÔNG có tenant_id (VD: `tenants`, `pipelines` global) → vẫn dùng
// `getClient().from(...)` trực tiếp.
// ============================================================

/**
 * Helper inline áp tenant filter vào bất kỳ query Supabase đang chain.
 *
 * Pattern chuẩn cho service mới — KHÔNG được dùng `supabase.from()` trực
 * tiếp cho table có cột `tenant_id`:
 *
 *   // Cách CŨ (KHÔNG dùng nữa)
 *   const { data } = await supabase.from("products").select("*")
 *
 *   // Cách MỚI — luôn áp filter qua applyTenantFilter:
 *   const { data } = await applyTenantFilter(
 *     supabase.from("products").select("*", { count: "exact" })
 *   );
 *
 * Hoặc cho query phức tạp với chain dài:
 *   let q = supabase.from("products").select("*").eq("is_active", true);
 *   q = await applyTenantFilter(q);
 *   q = q.order("created_at", { ascending: false }).range(0, 19);
 *   const { data, error } = await q;
 *
 * Helper return về cùng type Q để chain tiếp `.order()`, `.range()`, v.v.
 *
 * BẮT BUỘC dùng cho mọi query SELECT trên các table có tenant_id:
 *   products, categories, suppliers, customers, branches, invoices,
 *   purchase_orders, stock_movements, branch_stock, transfers, ...
 *
 * KHÔNG cần (table không có tenant_id):
 *   tenants, pipelines (global), pipeline_stages, ...
 */
export async function applyTenantFilter<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Q extends { eq: (col: string, val: string) => any },
>(query: Q): Promise<Q> {
  const tenantId = await getCurrentTenantId();
  return query.eq("tenant_id", tenantId);
}

/**
 * Reset cache tenant_id — gọi khi user đăng xuất / đổi tenant.
 * Tránh cache stale của user khác trong dev mode.
 */
export function clearTenantCache() {
  _clearProfileCache();
}

/**
 * Preview mã group code TIẾP THEO mà KHÔNG tăng counter.
 *
 * Dùng cho UI tạo SP hiển thị mã thật (`NVL-CPH-014`) ngay khi user chọn
 * nhóm — không phải placeholder `XXX`. next_group_code() chỉ gọi khi save.
 *
 * Có timeout 5s để không treo browser nếu RPC chưa migrate. Quan sát thực
 * tế: khi RPC không tồn tại, supabase-js timeout mặc định 60s gây UI freeze.
 * Race với Promise.race + AbortController không được supabase-js support
 * gọn — dùng Promise.race với timeout reject thay thế.
 *
 * Nếu peek thất bại (RPC chưa migrate / network / timeout) → fallback
 * `{prefix}-{group}-XXX` để UI vẫn render được, không block luồng.
 */
export async function peekNextGroupCode(
  prefix: string,
  groupCode: string,
): Promise<string> {
  const supabase = getClient();
  try {
    const tenantId = await getCurrentTenantId();
    const fallback = `${prefix}-${groupCode}-XXX`;

    const rpcPromise = supabase
      .rpc("peek_next_group_code", {
        p_tenant_id: tenantId,
        p_prefix: prefix,
        p_group_code: groupCode,
      })
      .then((res) => {
        if (res.error || !res.data) return fallback;
        return res.data as string;
      });

    // 5s timeout — đủ generous cho mạng chậm + cold start RPC, nhưng nhanh
    // gấp 12 lần default 60s nên user không thấy block trên dropdown.
    const timeoutPromise = new Promise<string>((resolve) =>
      setTimeout(() => {
        console.warn(
          `[peekNextGroupCode] timeout after 5s for ${prefix}-${groupCode} — fallback XXX`,
        );
        resolve(fallback);
      }, 5000),
    );

    return Promise.race([rpcPromise, timeoutPromise]);
  } catch (err) {
    console.warn("[peekNextGroupCode] failed:", err);
    return `${prefix}-${groupCode}-XXX`;
  }
}
