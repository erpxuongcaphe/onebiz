import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Branch } from "@/lib/types/auth";

const state = vi.hoisted(() => ({
  user: { id: "manager-a" }, tenant: { id: "tenant-a" }, activeBranchId: "branch-a",
  permissions: new Set(["reports.analytics", "reports.view_detail", "reports.export"]),
  branches: [] as Branch[], isLoading: false, mounts: vi.fn(), switchBranch: vi.fn(),
  pathname: "/phan-tich/ban-hang",
  suspendScope: false, pendingUrl: new Promise<void>(() => {}),
}));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname,
  useSearchParams: () => { if (state.suspendScope) throw state.pendingUrl; return new URLSearchParams(window.location.search); } }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));
vi.mock("@/lib/contexts/auth-context", () => ({ AuthBranchPermissionScope: ({children}: {children: ReactNode}) => children, useAuth: () => ({ ...state,
  currentBranch: state.branches.find(branch => branch.id === state.activeBranchId) ?? null,
  hasPermission: (permission: string) => state.permissions.has(permission) }) }));
vi.mock("@/components/shared/report/report-scope-selector", () => ({ ReportScopeSelector: () => {
  const scope = useReportScope({ synchronizeUrl: false });
  return <div aria-label="Central report selector"><output>{scope.activeBranchId ?? "all"}</output>
    <button onClick={() => scope.selectBranch("branch-a")}>Select A</button>
    <button onClick={() => scope.selectBranch("branch-b")}>Select B</button>
  </div>;
} }));
vi.mock("@/lib/reports/preferences", () => ({ rememberRecentReportPath: vi.fn() }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: () => null, DialogContent: () => null, DialogHeader: () => null,
  DialogTitle: () => null, DialogDescription: () => null,
}));
import { ReportShell } from "@/components/shared/report/report-shell";
import { useReportScope } from "@/lib/hooks/use-report-scope";
import { useBranchFilter } from "@/lib/contexts/use-branch-filter";

const branch = (id: string): Branch => ({ id, tenantId: state.tenant.id, name: id,
  isDefault: id === "branch-a", branchType: "store", createdAt: "2026-01-01T00:00:00Z" });

function CachedReport() {
  const [owner] = useState(state.user.id);
  useEffect(() => { state.mounts(); }, []);
  return <p>Loaded for {owner}</p>;
}
beforeEach(() => {
  state.user = { id: "manager-a" }; state.tenant = { id: "tenant-a" };
  state.activeBranchId = "branch-a"; state.branches = [branch("branch-a"), branch("branch-b")];
  state.permissions = new Set(["reports.analytics", "reports.view_detail", "reports.export"]);
  state.isLoading = false; state.mounts.mockReset(); state.switchBranch.mockReset();
  state.pathname = "/phan-tich/ban-hang";
  state.suspendScope = false;
  window.history.replaceState({}, "", "/phan-tich/ban-hang?branch=branch-a");
});
afterEach(cleanup);

