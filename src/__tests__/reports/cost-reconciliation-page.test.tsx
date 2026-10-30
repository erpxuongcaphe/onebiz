import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ read: vi.fn(), excel: vi.fn(), allowed: true, branch: "branch-a", range: { from: "2026-10-01", to: "2026-10-30" },
  permissions: ["reports.analytics", "reports.view_detail", "reports.view_profit", "products.view_cost", "reports.export", "reports.export_detail"] }));
const hasPermission = (permission: string) => state.allowed && state.permissions.includes(permission);
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ tenant: { id: "tenant-1" }, user: { id: "user-1" }, permissions: state.permissions, hasPermission, isLoading: false }),
  useBranchFilter: () => ({ activeBranchId: state.branch, branchLabel: state.branch, isReady: true }), useToast: () => ({ toast: () => {} }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "thisMonth", range: state.range, setPreset: () => {}, setCustomRange: () => {} }) }));
vi.mock("@/lib/hooks/use-live-data-refresh", () => ({ useLiveDataRefresh: () => {} }));
vi.mock("@/lib/services/supabase/cost-reconciliation", () => ({ getCostReconciliation: state.read }));
vi.mock("@/lib/utils/excel-export", () => ({ exportReportToExcel: state.excel }));
vi.mock("@/components/shared/report", () => ({
  ReportPageHeader: ({ onExportView, onExportFull, exportDisabled }: { onExportView: () => void; onExportFull: () => void; exportDisabled: boolean }) => <><h1>Đối soát giá vốn</h1><button disabled={exportDisabled} onClick={onExportView}>View</button><button disabled={exportDisabled} onClick={onExportFull}>Full</button></>,
  ReportDataTable: ({ rows }: { rows: { id: string; code: string }[] }) => <div data-testid="table">{rows.map(row => <span key={row.id}>{row.code}</span>)}</div>,
}));
import Page from "@/app/(main)/phan-tich/doi-soat-gia-von/page";
const row = { id: "line-1", invoiceId: "bill-1", invoiceCode: "HD-TEST-01", issuedAt: "2026-10-27T10:00:00Z", branchId: "branch-a", branchName: "Chi nhánh A", productId: "product-1", code: "SKU-TEST-A", name: "Cà phê", quantity: 2, unit: "Ly", transactionQuantity: null, transactionUnit: null, conversionFactor: null, storedUnitCost: null, candidateUnitCost: 0, status: "ready" as const, evidence: { mode: "historical_component_match" as const, eventCount: 2, hasReturns: false, lastAttemptAt: null }, pendingComponents: [] };
const result = { rows: [row, { ...row, id: "line-2", productId: "product-2", code: "SKU-TEST-B", name: "Sữa", unit: "Hộp", status: "waiting" as const, candidateUnitCost: null }], revision: "rev-1", checkedAt: "2026-10-30T01:00:00Z" };
beforeEach(() => { vi.clearAllMocks(); state.allowed = true; state.branch = "branch-a"; window.history.replaceState({}, "", "/"); state.read.mockResolvedValue(result); });
afterEach(cleanup);
describe("cost reconciliation review-only screen", () => {
  it("shows loaded counts, scoped rows and exact filtered exports without a repair action", async () => {
    render(<Page />); await waitFor(() => expect(screen.getByTestId("table")).toHaveTextContent("SKU-TEST-A"));
    expect(screen.queryByRole("button", { name: /Khôi phục ngay|Ghi điều chỉnh|Xác nhận sửa/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Có thể khôi phục/ }));
    expect(screen.getByTestId("table")).not.toHaveTextContent("SKU-TEST-B");
    fireEvent.click(screen.getByRole("button", { name: "Full" }));
    await waitFor(() => expect(state.excel).toHaveBeenCalledOnce());
    expect(state.excel.mock.calls[0][0].sheets[0].rows).toHaveLength(1);
    expect(state.excel.mock.calls[0][0].sheets[0].rows[0].candidateUnitCost).toBe(0);
    expect(state.excel.mock.calls[0][0].sheets[1].rows.find((x: { status: string }) => x.status === "ready")).toMatchObject({ invoices: 1, lines: 1 });
  });
  it("does not query or expose cached values after permission loss", async () => {
    const view = render(<Page />); await waitFor(() => expect(screen.getByTestId("table")).toHaveTextContent("SKU-TEST-A"));
    const count = state.read.mock.calls.length; state.allowed = false; view.rerender(<Page />);
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa được cấp quyền"); expect(screen.queryByText("SKU-TEST-A")).not.toBeInTheDocument();
    expect(state.read).toHaveBeenCalledTimes(count);
  });
  it("hides old branch data and ignores late old-scope responses", async () => {
    let finish!: (value: typeof result) => void; state.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(<Page />); state.branch = "branch-b"; state.read.mockResolvedValue({ ...result, rows: [] }); view.rerender(<Page />);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument()); finish(result);
    await waitFor(() => expect(screen.getByTestId("table")).not.toHaveTextContent("SKU-TEST-A"));
    expect(state.read).toHaveBeenLastCalledWith(state.range, "branch-b");
  });
  it("shows source errors rather than a misleading empty report and blocks export", async () => {
    state.read.mockRejectedValue(new Error("Nguồn đối soát chưa phát hành")); render(<Page />);
    await screen.findByRole("alert"); expect(screen.getByRole("button", { name: "Full" })).toBeDisabled();
    expect(screen.queryByTestId("table")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Thử lại" })).toBeEnabled();
  });
});
