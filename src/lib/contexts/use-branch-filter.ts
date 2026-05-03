"use client";

import { useAuth } from "./auth-context";

/**
 * Convenience hook for pages that need branch filtering.
 *
 * Returns `activeBranchId` (string | undefined) to pass to service functions:
 *   - `undefined` → no branch filter (CEO "Tất cả chi nhánh" view)
 *   - `string`    → filter to that branch
 *
 * `isReady` — PERF F12: phân biệt "AuthContext còn loading" vs "user thực sự
 * chọn All branches". Pages dùng cờ này guard fetch để tránh double-fire:
 *
 * ```tsx
 * const { activeBranchId, isReady } = useBranchFilter();
 * useEffect(() => {
 *   if (!isReady) return; // wait for AuthContext
 *   fetchData(activeBranchId);
 * }, [activeBranchId, isReady]);
 * ```
 *
 * Trước đây pattern `[fetchData]` với fetchData phụ thuộc activeBranchId →
 * mount fire với undefined → AuthContext set branches → activeBranchId đổi →
 * re-fire. Mỗi service chạy 2 lần ⇒ 14 invoices/dashboard mount.
 */
export function useBranchFilter() {
  const { activeBranchId, currentBranch, branches, switchBranch, tenant } = useAuth();

  return {
    activeBranchId,
    currentBranch,
    branches,
    switchBranch,
    /** AuthContext đã load xong (tenant set). Guard cho data fetch effects. */
    isReady: !!tenant,
  };
}
