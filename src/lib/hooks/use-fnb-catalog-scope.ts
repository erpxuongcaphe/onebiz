"use client";

import { useAuth } from "@/lib/contexts/auth-context";
import { isFnbCatalogContext } from "@/lib/fnb-catalog-scope";

/** Use the branch selected in the UI, rather than the user's original branch. */
export function useFnbCatalogScope(branchId?: string) {
  const { activeBranchId, currentBranch, branches } = useAuth();
  const branch = branches.find(item => item.id === (branchId ?? activeBranchId)) ?? currentBranch;
  return isFnbCatalogContext(branch?.branchType, typeof window === "undefined" ? "" : window.location.hostname);
}
