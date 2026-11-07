import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({ branch: "branch-a", range: { from: "2026-11-01", to: "2026-11-03" }, balances: vi.fn(), kpis: vi.fn(), directory: vi.fn(), excel: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ tenant: { name: "Fixture" } }), useToast: () => ({ toast: state.toast }), useBranchFilter: () => ({ activeBranchId: state.branch, isReady: true, branches: [{ id: state.branch, name: state.branch }] }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "thisMonth", range: state.range, viewMode: "table", setPreset: vi.fn(), setCustomRange: vi.fn(), setViewMode: vi.fn() }) }));
vi.mock("@/lib/services", () => ({ getCustomerKpis: state.kpis, getNewCustomersMonthly: async () => [], getCustomerSegments: async () => [], getTopCustomersByRevenue: async () => [{ customerId: "c", code: "KH1", name: "Fixture", orders: 1, revenue: 100, rank: 1 }], getCustomers: state.directory }));
vi.mock("@/lib/services/supabase/customer-report-balances", () => ({ getCustomerReportBalances: state.balances }));
vi.mock("@/lib/utils/excel-export", async original => ({ ...await original<typeof import("@/lib/utils/excel-export")>(), exportReportToExcel: state.excel }));
vi.mock("@/app/(main)/phan-tich/_components", () => ({ KpiCard: ({ label, value, change }: { label: string; value: string; change: string }) => <div>{label}: {value}<span>{change}</span></div>, ChartCard: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section> }));
vi.mock("@/components/shared/report", () => ({ ReportTableFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>, ReportPageHeader: ({ onExportFull, onExportView, exportDisabled }: { onExportFull: () => void; onExportView: () => void; exportDisabled: boolean }) => <><button disabled={exportDisabled} onClick={onExportFull}>Full</button><button disabled={exportDisabled} onClick={onExportView}>View</button></> }));
import Page from "@/app/(main)/phan-tich/khach-hang/page";

const balance = () => ({ canViewDebt: true, complete: true, asOf: "2026-11-03T00:00:00Z", totalReceivable: 50, totalAdvance: 70,
  rows: [{ customerId: "c", code: "KH1", name: "Fixture", receivable: 50, advance: 70 }] });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  state.branch = "branch-a";
  state.balances.mockReset().mockResolvedValue(balance());
  state.kpis.mockReset().mockResolvedValue({ totalCustomers: 1, newThisMonth: 1, prevNewMonth: 0, returningPct: 0, totalDebt: 999999, prevTotalDebt: 999999 });
  state.directory.mockReset().mockResolvedValue({ data: [{ id: "c", name: "Fixture", code: "KH1", phone: "", totalSales: 999999, currentDebt: 999999 }] });
  state.excel.mockReset().mockResolvedValue(undefined); state.toast.mockReset();
});
afterEach(cleanup);
async function ready() { await waitFor(() => expect(screen.getByRole("button", { name: "Full" })).toBeEnabled()); }

describe("customer current balances integration", () => {
  it("uses the balance source and does not request legacy invoice debt", async () => {
    render(<Page />); await ready();
    expect(state.kpis).toHaveBeenCalledWith("branch-a", expect.any(Object), { includeLegacyDebt: false });
    expect(state.balances).toHaveBeenCalledWith({ branchId: "branch-a" });
    expect(screen.getByRole("region", { name: "Số dư khách hàng" })).toHaveTextContent("Tiền ứng còn lại");
    expect(screen.queryByText(/999,999/)).not.toBeInTheDocument();
  });
  it.each(["Full", "View"])("checks export permission and writes both balance amounts in %s", async name => {
    render(<Page />); await ready();
    await act(async () => fireEvent.click(screen.getByRole("button", { name })));
    expect(state.balances).toHaveBeenLastCalledWith({ branchId: "branch-a", forExport: true });
    const file = state.excel.mock.calls[0][0];
    expect(file.sheets.find((sheet: { name: string }) => sheet.name === "Số dư khách hàng").footer).toMatchObject({ receivable: 50, advance: 70 });
    expect(JSON.stringify(file)).not.toContain("999999");
  });
  it("does not render or export debt when the source masks it", async () => {
    state.balances.mockResolvedValue({ ...balance(), canViewDebt: false, rows: [], totalReceivable: null, totalAdvance: null, complete: null });
    render(<Page />); await ready();
    expect(screen.queryByRole("region", { name: "Số dư khách hàng" })).not.toBeInTheDocument();
    expect(screen.getByText("Chưa được cấp quyền xem công nợ")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Full" })));
    expect(state.excel.mock.calls[0][0].sheets.some((sheet: { name: string }) => sheet.name === "Số dư khách hàng")).toBe(false);
  });
  it("aborts export when permission verification fails", async () => {
    render(<Page />); await ready(); state.balances.mockRejectedValueOnce(new Error("REPORT_EXPORT_DENIED"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "View" })));
    expect(state.excel).not.toHaveBeenCalled(); expect(state.toast).toHaveBeenCalled();
  });
  it("shows incomplete coverage without treating it as complete zero", async () => {
    state.balances.mockResolvedValue({ ...balance(), complete: false });
    render(<Page />); await ready();
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa dùng để chốt công nợ");
  });
  it("does not export a previous scope after switching branches", async () => {
    const view = render(<Page />); await ready(); const pending = deferred<ReturnType<typeof balance>>();
    state.balances.mockReturnValueOnce(pending.promise);
    act(() => fireEvent.click(screen.getByRole("button", { name: "Full" })));
    state.branch = "branch-b"; view.rerender(<Page />);
    await act(async () => pending.resolve(balance()));
    expect(state.excel).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Phạm vi đã đổi. Vui lòng xuất lại." }));
  });
  it("uses the same filtered balance rows in the table and Excel", async () => {
    render(<Page />); await ready();
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm khách công nợ" }), { target: { value: "no match" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "View" })));
    const sheet = state.excel.mock.calls[0][0].sheets.find((sheet: { name: string }) => sheet.name === "Số dư khách hàng");
    expect(sheet.rows).toEqual([]); expect(sheet.footer).toMatchObject({ receivable: 0, advance: 0 });
  });
});
