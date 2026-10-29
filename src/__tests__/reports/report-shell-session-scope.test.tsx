import { cleanup, render, screen } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "manager-a" }, tenant: { id: "tenant-a" }, activeBranchId: "branch-a",
  permissions: new Set(["reports.analytics", "reports.view_detail", "reports.export"]),
  branches: [{ id: "branch-a" }], isLoading: false, ready: true, mounts: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/phan-tich/ban-hang" }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ ...state, hasPermission: (permission: string) => state.permissions.has(permission) }) }));
vi.mock("@/lib/hooks/use-report-scope", () => ({ useReportScope: () => ({ isReady: state.ready }) }));
vi.mock("@/lib/reports/preferences", () => ({ rememberRecentReportPath: vi.fn() }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: () => null, DialogContent: () => null, DialogHeader: () => null,
  DialogTitle: () => null, DialogDescription: () => null,
}));
import { ReportShell } from "@/components/shared/report/report-shell";

function CachedReport() {
  const [owner] = useState(state.user.id);
  useEffect(() => { state.mounts(); }, []);
  return <p>Loaded for {owner}</p>;
}
beforeEach(() => {
  state.user = { id: "manager-a" }; state.tenant = { id: "tenant-a" };
  state.activeBranchId = "branch-a"; state.branches = [{ id: "branch-a" }];
  state.permissions = new Set(["reports.analytics", "reports.view_detail", "reports.export"]);
  state.isLoading = false; state.ready = true; state.mounts.mockReset();
});
afterEach(cleanup);

describe("shared report session isolation", () => {
  it.each(["account", "tenant", "branch", "permission", "assignment"])("remounts cached data on %s change", (change) => {
    const view = render(<ReportShell><CachedReport /></ReportShell>);
    expect(state.mounts).toHaveBeenCalledTimes(1);
    if (change === "account") state.user = { id: "manager-b" };
    if (change === "tenant") state.tenant = { id: "tenant-b" };
    if (change === "branch") state.activeBranchId = "branch-b";
    if (change === "permission") state.permissions = new Set(["reports.analytics", "reports.view_detail"]);
    if (change === "assignment") state.branches = [{ id: "branch-a" }, { id: "branch-b" }];
    view.rerender(<ReportShell><CachedReport /></ReportShell>);
    expect(state.mounts).toHaveBeenCalledTimes(2);
    if (change === "account") {
      expect(screen.queryByText("Loaded for manager-a")).not.toBeInTheDocument();
      expect(screen.getByText("Loaded for manager-b")).toBeInTheDocument();
    }
  });
  it("does not remount for equivalent sets in a different order", () => {
    state.branches = [{ id: "branch-a" }, { id: "branch-b" }];
    const view = render(<ReportShell><CachedReport /></ReportShell>);
    state.permissions = new Set(["reports.export", "reports.view_detail", "reports.analytics"]);
    state.branches = [{ id: "branch-b" }, { id: "branch-a" }];
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
    state.ready = false;
    const view = render(<ReportShell><CachedReport /></ReportShell>);
    expect(state.mounts).not.toHaveBeenCalled();
    state.ready = true; state.isLoading = true;
    view.rerender(<ReportShell><CachedReport /></ReportShell>);
    expect(state.mounts).not.toHaveBeenCalled();
    state.isLoading = false;
    view.rerender(<ReportShell><CachedReport /></ReportShell>);
    expect(state.mounts).toHaveBeenCalledTimes(1);
  });
});
