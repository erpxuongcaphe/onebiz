import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ branch: "b", from: "2026-10-01", to: "2026-10-18", canView: true, entries: vi.fn(), links: vi.fn(), accounts: vi.fn(), fallback: vi.fn(), excel: vi.fn(), toast: vi.fn(), refresh: undefined as (() => void) | undefined }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ tenant: { id: "t", name: "Test" }, hasPermission: () => state.canView }), useBranchFilter: () => ({ activeBranchId: state.branch, branchLabel: state.branch, branches: [{ id: "b", name: "Branch" }], isReady: true }), useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "custom", range: { from: state.from, to: state.to }, setPreset: vi.fn(), setCustomRange: vi.fn(), viewMode: "table", setViewMode: vi.fn() }) }));
vi.mock("@/lib/hooks/use-live-data-refresh", () => ({ useLiveDataRefresh: (callback: () => void) => { state.refresh = callback; } }));
vi.mock("@/lib/services/supabase/cash-book", () => ({ getAllCashBookEntries: state.entries }));
vi.mock("@/lib/services/supabase/management-finance", () => ({ getFinanceCashLinks: state.links }));
vi.mock("@/lib/services/supabase/cash-account-report", () => ({ getCashAccountReport: state.accounts }));
vi.mock("@/lib/services/supabase/analytics", () => ({ getCashFlowDetailed: state.fallback }));
vi.mock("@/lib/utils/excel-export", async original => ({ ...await original<typeof import("@/lib/utils/excel-export")>(), exportReportToExcel: state.excel }));
vi.mock("@/components/shared/report", () => ({
  ReportPageHeader: ({ onExportFull, onExportView, exportDisabled }: { onExportFull: () => void; onExportView: () => void; exportDisabled: boolean }) => <><button disabled={exportDisabled} onClick={onExportFull}>Xuất đầy đủ</button><button disabled={exportDisabled} onClick={onExportView}>Xuất hiện tại</button></>,
  ReportDataTable: ({ rows, columns, tablePreferenceKey, onSortChange }: { rows: { id?: string; code?: string }[]; columns: { cell?: (row: unknown) => React.ReactNode }[]; tablePreferenceKey: string; onSortChange: (sort: { id: string; direction: "asc" | "desc" }) => void }) => <div data-testid={tablePreferenceKey}>{rows.map((row, index) => <span key={row.id ?? index}>{columns[0].cell?.(row) ?? row.code}</span>)}{tablePreferenceKey.startsWith("report.cash-flow.receipt") && <button onClick={() => onSortChange({ id: "receipt", direction: "desc" })}>Sort amount</button>}</div>,
}));
import Page from "@/app/(main)/phan-tich/luong-tien/page";
const entry = (id: string, type: "receipt" | "payment", amount: number) => ({ id, code: id, type, amount, date: "2026-10-05", status: "completed", category: "customer_advance", branchId: "b", moneyAccountId: "cash", counterparty: "Khách", note: "Nội dung rõ", createdBy: "user" });
const register = { accounts: [{ id: "cash", branch_id: "b", branchName: "Branch", code: "TM", name: "Quỹ", kind: "cash", opening_balance: 50, receipts: 300, payments: 25, closing_balance: 325 }], failures: [], unassignedCount: 0 };
beforeEach(() => {
  window.history.replaceState(null, "", "/"); state.branch = "b"; state.from = "2026-10-01"; state.to = "2026-10-18"; state.canView = true;
  state.entries.mockReset().mockResolvedValue([entry("PT1", "receipt", 100), entry("PT2", "receipt", 200), entry("PC1", "payment", 25)]);
  state.links.mockReset().mockResolvedValue([]); state.accounts.mockReset().mockResolvedValue(register); state.excel.mockReset().mockResolvedValue(undefined); state.toast.mockReset(); state.fallback.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);
describe("cash capital report workflow", () => {
  it("exports the same filtered and sorted cash in separate receipt/payment sheets, with every full column", async () => {
    render(<Page />); await screen.findByText("PT1", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "Sort amount" }));
    await act(async () => screen.getByRole("button", { name: "Xuất đầy đủ" }).click());
    const sheets = state.excel.mock.calls[0][0].sheets;
    const receipts = sheets.find((sheet: { name: string }) => sheet.name === "Phiếu thu"), payments = sheets.find((sheet: { name: string }) => sheet.name === "Phiếu chi");
    expect(receipts.rows.map((row: { code: string }) => row.code)).toEqual(["PT2", "PT1"]); expect(payments.rows.map((row: { code: string }) => row.code)).toEqual(["PC1"]);
    expect(receipts.columns).toHaveLength(19); expect(receipts.tablePreferenceKey).toBeUndefined();
    expect(sheets.find((sheet: { name: string }) => sheet.name === "Quỹ và tài khoản").columns).toHaveLength(14);
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm chứng từ thu chi" }), { target: { value: "PT1" } });
    await act(async () => screen.getByRole("button", { name: "Xuất hiện tại" }).click());
    const view = state.excel.mock.calls[1][0].sheets.find((sheet: { name: string }) => sheet.name === "Phiếu thu");
    expect(view.rows).toHaveLength(1); expect(view.tablePreferenceKey).toBe("report.cash-flow.receipt");
    expect(state.entries).toHaveBeenCalledTimes(1);
  });
  it("separates receipt and payment screens without hiding payment history from full exports", async () => {
    render(<Page />); await screen.findByText("PT1", { exact: true }); expect(screen.queryByText("PC1", { exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Phiếu chi (1)" })); expect(await screen.findByText("PC1", { exact: true })).toBeInTheDocument(); expect(screen.queryByText("PT1", { exact: true })).not.toBeInTheDocument();
  });
  it("keeps register balances independent from movement filters", async () => {
    render(<Page />); await screen.findByText("PT1", { exact: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm chứng từ thu chi" }), { target: { value: "PT1" } });
    await act(async () => screen.getByRole("button", { name: "Xuất đầy đủ" }).click());
    const sheets = state.excel.mock.calls[0][0].sheets;
    expect(sheets.find((sheet: { name: string }) => sheet.name === "Thu chi theo tháng").footer.net).toBe(100);
    expect(sheets.find((sheet: { name: string }) => sheet.name === "Quỹ và tài khoản").rows[0].closing_balance).toBe(325);
  });
  it.each(["branch", "period"])("never displays or exports old data while changing %s", async change => {
    const view = render(<Page />); await screen.findByText("PT1", { exact: true }); state.entries.mockImplementation(() => new Promise(() => {}));
    if (change === "branch") state.branch = "other"; else state.from = "2026-09-01"; view.rerender(<Page />);
    expect(screen.queryByText("PT1", { exact: true })).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeDisabled();
  });
  it("does not turn a failed cash source into a healthy zero", async () => {
    state.entries.mockRejectedValue(new Error("Cash read failed")); render(<Page />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Cash read failed"); expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeDisabled(); expect(screen.queryByText("Thu trong kỳ", { exact: true })).not.toBeInTheDocument();
  });
  it("preserves visible cash when an account branch fails, but leaves global balance unknown", async () => {
    state.accounts.mockResolvedValue({ accounts: [], failures: [{ branchId: "b", branchName: "Branch", message: "Read denied" }], unassignedCount: 0 }); render(<Page />);
    await screen.findByText("PT1", { exact: true }); expect(screen.getByRole("alert")).toHaveTextContent("Read denied"); expect(screen.getAllByText("Chưa đủ dữ liệu").length).toBeGreaterThan(0);
  });
  it("does not call finance detail or money account sources without the existing permission", async () => {
    state.canView = false; render(<Page />); await waitFor(() => expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeEnabled());
    expect(state.fallback).toHaveBeenCalledWith(6, "b", { from: "2026-10-01", to: "2026-10-18" }); expect(state.entries).not.toHaveBeenCalled(); expect(state.accounts).not.toHaveBeenCalled(); expect(screen.queryByRole("textbox", { name: "Tìm chứng từ thu chi" })).not.toBeInTheDocument();
  });
  it("refreshes live data and reports export failure without a success toast", async () => {
    render(<Page />); await screen.findByText("PT1", { exact: true }); state.entries.mockResolvedValueOnce([entry("Fresh", "receipt", 300), entry("PC1", "payment", 25)]);
    await act(async () => state.refresh?.()); expect(await screen.findByText("Fresh", { exact: true })).toBeInTheDocument();
    state.excel.mockRejectedValueOnce(new Error("Download failed")); await act(async () => screen.getByRole("button", { name: "Xuất đầy đủ" }).click());
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" })); expect(state.toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });
  it("exports only the selected analysis in view mode and all analyses in full mode", async () => {
    render(<Page />); await screen.findByText("PT1", { exact: true }); fireEvent.click(screen.getByRole("tab", { name: "Khoản mục" }));
    await act(async () => screen.getByRole("button", { name: "Xuất hiện tại" }).click());
    expect(state.excel.mock.calls[0][0].sheets.map((sheet: { name: string }) => sheet.name)).toEqual(["Thu chi theo khoản mục", "Quỹ và tài khoản", "Phiếu thu"]);
  });
  it("updates an open voucher from refreshed rows and closes it when the voucher leaves the report", async () => {
    render(<Page />); await screen.findByText("PT1", { exact: true }); fireEvent.click(screen.getByRole("button", { name: "PT1" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("100");
    state.entries.mockResolvedValueOnce([entry("PT1", "receipt", 500)]); await act(async () => state.refresh?.());
    expect(screen.getByRole("dialog")).toHaveTextContent("500");
    state.entries.mockResolvedValueOnce([]); await act(async () => state.refresh?.());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
