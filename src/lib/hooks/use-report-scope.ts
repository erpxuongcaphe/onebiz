"use client";

import { useAuth } from "@/lib/contexts/auth-context";
import { useOptionalReportScope } from "@/lib/contexts/report-scope-context";
import { PERMISSIONS } from "@/lib/permissions/constants";

type ReportScopeOptions = { synchronizeUrl?: boolean };
const noReportSelection = () => {};

/** URL ownership belongs to the provider; all report selectors share its state. */
export function useReportScope(options: ReportScopeOptions = {}) {
  void options;
  const scope = useOptionalReportScope();
  const auth = useAuth();
  if (scope) return scope;
  // Dashboard callers outside reports retain Auth readiness, without interpreting
  // report deep links or allowing a report selector to switch the operational site.
  const branchName = auth.currentBranch?.name ?? "Toàn công ty";
  return {
    activeBranchId: auth.activeBranchId, currentBranch: auth.currentBranch, branches: auth.branches,
    branchName, branchLabel: auth.activeBranchId ? branchName : "Tất cả chi nhánh",
    canViewAll: auth.hasPermission(PERMISSIONS.REPORTS_VIEW_ALL_BRANCHES),
    isReady: !!auth.tenant && !auth.isLoading && auth.branches.length > 0,
    selectBranch: noReportSelection, scopeKey: "outside-reports",
  };
}
