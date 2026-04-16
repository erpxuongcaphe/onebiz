"use client";

import { useAuth } from "./auth-context";

/**
 * Convenience hook for pages that need branch filtering.
 *
 * Returns `activeBranchId` (string | undefined) to pass to service functions:
 *   - `undefined` → no branch filter (CEO "Tất cả chi nhánh" view)
 *   - `string`    → filter to that branch
 *
 * Usage:
 *   const { activeBranchId } = useBranchFilter();
 *   const data = await getInvoices({ ...params, branchId: activeBranchId });
 */
export function useBranchFilter() {
  const { activeBranchId, currentBranch, branches, switchBranch } = useAuth();

  return {
    activeBranchId,
    currentBranch,
    branches,
    switchBranch,
  };
}
