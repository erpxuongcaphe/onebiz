import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ branch: "fnb", range: { from: "2026-10-01", to: "2026-10-18" }, report: vi.fn(), exportExcel: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ tenant: { id: "onebiz" } }), useBranchFilter: () => ({ activeBranchId: state.branch, branchLabel: state.branch, isReady: true }), useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "custom", range: state.range, setPreset: vi.fn(), setCustomRange: vi.fn() }) }));
vi.mock("@/lib/hooks/use-live-data-refresh", () => ({ useLiveDataRefresh: vi.fn() }));
vi.mock("@/lib/services/supabase/customer-financial-report", () => ({ getCustomerFinancialReport: state.report }));
vi.mock("@/lib/services/supabase/reports", () => ({ getProfitAndLoss: async () => ({ current: { goodsRevenue: 100 }, previous: { goodsRevenue: 100 } }) }));
vi.mock("@/lib/utils/excel-export", async original => ({ ...await original<typeof import("@/lib/utils/excel-export")>(), exportReportToExcel: state.exportExcel }));
vi.mock("@/components/shared/report", () => ({ ReportPageHeader: ({ onExportFull, onExportView, exportDisabled }: { onExportFull: () => void; onExportView: () => void; exportDisabled: boolean }) => <><button disabled={exportDisabled} onClick={onExportFull}>Xuất đầy đủ</button><button disabled={exportDisabled} onClick={onExportView}>Xuất đang xem</button></>, ReportDataTable: ({ rows }: { rows: { name: string }[] }) => <div>{rows.map((row, index) => <span key={index}>{row.name}</span>)}</div> }));
import Page from "@/app/(main)/phan-tich/hieu-qua-khach-hang/page";
const row = (id: string, revenue: number) => ({ customerId: id, code: id, name: id, orders: 1, returns: 0, products: 1, salesAmount: revenue, returnAmount: 0, netRevenue: revenue, cogs: 40, grossProfit: revenue - 40, marginPercent: 60, averageOrderValue: revenue, missingCostLines: 0, lastActivityAt: "2026-10-18" });
beforeEach(() => { window.history.replaceState(null, "", "/"); state.branch = "fnb"; state.report.mockReset().mockResolvedValue([row("Alpha", 100), row("Beta", 200)]); state.exportExcel.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);
describe("customer profitability workflow", () => {
  it("exports every filtered row and all 19 columns, view export keeps preferences", async () => {
    render(<Page />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm khách hàng" }), { target: { value: "Alpha" } });
    await act(async () => screen.getByRole("button", { name: "Xuất đầy đủ" }).click());
    const sheet = state.exportExcel.mock.calls[0][0].sheets[0];
    expect(sheet.rows.map((value: { code: string }) => value.code)).toEqual(["Alpha"]);
    expect(sheet.columns).toHaveLength(19);
    expect(sheet.tablePreferenceKey).toBeUndefined();
    expect(sheet.footer.netRevenue).toBe(100);
    await act(async () => screen.getByRole("button", { name: "Xuất đang xem" }).click());
    expect(state.exportExcel.mock.calls[1][0].sheets[0].tablePreferenceKey).toBe("report.customer-profitability");
  });
  it("hides old rows and disables export immediately on scope switch", async () => {
    const view = render(<Page />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeEnabled());
    state.report.mockImplementation(() => new Promise(() => {}));
    state.branch = "retail"; view.rerender(<Page />);
    expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeDisabled();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });
  it("does not present a partial period response as complete", async () => {
    state.report.mockResolvedValueOnce([row("Alpha", 100)]).mockRejectedValueOnce(new Error("Prior unavailable"));
    render(<Page />);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeDisabled();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });
});
