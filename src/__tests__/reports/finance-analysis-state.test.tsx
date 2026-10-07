import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ finance: vi.fn(), cash: vi.fn(), toast: vi.fn(), excel: vi.fn() }));
vi.mock("@/lib/contexts", () => ({
  useBranchFilter: () => ({ activeBranchId: "branch", branchLabel: "Branch", isReady: true }),
  useAuth: () => ({ tenant: { name: "Tenant" } }),
  useToast: () => ({ toast: mocks.toast }),
}));
const range = { from: "2026-10-01", to: "2026-10-07" };
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({
  preset: "thisMonth", range, setPreset: vi.fn(), setCustomRange: vi.fn(), viewMode: "table", setViewMode: vi.fn(),
}) }));
vi.mock("@/lib/services", () => ({ getFinanceDashboardReport: mocks.finance, getCashFlow: mocks.cash }));
vi.mock("@/lib/utils/excel-export", () => ({
  exportReportToExcel: mocks.excel, buildReportTitleRows: () => [], buildInfoSheet: () => ({}),
}));
vi.mock("@/components/shared/report", () => ({
  ReportPageHeader: ({ exportDisabled, onExportView }: { exportDisabled: boolean; onExportView: () => void }) =>
    <button disabled={exportDisabled} onClick={onExportView}>Export</button>,
  ReportDataTable: ({ rows }: { rows: unknown[] }) => <pre>{JSON.stringify(rows)}</pre>,
  ReportTableFrame: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/(main)/phan-tich/_components", () => ({
  KpiCard: ({ label, value }: { label: string; value: string }) => <div>{label}: {value}</div>,
  ChartCard: ({ children }: { children: React.ReactNode }) => children,
}));

import FinancePage from "@/app/(main)/phan-tich/tai-chinh/page";

const result = {
  kpis: { revenue: 100, prevRevenue: 0, expense: 40, prevExpense: 0, profit: 60, prevProfit: 0, profitMargin: 60, prevProfitMargin: 0 },
  trend: [{ label: "T10/2026", revenue: 100, cogs: 30, operatingExpense: 10, expense: 40, profit: 60 }],
  expenseBreakdown: [],
};

describe("financial analysis loading and export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.finance.mockResolvedValue(result);
    mocks.cash.mockResolvedValue([]);
    mocks.excel.mockResolvedValue(undefined);
  });
  it("shows a load error rather than zero figures and supports retry", async () => {
    mocks.finance.mockRejectedValueOnce(new Error("Network unavailable"));
    render(<FinancePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
    expect(screen.queryByText(/Doanh thu thuần:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Thử lại/ }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText(/"cogs":30/)).toBeInTheDocument();
  });
  it("only reports export success after the file operation completes", async () => {
    let finish!: () => void;
    mocks.excel.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    render(<FinancePage />);
    const button = await screen.findByRole("button", { name: "Export" });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(mocks.toast).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" })));
    expect(mocks.excel.mock.calls[0][0].sheets[1].rows).toEqual(result.trend);
  });
});
