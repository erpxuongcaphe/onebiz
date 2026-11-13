import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";

vi.mock("next/navigation", () => ({ usePathname: () => "/phan-tich/ban-hang", useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => <a {...props}>{children}</a> }));
vi.mock("@/components/shared/report/report-scope-selector", () => ({ ReportScopeSelector: () => <BranchSelector /> }));
vi.mock("@/lib/reports/preferences", () => ({ rememberRecentReportPath: vi.fn() }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: () => null, DialogContent: () => null, DialogHeader: () => null, DialogTitle: () => null, DialogDescription: () => null }));

import { AuthContext } from "@/lib/contexts/auth-context";
import { ReportShell } from "@/components/shared/report/report-shell";
import { useReportScope } from "@/lib/hooks/use-report-scope";

function BranchSelector() {
  const scope = useReportScope();
  return <button onClick={() => scope.selectBranch("a")}>Chọn quán A</button>;
}

afterEach(cleanup);
describe("report shell branch permissions", () => {
  it("opens the allowed report branch and denies another without changing the operational branch", async () => {
    window.history.replaceState({}, "", "/phan-tich/ban-hang?branch=b");
    const switchBranch = vi.fn();
    const value = {
      user: { id: "u", branchId: "a", role: "staff", isActive: true }, tenant: { id: "t" },
      branches: [{ id: "a", tenantId: "t", name: "A" }, { id: "b", tenantId: "t", name: "B" }],
      activeBranchId: "a", currentBranch: { id: "a", name: "A" },
      permissions: new Set<string>(), isLoading: false, authDataError: null,
      hasPermission: () => false,
      hasPermissionAtBranch: (code: string, branch: string | null) => branch === "b" && ["reports.analytics", "reports.view_detail"].includes(code),
      hasPermissionAtBranchWithLegacy: () => false,
      switchBranch,
    } as unknown as ComponentProps<typeof AuthContext.Provider>["value"];
    render(<AuthContext.Provider value={value}><ReportShell><p>Đã mở báo cáo</p></ReportShell></AuthContext.Provider>);
    expect(await screen.findByText("Đã mở báo cáo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chọn quán A" }));
    await waitFor(() => expect(screen.getByText("Chưa được cấp quyền xem báo cáo này")).toBeInTheDocument());
    expect(screen.queryByText("Đã mở báo cáo")).not.toBeInTheDocument();
    expect(switchBranch).not.toHaveBeenCalled();
  });
});
