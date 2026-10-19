import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DebtWorkspace } from "@/lib/services/supabase/debt-workspace";
const state = vi.hoisted(() => ({ branch: "fnb", get: vi.fn(), excel: vi.fn(), toast: vi.fn(), refresh: undefined as (() => void) | undefined }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ tenant: { id: "t", name: "OneBiz" }, hasPermission: () => true }), useBranchFilter: () => ({ activeBranchId: state.branch, branchLabel: state.branch, isReady: true }), useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "custom", range: { from: "2026-10-01", to: "2026-10-18" }, setPreset: vi.fn(), setCustomRange: vi.fn() }) }));
vi.mock("@/lib/hooks/use-live-data-refresh", () => ({ useLiveDataRefresh: (callback: () => void) => { state.refresh = callback; } }));
vi.mock("@/lib/services/supabase/debt-workspace", () => ({ getDebtWorkspace: state.get }));
vi.mock("@/lib/utils/excel-export", () => ({ exportReportToExcel: state.excel }));
vi.mock("@/components/shared/dialogs/debt-detail-dialog", () => ({ DebtDetailDialog: () => <div>Chứng từ</div> }));
vi.mock("@/components/shared/report", () => ({
  ReportPageHeader: ({ onExportFull, onExportView, exportDisabled }: { onExportFull: () => void; onExportView: () => void; exportDisabled: boolean }) => <><button disabled={exportDisabled} onClick={onExportFull}>Xuất đầy đủ</button><button disabled={exportDisabled} onClick={onExportView}>Xuất hiện tại</button></>,
  ReportDataTable: ({ rows }: { rows: { id: string; code: string }[] }) => <div>{rows.map(row => <span key={row.id}>{row.code}</span>)}</div>,
}));
import Page from "@/app/(main)/phan-tich/cong-no-aging/page";
const party = (id: string, debt: number) => ({ id, code: id, name: id, debt, advance: 50, netBalance: debt - 50, documentCount: 1, ageDays: 45, bucket: "31–60", type: "customer" as const, ageBuckets: { bucket0_30: 0, bucket31_60: debt, bucket61_90: 0, bucket91Plus: 0 } });
const result = { generatedAt: "2026-10-19T01:00:00Z", receivables: [party("A", 100), party("B", 300)], payables: [party("NCC", 200)] } as DebtWorkspace;
beforeEach(() => {
  window.history.replaceState(null, "", "/"); state.branch = "fnb";
  state.get.mockReset().mockResolvedValue(result); state.excel.mockReset().mockResolvedValue(undefined); state.toast.mockReset();
});
afterEach(cleanup);
describe("debt capital report workflow", () => {
  it("uses the same strict source as the debt workspace and exports every column on both sides", async () => {
    render(<Page />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeEnabled());
    expect(state.get).toHaveBeenCalledWith("fnb", { requireBalanceSummary: true });
    await act(async () => screen.getByRole("button", { name: "Xuất đầy đủ" }).click());
    const file = state.excel.mock.calls[0][0];
    expect(file.range).toEqual({ from: "2026-10-19", to: "2026-10-19" });
    expect(file.sheets).toHaveLength(4);
    expect(file.sheets[1].rows.map((row: { code: string }) => row.code)).toEqual(["B", "A"]);
    expect(file.sheets[3].rows[0].code).toBe("NCC");
    expect(file.sheets[1].columns).toHaveLength(16);
    expect(file.sheets[1].tablePreferenceKey).toBeUndefined();
  });
  it("applies identical filters to full detail exports and preserves current-view preferences", async () => {
    render(<Page />);
    await screen.findByText("A", { exact: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm đối tác" }), { target: { value: "B" } });
    await act(async () => screen.getByRole("button", { name: "Xuất đầy đủ" }).click());
    expect(state.excel.mock.calls[0][0].sheets[1].rows.map((row: { code: string }) => row.code)).toEqual(["B"]);
    expect(state.excel.mock.calls[0][0].sheets[3].rows).toEqual([]);
    await act(async () => screen.getByRole("button", { name: "Xuất hiện tại" }).click());
    expect(state.excel.mock.calls[1][0].sheets[0].tablePreferenceKey).toBe("report.debt-aging.receivable");
  });
  it("hides old-scope rows and disables exports during branch changes", async () => {
    const view = render(<Page />); await screen.findByText("A", { exact: true });
    state.get.mockImplementation(() => new Promise(() => {})); state.branch = "retail"; view.rerender(<Page />);
    expect(screen.queryByText("A", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeDisabled();
  });
  it("shows source errors instead of empty healthy balances", async () => {
    state.get.mockRejectedValue(new Error("Chưa tải được nguồn tiền ứng")); render(<Page />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa tải được nguồn tiền ứng");
    expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeDisabled();
    expect(screen.queryByText("A", { exact: true })).not.toBeInTheDocument();
  });
  it("refreshes from live signals and never reports failed exports as successful", async () => {
    render(<Page />); await screen.findByText("A", { exact: true });
    state.get.mockResolvedValueOnce({ ...result, receivables: [party("Fresh", 400)] });
    await act(async () => state.refresh?.()); expect(await screen.findByText("Fresh", { exact: true })).toBeInTheDocument();
    state.excel.mockRejectedValueOnce(new Error("Download failed"));
    await act(async () => screen.getByRole("button", { name: "Xuất đầy đủ" }).click());
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    expect(state.toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });
});
