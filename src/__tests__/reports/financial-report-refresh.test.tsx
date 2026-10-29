import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({ periodReady: true, branchId: "fnb", range: { from: "2026-10-01", to: "2026-10-18" }, refresh: undefined as (() => void) | undefined, pnl: vi.fn(), consolidated: vi.fn(), details: vi.fn(), exportExcel: vi.fn(), toast: vi.fn() }));
const actor = vi.hoisted(() => ({ id: "manager-a", allowExport: true, loading: false, denied: new Set<string>() }));
vi.mock("@/lib/contexts", () => ({
  useAuth: () => ({ user: { id: actor.id }, tenant: { id: "onebiz" }, isLoading: actor.loading, hasPermission: (permission: string) => !actor.denied.has(permission) && (!permission.startsWith("reports.export") || actor.allowExport) }),
  useBranchFilter: () => ({ activeBranchId: state.branchId || undefined, branches: [], isReady: true }),
  useToast: () => ({ toast: state.toast }),
}));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ isReady: state.periodReady, preset: "custom", range: state.range, setPreset: vi.fn(), setCustomRange: vi.fn() }) }));
vi.mock("@/lib/hooks/use-live-data-refresh", () => ({ useLiveDataRefresh: (refresh: () => void) => { state.refresh = refresh; } }));
vi.mock("@/lib/services", () => ({ getProfitAndLoss: state.pnl, getFinancialAnalysisDetails: state.details, getConsolidatedPnL: state.consolidated, getBranchPnLComparison: async () => [] }));
vi.mock("@/app/(main)/phan-tich/_components", () => ({ KpiCard: ({ label, value }: { label: string; value: string }) => <div>{label}: {value}</div>, ChartCard: ({ title }: { title: string; children: ReactNode }) => <h2>{title}</h2> }));
vi.mock("@/components/shared/report", () => ({ ReportPageHeader: ({ onExportView, onExportFull, subtitle }: { onExportView: () => void; onExportFull: () => void; subtitle: string }) => <><p>{subtitle}</p><button onClick={onExportView}>Xuất bảng</button><button onClick={onExportFull}>Xuất đầy đủ</button></>, ReportTableFrame: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/utils/excel-export", async original => ({ ...await original<typeof import("@/lib/utils/excel-export")>(), exportReportToExcel: state.exportExcel }));
import FinancialReport from "@/app/(main)/phan-tich/bao-cao-tai-chinh/page";

function result(value: number) {
  const period = { period: "2026-10", revenue: value, goodsRevenue: value, deliveryFee: 0, cogs: 1.29, cogsComplete: true, missingCostLines: 0, grossProfit: value - 1.29, grossMargin: 50, operatingExpense: 0, netProfit: value - 1.29, netMargin: 50 };
  return { current: period, previous: period, cogsCostBasis: { current: { complete: true, snapshotLines: 1 }, previous: { complete: true, snapshotLines: 1 } } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  actor.id = "manager-a";
  actor.allowExport = true;
  actor.loading = false;
  actor.denied.clear();
  state.periodReady = true;
  state.range = { from: "2026-10-01", to: "2026-10-18" };
  state.branchId = "fnb";
  state.pnl.mockReset().mockResolvedValue(result(123456));
  state.consolidated.mockReset().mockResolvedValue(result(345678));
  state.details.mockReset().mockResolvedValue({ cogsItems: [], cogsTotalCount: 0, marginTrend: [], reconciliation: { invoiceCount: 0, returnCount: 0 }, granularity: "day", turnover: {}, dso: {} });
  state.exportExcel.mockReset().mockResolvedValue(undefined);
  state.toast.mockReset();
});
afterEach(cleanup);

describe("financial report scope and refresh", () => {
  it.each(["reports.analytics", "reports.view_detail", "reports.view_profit"])("does not query financial sources without %s", async permission => {
    actor.denied.add(permission);
    render(<FinancialReport />);
    expect(screen.getByRole("alert")).toHaveTextContent("chưa có đủ quyền");
    await act(async () => { state.refresh?.(); });
    expect(state.pnl).not.toHaveBeenCalled();
    expect(state.details).not.toHaveBeenCalled();
    expect(state.consolidated).not.toHaveBeenCalled();
  });
  it("waits for authentication then loads the same authorized branch report", async () => {
    actor.loading = true;
    const view = render(<FinancialReport />);
    expect(screen.getByRole("status")).toHaveTextContent("xác thực");
    expect(state.pnl).not.toHaveBeenCalled();
    actor.loading = false;
    view.rerender(<FinancialReport />);
    await screen.findByText("Doanh thu thuần: 123,456");
    expect(state.pnl).toHaveBeenCalledExactlyOnceWith("fnb", state.range);
  });
  it("discards a pending response after report access is revoked", async () => {
    const pending = deferred<ReturnType<typeof result>>();
    state.pnl.mockReturnValueOnce(pending.promise);
    const view = render(<FinancialReport />);
    await waitFor(() => expect(state.pnl).toHaveBeenCalledTimes(1));
    actor.denied.add("reports.view_profit");
    view.rerender(<FinancialReport />);
    await act(async () => pending.resolve(result(999999)));
    expect(screen.getByRole("alert")).toHaveTextContent("chưa có đủ quyền");
    expect(screen.queryByText("Doanh thu thuần: 999,999")).not.toBeInTheDocument();
    expect(state.pnl).toHaveBeenCalledTimes(1);
    actor.denied.clear();
    view.rerender(<FinancialReport />);
    await screen.findByText("Doanh thu thuần: 123,456");
    expect(state.pnl).toHaveBeenCalledTimes(2);
  });
  it.each(["", "fnb"])("retains explicit scope in financial reconciliation links for %s", async (branch) => {
    state.branchId = branch;
    state.details.mockResolvedValue({ cogsItems: [], cogsTotalCount: 0, marginTrend: [], reconciliation: { invoiceCount: 1, returnCount: 1 }, granularity: "day", turnover: {}, dso: {} });
    render(<FinancialReport />);
    for (const label of ["Xem hóa đơn", "Xem dòng trả"]) {
      const link = await screen.findByRole("link", { name: label });
      const url = new URL(link.getAttribute("href")!, "https://example.test");
      expect(url.searchParams.get("branch")).toBe(branch || "all");
      expect(url.searchParams.get("basis")).toBe(branch ? null : "external");
      expect(url.searchParams.get("from")).toBe(state.range.from);
      expect(url.searchParams.get("to")).toBe(state.range.to);
      expect(url.searchParams.get("view")).toBe("table");
    }
  });

  it("reloads the same branch after the authenticated account changes", async () => {
    const view = render(<FinancialReport />);
    await screen.findByText("Doanh thu thuần: 123,456");
    const next = deferred<ReturnType<typeof result>>();
    state.pnl.mockReturnValueOnce(next.promise);
    actor.id = "manager-b";
    view.rerender(<FinancialReport />);
    expect(screen.queryByText("Doanh thu thuần: 123,456")).not.toBeInTheDocument();
    await waitFor(() => expect(state.pnl).toHaveBeenCalledTimes(2));
    await act(async () => next.resolve(result(777777)));
    expect(screen.getByText("Doanh thu thuần: 777,777")).toBeInTheDocument();
  });

  it.each(["Xuất bảng", "Xuất đầy đủ"])("masks incomplete operating results in %s", async (button) => {
    const data = result(123456);
    Object.assign(data.current, { operatingExpenseComplete: false });
    state.pnl.mockResolvedValue(data);
    render(<FinancialReport />);
    await screen.findByRole("button", { name: button });
    await act(async () => screen.getByRole("button", { name: button }).click());
    const file = state.exportExcel.mock.calls[0][0];
    const rows = file.sheets.flatMap((sheet: { rows: { label?: string }[] }) => sheet.rows ?? []);
    const operating = rows.find((row: { label?: string }) => row.label === "= Kết quả vận hành");
    expect(operating).toMatchObject({ current: null, previous: null });
    expect(rows.find((row: { label?: string }) => row.label === "= Lãi gộp").current).toBeCloseTo(123454.71);
  });

  it("invalidates an export on permission change and unmount", async () => {
    const view = render(<FinancialReport />);
    await screen.findByRole("button", { name: "Xuất bảng" });
    await act(async () => screen.getByRole("button", { name: "Xuất bảng" }).click());
    const file = state.exportExcel.mock.calls[0][0];
    expect(file.shouldSave()).toBe(true);
    actor.allowExport = false;
    view.rerender(<FinancialReport />);
    expect(file.shouldSave()).toBe(false);
    view.unmount();
    expect(file.shouldSave()).toBe(false);
  });

  it("waits for restored date filters before requesting any report source", async () => {
    state.periodReady = false;
    const view = render(<FinancialReport />);
    expect(state.pnl).not.toHaveBeenCalled();
    expect(state.details).not.toHaveBeenCalled();
    expect(state.consolidated).not.toHaveBeenCalled();
    state.range = { from: "2026-09-01", to: "2026-09-30" };
    state.periodReady = true;
    view.rerender(<FinancialReport />);
    await screen.findByText("Doanh thu thuần: 123,456");
    expect(state.pnl).toHaveBeenCalledExactlyOnceWith("fnb", state.range);
    expect(state.details).toHaveBeenCalledExactlyOnceWith("fnb", state.range, false, 50_000);
  });

  it("only fetches the selected total source when consolidation changes", async () => {
    state.branchId = "";
    render(<FinancialReport />);
    await screen.findByText("Doanh thu thuần: 345,678");
    expect(state.pnl).not.toHaveBeenCalled();
    expect(state.consolidated).toHaveBeenCalledTimes(1);
    const next = deferred<ReturnType<typeof result>>();
    state.pnl.mockReturnValueOnce(next.promise);
    act(() => screen.getByRole("checkbox", { name: "Hợp nhất · loại nội bộ" }).click());
    expect(screen.queryByText("Doanh thu thuần: 345,678")).not.toBeInTheDocument();
    await waitFor(() => expect(state.pnl).toHaveBeenCalledTimes(1));
    expect(state.consolidated).toHaveBeenCalledTimes(1);
    expect(state.details).toHaveBeenLastCalledWith(undefined, state.range, false, 50_000);
    await act(async () => next.resolve(result(987654)));
    expect(screen.getByText("Doanh thu thuần: 987,654")).toBeInTheDocument();
  });

  it("ignores a late result after switching date ranges quickly", async () => {
    const view = render(<FinancialReport />);
    await screen.findByText("Doanh thu thuần: 123,456");
    const old = deferred<ReturnType<typeof result>>();
    state.pnl.mockReturnValueOnce(old.promise);
    state.range = { from: "2026-09-01", to: "2026-09-30" };
    view.rerender(<FinancialReport />);
    await waitFor(() => expect(state.pnl).toHaveBeenCalledTimes(2));
    state.range = { from: "2026-08-01", to: "2026-08-31" };
    state.pnl.mockResolvedValue(result(777777));
    view.rerender(<FinancialReport />);
    await screen.findByText("Doanh thu thuần: 777,777");
    expect(state.details).toHaveBeenLastCalledWith("fnb", state.range, false, 50_000);
    await act(async () => old.resolve(result(999999)));
    expect(screen.queryByText("Doanh thu thuần: 999,999")).not.toBeInTheDocument();
    expect(screen.getByText("Doanh thu thuần: 777,777")).toBeInTheDocument();
  });

  it("keeps the error boundary until a complete retry succeeds", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<FinancialReport />);
    await screen.findByText("Doanh thu thuần: 123,456");
    state.details.mockRejectedValueOnce(new Error("Không tải được chi tiết"));
    await act(async () => { state.refresh?.(); });
    await screen.findByRole("alert");
    const retry = deferred<object>();
    state.details.mockReturnValueOnce(retry.promise);
    state.pnl.mockResolvedValue(result(987654));
    act(() => screen.getByRole("button", { name: "Thử lại" }).click());
    expect(screen.getByRole("alert")).toHaveTextContent("Không tải được chi tiết");
    expect(screen.getByRole("button", { name: "Đang tải lại..." })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Xuất đầy đủ" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Doanh thu thuần:/)).not.toBeInTheDocument();
    await act(async () => retry.resolve({ cogsItems: [], cogsTotalCount: 0, marginTrend: [], reconciliation: { invoiceCount: 0, returnCount: 0 }, granularity: "day", turnover: {}, dso: {} }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Doanh thu thuần: 987,654")).toBeInTheDocument();
    log.mockRestore();
  });

  it("keeps failed repeated retries hidden and allows another retry", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<FinancialReport />);
    await screen.findByText("Doanh thu thuần: 123,456");
    state.details.mockRejectedValue(new Error("Nguồn chi tiết tạm lỗi"));
    await act(async () => { state.refresh?.(); });
    await screen.findByRole("alert");
    await act(async () => screen.getByRole("button", { name: "Thử lại" }).click());
    expect(screen.getByRole("alert")).toHaveTextContent("Nguồn chi tiết tạm lỗi");
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Xuất bảng" })).not.toBeInTheDocument();
    expect(state.exportExcel).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("coalesces live events and exports the same fractional values and comparison dates", async () => {
    const first = deferred<ReturnType<typeof result>>();
    state.pnl.mockReturnValueOnce(first.promise);
    render(<FinancialReport />);
    await waitFor(() => expect(state.pnl).toHaveBeenCalledTimes(1));
    act(() => { state.refresh?.(); state.refresh?.(); state.refresh?.(); });
    expect(state.pnl).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(result(111111)));
    await waitFor(() => expect(state.pnl).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Doanh thu thuần: 123,456")).toBeInTheDocument());
    await act(async () => screen.getByRole("button", { name: "Xuất bảng" }).click());
    const file = state.exportExcel.mock.calls[0][0];
    expect(file.sheets[0].rows.find((row: { label: string }) => row.label === "= Lãi gộp").current).toBeCloseTo(123454.71);
    expect(file.sheets[0].titleRows.join(" ")).toContain("13/09/2026 - 30/09/2026");
    expect(file.sheets[0].columns.find((column: { key: string }) => column.key === "current")).toMatchObject({ format: "number", decimalPlaces: 2 });
  });

  it("hides old results immediately and rejects a late response from the previous branch", async () => {
    const old = deferred<ReturnType<typeof result>>();
    state.pnl.mockReturnValueOnce(old.promise);
    const view = render(<FinancialReport />);
    await waitFor(() => expect(state.pnl).toHaveBeenCalledTimes(1));
    state.branchId = "retail";
    view.rerender(<FinancialReport />);
    expect(screen.queryByRole("button", { name: "Xuất bảng" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Doanh thu thuần: 123,456")).toBeInTheDocument());
    await act(async () => old.resolve(result(111111)));
    expect(screen.queryByText("Doanh thu thuần: 111,111")).not.toBeInTheDocument();
  });

  it("does not fall back to branch totals when consolidated data is unavailable", async () => {
    state.branchId = "";
    state.consolidated.mockResolvedValue(null);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<FinancialReport />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Chưa tải được số hợp nhất"));
    expect(screen.queryByText("Doanh thu thuần: 123,456")).not.toBeInTheDocument();
    log.mockRestore();
  });

  it("hides a previously loaded branch while its replacement is pending", async () => {
    const view = render(<FinancialReport />);
    await waitFor(() => expect(screen.getByText("Doanh thu thuần: 123,456")).toBeInTheDocument());
    const next = deferred<ReturnType<typeof result>>();
    state.pnl.mockReturnValueOnce(next.promise);
    state.branchId = "retail";
    view.rerender(<FinancialReport />);
    expect(screen.queryByText("Doanh thu thuần: 123,456")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xuất bảng" })).not.toBeInTheDocument();
    await act(async () => next.resolve(result(987654)));
    expect(screen.getByText("Doanh thu thuần: 987,654")).toBeInTheDocument();
  });

  it("cancels full export if the scope changes during its detail request", async () => {
    const view = render(<FinancialReport />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeInTheDocument());
    const details = deferred<object>();
    state.details.mockReturnValueOnce(details.promise);
    act(() => screen.getByRole("button", { name: "Xuất đầy đủ" }).click());
    state.branchId = "retail";
    view.rerender(<FinancialReport />);
    await act(async () => details.resolve({}));
    expect(state.exportExcel).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Báo cáo đã cập nhật. Vui lòng xuất lại." }));
  });
});
