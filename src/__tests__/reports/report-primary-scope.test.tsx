import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportScopeSelector } from "@/components/shared/report/report-scope-selector";
import { ReportPageHeader } from "@/components/shared/report/report-page-header";
import DeliveryReportFilters from "@/components/shared/report/delivery-report-filters";
import { createDeliveryFilters } from "@/lib/reports/delivery-invoice-view";

const state = vi.hoisted(() => ({ activeBranchId: "branch-a" as string | null, canViewAll: false, isReady: true,
  branches: [{ id: "branch-a", name: "Chi nhánh A" }, { id: "branch-b", name: "Chi nhánh B có tên dài để kiểm tra" }],
  selectBranch: vi.fn(), scope: vi.fn(), authSwitch: vi.fn(), permissions: new Set<string>() }));
vi.mock("@/lib/hooks/use-report-scope", () => ({ useReportScope: (options: unknown) => {
  state.scope(options); return { ...state };
} }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ hasPermission: (key: string) => state.permissions.has(key), switchBranch: state.authSwitch }) }));
vi.mock("@/lib/hooks/use-breakpoint", () => ({ useBreakpoint: () => true }));
vi.mock("@/components/shared/report/report-date-range-picker", () => ({ ReportDateRangePicker: () => <button>Ngày báo cáo</button> }));

const headerProps = { title: "Báo cáo thử", preset: "today" as const, range: { from: "2026-11-01", to: "2026-11-01" },
  onPresetChange: vi.fn(), onCustomRangeChange: vi.fn(), onExportView: vi.fn(), onExportFull: vi.fn() };
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks(); state.activeBranchId = "branch-a"; state.canViewAll = false; state.isReady = true;
  state.branches = [{ id: "branch-a", name: "Chi nhánh A" }, { id: "branch-b", name: "Chi nhánh B có tên dài để kiểm tra" }];
  state.permissions = new Set();
});

describe("shared primary report branch selector", () => {
  it("shows a labelled full-width mobile and stable-width desktop control using the unchanged scope hook", async () => {
    render(<ReportScopeSelector />);
    const input = screen.getByRole("combobox", { name: "Chi nhánh báo cáo" });
    expect(input).toHaveValue("Chi nhánh A");
    expect(screen.getByText("Chi nhánh báo cáo")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Phạm vi báo cáo" })).toHaveClass("w-full", "sm:w-72");
    expect(input.parentElement).toHaveClass("h-11", "w-full", "min-w-0");
    expect(state.scope).toHaveBeenCalledWith({ synchronizeUrl: false });
    fireEvent.click(input);
    fireEvent.click(await screen.findByRole("option", { name: "Chi nhánh B có tên dài để kiểm tra" }));
    expect(state.selectBranch).toHaveBeenCalledWith("branch-b");
    expect(state.authSwitch).not.toHaveBeenCalled();
  });
  it("never offers all-company or foreign branches without the existing capability", async () => {
    render(<ReportScopeSelector />); fireEvent.click(screen.getByRole("combobox", { name: "Chi nhánh báo cáo" }));
    expect(await screen.findAllByRole("option")).toHaveLength(2);
    expect(screen.queryByRole("option", { name: "Toàn công ty" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Foreign branch" })).not.toBeInTheDocument();
    expect(state.selectBranch).not.toHaveBeenCalled();
  });
  it("offers company scope only when authorized and passes null to the isolated scope action", async () => {
    state.canViewAll = true; state.activeBranchId = null;
    render(<ReportScopeSelector />);
    expect(screen.getByRole("combobox", { name: "Chi nhánh báo cáo" })).toHaveValue("Toàn công ty");
    fireEvent.click(screen.getByRole("combobox", { name: "Chi nhánh báo cáo" }));
    fireEvent.click(await screen.findByRole("option", { name: "Toàn công ty" }));
    expect(state.selectBranch).toHaveBeenCalledWith(null); expect(state.authSwitch).not.toHaveBeenCalled();
  });
  it("keeps a visible disabled control until ready, without showing stale selection", () => {
    state.isReady = false; render(<ReportScopeSelector />);
    const input = screen.getByRole("combobox", { name: "Chi nhánh báo cáo" });
    expect(input).toBeDisabled(); expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "Đang tải chi nhánh...");
    expect(screen.getByText("Chi nhánh báo cáo")).toBeInTheDocument();
  });
  it("keeps an explicit disabled state if no authorized branch exists", () => {
    state.branches = []; render(<ReportScopeSelector />);
    expect(screen.getByRole("combobox", { name: "Chi nhánh báo cáo" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Chi nhánh báo cáo" })).toHaveAttribute("placeholder", "Không có chi nhánh");
  });
  it("renders exactly one primary selector outside the header and none inside the scoped delivery panel", async () => {
    render(<><ReportScopeSelector /><ReportPageHeader {...headerProps} />
      <DeliveryReportFilters rows={[]} canViewMoney={false} filters={createDeliveryFilters()} onChange={vi.fn()}
        summaryMetrics={[]} onSummaryMetricsChange={vi.fn()} tab="staff" hasScopeContext /></>);
    expect(screen.getAllByRole("combobox", { name: "Chi nhánh báo cáo" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Ngày báo cáo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bộ lọc" }));
    expect(within(await screen.findByRole("dialog")).queryByLabelText("Chi nhánh")).not.toBeInTheDocument();
    expect(document.querySelectorAll('input[role="combobox"][aria-label="Chi nhánh báo cáo"]')).toHaveLength(1);
  });
});

describe("report header after central scope placement", () => {
  it("never mounts another scope hook, including snapshot headers and legacy hideBranchScope props", () => {
    render(<><ReportPageHeader {...headerProps} /><ReportPageHeader {...headerProps} hideDateRange hideBranchScope /></>);
    expect(screen.queryByRole("combobox", { name: "Chi nhánh báo cáo" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Ngày báo cáo" })).toHaveLength(1);
    expect(state.scope).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Xuất file/ })).not.toBeInTheDocument();
  });
  it("preserves export capability checks independently of branch selection", async () => {
    state.permissions.add("reports.export"); render(<ReportPageHeader {...headerProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Xuất file/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Xuất nội dung đang xem/ }));
    expect(headerProps.onExportView).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Xuất báo cáo đầy đủ/ })).not.toBeInTheDocument();
    expect(headerProps.onExportFull).not.toHaveBeenCalled();
  });
});
