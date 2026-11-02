"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "./auth-context";
import type { Branch } from "@/lib/types/auth";
import { PERMISSIONS } from "@/lib/permissions/constants";

export interface ReportScopeValue {
  activeBranchId: string | undefined;
  currentBranch: Branch | null;
  branches: Branch[];
  branchName: string;
  branchLabel: string;
  canViewAll: boolean;
  isReady: boolean;
  selectBranch: (branchId: string | null) => void;
  scopeKey: string;
}

const ReportScopeContext = createContext<ReportScopeValue | null>(null);
export const useOptionalReportScope = () => useContext(ReportScopeContext);

const locationIdentity = () => JSON.stringify([window.location.pathname, new URLSearchParams(window.location.search).get("branch")]);

export function ReportScopeProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const permissions = auth.permissions ?? [];
  const branches = auth.branches.filter(branch => branch.tenantId === auth.tenant?.id);
  const canViewAll = !auth.isLoading && !auth.authDataError && !!auth.user && auth.user.isActive !== false && !!auth.tenant &&
    auth.hasPermission(PERMISSIONS.REPORTS_VIEW_ALL_BRANCHES);
  const boundary = JSON.stringify([
    auth.tenant?.id, auth.user?.id, auth.user?.branchId, auth.user?.isActive, auth.isLoading, auth.authDataError ?? null,
    [...permissions].sort(), branches.map(branch => branch.id).sort(), canViewAll,
  ]);
  return <ScopedReportState key={boundary} boundary={boundary} branches={branches}
    initialBranchId={auth.activeBranchId} profileBranchId={auth.user?.branchId}
    ready={!auth.isLoading && !auth.authDataError && !!auth.user && auth.user.isActive !== false && !!auth.tenant && branches.length > 0}
    canViewAll={canViewAll}>{children}</ScopedReportState>;
}

function ScopedReportState({ children, boundary, branches, initialBranchId, profileBranchId, ready, canViewAll }: {
  children: ReactNode; boundary: string; branches: Branch[];
  initialBranchId?: string; profileBranchId?: string | null; ready: boolean; canViewAll: boolean;
}) {
  const routerPath = usePathname();
  const routerLocation = JSON.stringify([routerPath, useSearchParams()?.get("branch") ?? null]);
  const [browserReady, setBrowserReady] = useState(false);
  const [committedLocation, setCommittedLocation] = useState<string | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [selection, setSelection] = useState<{ branch: string | null | undefined; revision: number }>({ branch: undefined, revision: 0 });
  // Next may render a destination before committing its browser URL. Its path
  // wins during handoff; on the same path, native selector writes win over lagging params.
  const browserLocation = typeof window === "undefined" ? null : locationIdentity();
  const browserPath = browserLocation ? (JSON.parse(browserLocation) as [string, string | null])[0] : null;
  const location = browserLocation && browserPath === routerPath ? browserLocation : routerLocation;
  useEffect(() => {
    let previous = location;
    const onPopState = () => {
      const next = locationIdentity();
      if (next === previous) return;
      previous = next;
      setHistoryRevision(revision => revision + 1);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [location]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Gate report children until browser URL initialization.
    setBrowserReady(true);
  }, []);
  const fallback = branches.find(branch => branch.id === initialBranchId)?.id ??
    branches.find(branch => branch.id === profileBranchId)?.id ??
    branches.find(branch => branch.isDefault)?.id ?? [...branches].sort((a, b) => a.id.localeCompare(b.id))[0]?.id;
  const [pathname, requested] = JSON.parse(location) as [string, string | null];
  const inReports = /^\/phan-tich(?:\/|$)/.test(pathname);
  const accessible = (branchId: string | null | undefined) => branchId === null ? canViewAll : branches.some(branch => branch.id === branchId);
  const previous = accessible(selection.branch) ? selection.branch : fallback;
  const inheritOperationalAll = requested === null && selection.branch === undefined &&
    initialBranchId === undefined && ready && canViewAll;
  const selected = requested === "all" && canViewAll ? null :
    requested && branches.some(branch => branch.id === requested) ? requested : inheritOperationalAll ? null : previous;
  const canonical = selected === null ? "all" : selected;
  const isReady = browserReady && ready && inReports && canonical !== undefined && requested === canonical &&
    committedLocation === location && browserLocation === location;

  useEffect(() => {
    if (!ready || !inReports || canonical === undefined || locationIdentity() !== location) return;
    const urlChanged = requested !== canonical;
    if (urlChanged) {
      const url = new URL(window.location.href);
      url.searchParams.set("branch", canonical);
      window.history.replaceState(window.history.state, "", url);
    }
    // A post-commit acknowledgement also retries readiness when the destination
    // already had the right branch and no selection update would otherwise occur.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Only acknowledge a browser location verified after commit.
    setCommittedLocation(locationIdentity());
    if (urlChanged || selection.branch !== selected) {
      setSelection(previous => ({ branch: selected, revision: previous.revision + (urlChanged ? 1 : 0) }));
    }
  }, [ready, inReports, canonical, requested, selected, location, selection.branch]);

  const selectBranch = useCallback((branchId: string | null) => {
    if (!ready || !/^\/phan-tich(?:\/|$)/.test(window.location.pathname) ||
      (branchId === null ? !canViewAll : !branches.some(branch => branch.id === branchId))) return;
    const url = new URL(window.location.href);
    url.searchParams.set("branch", branchId ?? "all");
    setSelection(previous => ({ branch: branchId, revision: previous.revision + 1 }));
    window.history.replaceState(window.history.state, "", url);
  }, [ready, canViewAll, branches]);
  const currentBranch = ready && selected ? branches.find(branch => branch.id === selected) ?? null : null;
  const branchLabel = !ready ? "Đang xác minh phạm vi" : selected === null ? "Tất cả chi nhánh" : currentBranch?.name ?? "Chưa có chi nhánh được phép";
  const value: ReportScopeValue = {
    activeBranchId: ready ? selected ?? undefined : undefined,
    currentBranch, branches: ready ? branches : [],
    branchName: selected === null && ready ? "Toàn công ty" : branchLabel,
    branchLabel, canViewAll: ready && canViewAll, isReady, selectBranch,
    scopeKey: JSON.stringify([boundary, pathname, selected, historyRevision, selection.revision, isReady]),
  };
  return <ReportScopeContext.Provider value={value}>{children}</ReportScopeContext.Provider>;
}
