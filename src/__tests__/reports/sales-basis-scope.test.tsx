import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ branch: "branch-a", periodReady: true,
  range: { from: "2026-10-01", to: "2026-10-18" },
  summary: vi.fn(), daily: vi.fn(), invoicePage: vi.fn(), full: vi.fn(), returns: vi.fn(), excel: vi.fn(), toast: vi.fn(),
}));
vi.mock("@/lib/contexts", () => ({ useBranchFilter: () => ({ activeBranchId: state.branch, branchLabel: "Branch A", branches: [], isReady: true }), useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ isReady: state.periodReady, range: state.range, preset: "custom", viewMode: "table", setPreset: vi.fn(), setCustomRange: vi.fn(), setViewMode: vi.fn() }) }));
vi.mock("@/lib/services", () => ({ getSalesReportSummary: state.summary, getSalesReportDailyRows: state.daily, getSalesReportInvoiceDetailPage: state.invoicePage, getSalesInvoiceExportRows: state.full, getSalesReturnReport: state.returns }));
vi.mock("@/app/(main)/phan-tich/_components", () => ({ KpiCard: ({ label, value }: { label: string; value: ReactNode }) => <p>{label}: {value}</p>, ChartCard: () => null }));
vi.mock("@/app/(main)/phan-tich/_components/kpi-card", () => ({ KpiCard: () => null }));
vi.mock("@/app/(main)/phan-tich/_components/chart-card", () => ({ ChartCard: () => null }));
vi.mock("@/components/shared/report", () => ({
  ReportPageHeader: ({ actions, onExportFull, onExportView, exportDisabled }: { actions: ReactNode; onExportFull?: () => void; onExportView?: () => void; exportDisabled: boolean }) => <>{actions}<button disabled={exportDisabled} onClick={onExportView}>Xuất bảng</button><button disabled={exportDisabled} onClick={onExportFull}>Xuất đầy đủ</button></>,
  ReportDataTable: () => <div>Bảng chi tiết</div>, ReportTableFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/utils/excel-export", async original => ({ ...await original<typeof import("@/lib/utils/excel-export")>(), exportReportToExcel: state.excel }));
import SalesReport from "@/app/(main)/phan-tich/ban-hang/page";
import ReturnReport from "@/app/(main)/phan-tich/tra-hang/page";

function summary(value = 100) {
  return { kpis: { invoiceCount: 1, prevInvoiceCount: 1, goodsRevenue: value, prevGoodsRevenue: value, netRevenue: value + 10, prevNetRevenue: value + 10, deliveryFee: 10, prevDeliveryFee: 10, returnAmount: 5, prevReturnAmount: 5, soldQty: 2, prevSoldQty: 2, avgOrderValue: value, prevAvgOrderValue: value, returnRate: 0, prevReturnRate: 0 }, dailyRevenue: [], revenueByWeekday: [], revenueByHour: [], topInvoices: [] };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  window.history.replaceState({}, "", "/phan-tich/ban-hang?branch=branch-a&basis=external");
  state.branch = "branch-a"; state.periodReady = true;
  state.summary.mockReset().mockResolvedValue(summary());
  state.daily.mockReset().mockResolvedValue([]);
  state.invoicePage.mockReset().mockResolvedValue({ rows: [], hasMore: false });
  state.full.mockReset().mockResolvedValue([]);
  state.returns.mockReset().mockResolvedValue({ rows: [{ returnId: "r1", returnCode: "TH1", returnDate: "2026-10-02T12:00:00+07:00", branchId: "branch-a", branchName: "Branch A", invoiceId: "i1", invoiceCode: "HD1", customerName: "Customer", reason: "Return", status: "completed", createdBy: "a", createdByName: "Staff", productId: "p1", productName: "Milk", quantity: 1, unitPrice: 5, returnValue: 5 }] });
  state.excel.mockReset().mockResolvedValue(undefined); state.toast.mockReset();
});
afterEach(cleanup);

describe("sales and returns share the selected reporting basis", () => {
  it("restores external basis before the first sales query", async () => {
    render(<SalesReport />);
    await waitFor(() => expect(state.summary).toHaveBeenCalledTimes(1));
    expect(state.summary).toHaveBeenCalledWith("branch-a", state.range, true);
    expect(state.daily).toHaveBeenCalledWith("branch-a", state.range, true);
    expect(screen.getByLabelText("Cơ sở giao dịch")).toHaveValue("external");
  });
  it("waits for date hydration before any sales request", async () => {
    state.periodReady = false;
    const view = render(<SalesReport />);
    expect(state.summary).not.toHaveBeenCalled(); expect(state.daily).not.toHaveBeenCalled();
    state.periodReady = true; view.rerender(<SalesReport />);
    await waitFor(() => expect(state.summary).toHaveBeenCalledWith("branch-a", state.range, true));
  });
  it("changes basis without accepting a late summary from the old basis", async () => {
    const old = deferred<ReturnType<typeof summary>>(); state.summary.mockReturnValueOnce(old.promise);
    render(<SalesReport />);
    await waitFor(() => expect(state.summary).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Cơ sở giao dịch"), { target: { value: "all" } });
    await screen.findByText("Doanh thu hàng hóa: 100đ");
    expect(state.summary).toHaveBeenLastCalledWith("branch-a", state.range, false);
    await act(async () => old.resolve(summary(999999)));
    expect(screen.queryByText(/999,999/)).not.toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get("basis")).toBe("all");
  });
  it("rejects a full export when the basis changes while invoice pages load", async () => {
    const pending = deferred<never[]>(); state.full.mockReturnValueOnce(pending.promise);
    render(<SalesReport />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Xuất đầy đủ" }));
    expect(state.full).toHaveBeenCalledWith("branch-a", state.range, true);
    fireEvent.change(screen.getByLabelText("Cơ sở giao dịch"), { target: { value: "all" } });
    await act(async () => pending.resolve([]));
    expect(state.excel).not.toHaveBeenCalled();
  });
  it("does not keep an old successful summary after a new source fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<SalesReport />);
    await screen.findByText("Doanh thu hàng hóa: 100đ");
    state.summary.mockRejectedValueOnce(new Error("Source unavailable"));
    fireEvent.change(screen.getByLabelText("Cơ sở giao dịch"), { target: { value: "all" } });
    await screen.findByText("Source unavailable");
    expect(screen.queryByText("Doanh thu hàng hóa: 100đ")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeDisabled();
    log.mockRestore();
  });
  it("loads return rows and the denominator with the same basis", async () => {
    render(<ReturnReport />);
    await waitFor(() => expect(state.returns).toHaveBeenCalledWith({ branchId: "branch-a", dateFrom: state.range.from, dateTo: state.range.to, excludeInternal: true }));
    expect(state.summary).toHaveBeenCalledWith("branch-a", state.range, true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Xuất đầy đủ" }));
    await waitFor(() => expect(state.excel).toHaveBeenCalledTimes(1));
    expect(state.excel.mock.calls[0][0].sheets[0].rows.flatMap((row: Record<string, unknown>) => Object.values(row)).join(" ")).toContain("Loại nội bộ");
  });
  it("awaits return workbook creation and reports its rejection", async () => {
    state.excel.mockRejectedValueOnce(new Error("Workbook failed"));
    render(<ReturnReport />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Xuất đầy đủ" }));
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Lỗi xuất Excel" })));
    expect(state.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Đã xuất báo cáo trả hàng" }));
  });
});
