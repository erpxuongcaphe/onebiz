import { useAuth } from "@/lib/contexts/auth-context";

/** The stock row can belong to a different branch than the header selector. */
export function useStockRowAdjustPermission(branchId: string | null) {
  const { hasAssignedBranchAccess, hasPermissionAtBranch } = useAuth();
  return hasAssignedBranchAccess(branchId)
    && hasPermissionAtBranch("inventory.adjust", branchId);
}
