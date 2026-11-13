import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode, MouseEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/phan-tich/fnb-shipper" }));
vi.mock("next/link", () => ({ default: ({ children, onClick, prefetch, ...props }: { children: ReactNode; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void; href: string; prefetch?: boolean }) => { void prefetch; return <a {...props} onClick={event => { event.preventDefault(); onClick?.(event); state.navigate(props.href); }}>{children}</a>; } }));
vi.mock("@/lib/contexts/auth-context", () => ({ AuthBranchPermissionScope: ({children}: {children: ReactNode}) => children, useAuth: () => ({ user: { id: "user" }, tenant: { id: "tenant" }, permissions: new Set(["reports.analytics", "reports.view_detail"]), branches: [{ id: "branch" }], isLoading: false, hasPermission: () => true }) }));
vi.mock("@/lib/contexts/report-scope-context", () => ({ ReportScopeProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/lib/hooks/use-report-scope", () => ({ useReportScope: () => ({ isReady: true, activeBranchId: "branch", scopeKey: "branch" }) }));
vi.mock("@/components/shared/report/report-scope-selector", () => ({ ReportScopeSelector: () => <p>Phạm vi thử</p> }));
vi.mock("@/lib/reports/preferences", () => ({ rememberRecentReportPath: vi.fn() }));
import { ReportShell } from "@/components/shared/report/report-shell";
import { PageLeaveGuard } from "@/components/shared/page-leave-guard";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("report picker is navigation, not an unsaved document", () => {
  it("allows choosing a report after searching without an unsaved-work prompt", async () => {
    render(<><PageLeaveGuard /><ReportShell><p>Report</p></ReportShell></>);
    fireEvent.click(screen.getByRole("button", { name: "Đổi báo cáo" }));
    fireEvent.change(screen.getByPlaceholderText("Tìm trong báo cáo..."), { target: { value: "Tồn kho và luân chuyển" } });
    fireEvent.click(screen.getByRole("link", { name: /Tồn kho và luân chuyển/ }));
    expect(state.navigate).toHaveBeenCalledWith("/phan-tich/aging");
    expect(screen.queryByText("Có nội dung chưa lưu")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("closes outside after a search and starts with an empty search on reopening", async () => {
    render(<><PageLeaveGuard /><ReportShell><p>Report</p></ReportShell></>);
    fireEvent.click(screen.getByRole("button", { name: "Đổi báo cáo" }));
    fireEvent.change(screen.getByPlaceholderText("Tìm trong báo cáo..."), { target: { value: "Tồn kho" } });
    fireEvent.pointerDown(document.body); fireEvent.pointerUp(document.body); fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("Có nội dung chưa lưu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đổi báo cáo" }));
    expect(screen.getByPlaceholderText("Tìm trong báo cáo...")).toHaveValue("");
  });
});
