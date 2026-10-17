import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  branchId: "branch-a", refresh: undefined as (() => void) | undefined,
  getOverviewKpis: vi.fn(), exportReportToExcel: vi.fn(), range: { from: "2026-09-01", to: "2026-09-30" },
}));
vi.mock("@/lib/contexts", () => ({
  useBranchFilter: () => ({ activeBranchId: state.branchId, branchLabel: state.branchId, isReady: true }),
  useAuth: () => ({ tenant: { id: "tenant-1", name: "OneBiz" }, hasPermission: () => true }),
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-report-state", () => ({
  useReportState: () => ({ preset: "custom", range: state.range, viewMode: "table", setPreset: vi.fn(), setCustomRange: vi.fn(), setViewMode: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-live-data-refresh", () => ({
  useLiveDataRefresh: (refresh: () => void) => { state.refresh = refresh; },
}));
vi.mock("@/lib/services", () => ({
  getOverviewKpis: state.getOverviewKpis,
  getSalesReportDailyRows: async () => [],
  getRevenueByCategory: async () => [],
  getTopProductsByRevenue: async () => [],
}));
vi.mock("@/lib/services/supabase/reports", () => ({ getBranchPnLComparison: async () => [] }));
vi.mock("@/components/shared/report", () => ({
  ReportPageHeader: ({ onExportView, exportDisabled }: { onExportView: () => void; exportDisabled: boolean }) => <><h1>Tổng quan kinh doanh</h1><button onClick={onExportView} disabled={exportDisabled}>Xuất bảng</button></>,
  ReportTableFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/utils/excel-export", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/utils/excel-export")>(),
  exportReportToExcel: state.exportReportToExcel,
}));
vi.mock("@/components/shared/report/management-review", () => ({ ManagementReview: () => <div>Đối chiếu quản trị</div> }));
import Overview from "@/app/(main)/phan-tich/page";

function result(revenue: number) {
  const period = { period: "2026-09", goodsRevenue: revenue, revenue, deliveryFee: 0, cogs: 0, cogsComplete: true, missingCostLines: 0, grossProfit: revenue, grossMargin: 100, operatingExpense: 0, netProfit: revenue, netMargin: 100 };
  return { revenue, prevRevenue: 0, orders: 1, prevOrders: 0, newCustomers: 0, prevNewCustomers: 0, profit: revenue, prevProfit: 0, expense: 0, prevExpense: 0, profitMargin: 100, prevProfitMargin: 0, financial: { current: period, previous: period } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { state.branchId = "branch-a"; state.getOverviewKpis.mockReset(); state.exportReportToExcel.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);

describe("overview refresh safety", () => {
  it("coalesces events during a request instead of canceling it repeatedly", async () => {
    const first = deferred<ReturnType<typeof result>>();
    state.getOverviewKpis.mockReturnValueOnce(first.promise).mockResolvedValue(result(222222));
    render(<Overview />);
    await waitFor(() => expect(state.getOverviewKpis).toHaveBeenCalledTimes(1));
    act(() => { state.refresh?.(); state.refresh?.(); state.refresh?.(); });
    expect(state.getOverviewKpis).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(result(111111)); });
    await waitFor(() => expect(state.getOverviewKpis).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("222,222đ").length).toBeGreaterThan(0);
  });

  it("never publishes a late response from a previous branch", async () => {
    const old = deferred<ReturnType<typeof result>>();
    state.getOverviewKpis.mockReturnValueOnce(old.promise).mockResolvedValue(result(333333));
    const view = render(<Overview />);
    await waitFor(() => expect(state.getOverviewKpis).toHaveBeenCalledTimes(1));
    state.branchId = "branch-b";
    view.rerender(<Overview />);
    await waitFor(() => expect(screen.getAllByText("333,333đ").length).toBeGreaterThan(0));
    await act(async () => { old.resolve(result(111111)); });
    expect(screen.queryByText("111,111đ")).not.toBeInTheDocument();
    expect(state.getOverviewKpis).toHaveBeenLastCalledWith("branch-b", state.range);
  });

  it("exports the gross-profit KPI shown on screen and the same financial bridge", async () => {
    state.getOverviewKpis.mockResolvedValue(result(444444));
    render(<Overview />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Xuất bảng" })).toBeEnabled());
    await act(async () => { screen.getByRole("button", { name: "Xuất bảng" }).click(); });
    const exported = state.exportReportToExcel.mock.calls[0][0];
    expect(exported.range).toEqual(state.range);
    expect(exported.branchName).toBe("branch-a");
    expect(exported.sheets[0].rows.find((row: { metric: string }) => row.metric === "Lãi gộp")).toMatchObject({ value: 444444 });
    expect(exported.sheets[1].rows.find((row: { metric: string }) => row.metric === "Lãi gộp")).toMatchObject({ current: 444444 });
  });
});
