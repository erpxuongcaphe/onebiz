"use client";

import { useAuth } from "@/lib/contexts";
import { PERMISSIONS } from "@/lib/permissions/constants";

/** Show the MKT entry if at least one assigned branch grants access. */
export function useMktAccess(): boolean {
  const { branches, hasPermission, hasPermissionAtBranch, hasAssignedBranchAccess } = useAuth();
  return hasPermission(PERMISSIONS.MKT_VIEW) || (branches ?? []).some((branch) =>
    hasAssignedBranchAccess(branch.id) && hasPermissionAtBranch(PERMISSIONS.MKT_VIEW, branch.id),
  );
}