describe("shared report session isolation", () => {
  it("catches URL-hook suspension outside the provider with the same loading fallback", () => {
    state.suspendScope = true;
    render(<ReportShell><CachedReport /></ReportShell>);
    expect(screen.getByRole("status")).toHaveTextContent("Đang kiểm tra quyền báo cáo...");
    expect(state.mounts).not.toHaveBeenCalled();
  });
  it.each(["account", "tenant", "branch", "permission", "assignment"])("remounts cached data on %s change", (change) => {
    const view = render(<ReportShell><CachedReport /></ReportShell>);
    expect(state.mounts).toHaveBeenCalledTimes(1);
    if (change === "account") state.user = { id: "manager-b" };
    if (change === "tenant") { state.tenant = { id: "tenant-b" }; state.branches = [branch("branch-a")]; }
    if (change === "branch") fireEvent.click(screen.getByText("Select B"));
    if (change === "permission") state.permissions = new Set(["reports.analytics", "reports.view_detail"]);
    if (change === "assignment") state.branches = [branch("branch-a")];
    view.rerender(<ReportShell><CachedReport /></ReportShell>);
    expect(state.mounts).toHaveBeenCalledTimes(2);
    if (change === "account") {
      expect(screen.queryByText("Loaded for manager-a")).not.toBeInTheDocument();
      expect(screen.getByText("Loaded for manager-b")).toBeInTheDocument();
    }
  });
  it("does not remount for equivalent sets in a different order", () => {
    state.branches = [branch("branch-a"), branch("branch-b")];
    const view = render(<ReportShell><CachedReport /></ReportShell>);
    state.permissions = new Set(["reports.export", "reports.view_detail", "reports.analytics"]);
    state.branches = [branch("branch-b"), branch("branch-a")];
    view.rerender(<ReportShell><CachedReport /></ReportShell>);
    expect(state.mounts).toHaveBeenCalledTimes(1);
  });
  it("unmounts cached data immediately on access revocation", () => {
    const view = render(<ReportShell><CachedReport /></ReportShell>);
    state.permissions = new Set();
    view.rerender(<ReportShell><CachedReport /></ReportShell>);
    expect(screen.queryByText("Loaded for manager-a")).not.toBeInTheDocument();
    expect(screen.getByText("Chưa được cấp quyền xem báo cáo này")).toBeInTheDocument();
  });
  it("does not mount reports before authentication and scope are ready", () => {
    state.branches = [];
    const view = render(<ReportShell><CachedReport /></ReportShell>);
    expect(state.mounts).not.toHaveBeenCalled();
    state.branches = [branch("branch-a")]; state.isLoading = true;
    view.rerender(<ReportShell><CachedReport /></ReportShell>);
    expect(state.mounts).not.toHaveBeenCalled();
    state.isLoading = false;
    view.rerender(<ReportShell><CachedReport /></ReportShell>);
    expect(state.mounts).toHaveBeenCalledTimes(1);
  });
  it.each(["/phan-tich/aging", "/phan-tich/trung-tam"])("offers exactly one central selector on %s", pathname => {
    state.pathname = pathname; window.history.replaceState({}, "", `${pathname}?branch=branch-a`);
    render(<ReportShell><CachedReport /></ReportShell>);
    expect(screen.getAllByLabelText("Central report selector")).toHaveLength(1);
    fireEvent.click(screen.getByText("Select B"));
    expect(state.activeBranchId).toBe("branch-a"); expect(state.switchBranch).not.toHaveBeenCalled();
  });
  it("isolates late old results across A -> B -> A remounts", async () => {
    const pending: Array<{ branch: string | undefined; resolve: (value: string) => void }> = [];
    function AsyncReport() {
      const { activeBranchId } = useBranchFilter();
      const [value, setValue] = useState("pending");
      useEffect(() => {
        void new Promise<string>(resolve => { pending.push({ branch: activeBranchId, resolve }); }).then(setValue);
      }, [activeBranchId]);
      return <p>Report data: {value}</p>;
    }
    render(<ReportShell><AsyncReport /></ReportShell>);
    fireEvent.click(screen.getByText("Select B")); fireEvent.click(screen.getByText("Select A"));
    expect(pending.map(item => item.branch)).toEqual(["branch-a", "branch-b", "branch-a"]);
    await act(async () => pending[2].resolve("current A"));
    await act(async () => { pending[0].resolve("old A"); pending[1].resolve("old B"); });
    expect(screen.getByText("Report data: current A")).toBeInTheDocument();
    expect(screen.queryByText("Report data: old A")).not.toBeInTheDocument();
    expect(screen.queryByText("Report data: old B")).not.toBeInTheDocument();
  });
  it("remounts even if A -> B -> A selection events batch before a report render", () => {
    render(<ReportShell><CachedReport /></ReportShell>);
    act(() => {
      screen.getByText("Select B").click();
      screen.getByText("Select A").click();
    });
    expect(state.mounts).toHaveBeenCalledTimes(2);
    expect(new URLSearchParams(window.location.search).get("branch")).toBe("branch-a");
  });
});
