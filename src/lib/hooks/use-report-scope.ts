"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/lib/contexts";
import { PERMISSIONS } from "@/lib/permissions/constants";

const BRANCH_PARAM = "branch";

export function useReportScope() {
  const {
    activeBranchId,
    branches,
    currentBranch,
    hasPermission,
    switchBranch,
    tenant,
    user,
  } = useAuth();
  const initializedRef = useRef(false);

  const canViewAll =
    hasPermission(PERMISSIONS.REPORTS_VIEW_ALL_BRANCHES) ||
    hasPermission(PERMISSIONS.SYSTEM_MANAGE_BRANCHES);
  const isReady = !!tenant;

  const fallbackBranchId = useMemo(
    () =>
      branches.find((branch) => branch.id === user?.branchId)?.id ??
      branches.find((branch) => branch.isDefault)?.id ??
      branches[0]?.id,
    [branches, user?.branchId],
  );

  useEffect(() => {
    if (!isReady || initializedRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const requestedBranch = params.get(BRANCH_PARAM);
    const requestedIsAccessible = branches.some(
      (branch) => branch.id === requestedBranch,
    );

    let nextBranchId: string | null | undefined;
    if (requestedBranch === "all" && canViewAll) {
      nextBranchId = null;
    } else if (requestedBranch && requestedIsAccessible) {
      nextBranchId = requestedBranch;
    } else if (!canViewAll && !activeBranchId) {
      nextBranchId = fallbackBranchId;
    }

    if (nextBranchId !== undefined && nextBranchId !== (activeBranchId ?? null)) {
      switchBranch(nextBranchId);
    }
    initializedRef.current = true;
  }, [
    activeBranchId,
    branches,
    canViewAll,
    fallbackBranchId,
    isReady,
    switchBranch,
  ]);

  useEffect(() => {
    if (!isReady || !initializedRef.current) return;
    if (!canViewAll && !activeBranchId) return;

    const url = new URL(window.location.href);
    const nextValue = activeBranchId ?? "all";
    if (url.searchParams.get(BRANCH_PARAM) === nextValue) return;

    url.searchParams.set(BRANCH_PARAM, nextValue);
    window.history.replaceState(window.history.state, "", url);
  }, [activeBranchId, canViewAll, isReady]);

  const selectBranch = useCallback(
    (branchId: string | null) => {
      if (branchId === null) {
        if (canViewAll) switchBranch(null);
        return;
      }
      if (branches.some((branch) => branch.id === branchId)) {
        switchBranch(branchId);
      }
    },
    [branches, canViewAll, switchBranch],
  );

  return {
    activeBranchId,
    branches,
    branchName: currentBranch?.name ?? "Toàn công ty",
    canViewAll,
    isReady,
    selectBranch,
  };
}
