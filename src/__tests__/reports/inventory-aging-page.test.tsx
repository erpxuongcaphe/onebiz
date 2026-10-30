import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ read: vi.fn(), excel: vi.fn(), toast: vi.fn(), branch: "a", allowed: true, costAllowed: true, exportAllowed: true,
  range: { from: "2026-10-01", to: "2026-10-29" } }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ tenant: { id: "tenant" }, user: { id: "user" }, permissions: [], isLoading: false,
  hasPermission: (key: string) => state.allowed && (key !== "products.view_cost" || state.costAllowed) && (!key.startsWith("reports.export") || state.exportAllowed) }),
  useBranchFilter: () => ({ activeBranchId: state.branch, branchLabel: state.branch, isReady: true }), useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "thisMonth", range: state.range, viewMode: "table", setViewMode: () => {}, setPreset: () => {}, setCustomRange: () => {} }) }));
vi.mock("@/lib/services", () => ({ getInventoryAgingReport: state.read }));
vi.mock("@/lib/utils/excel-export", () => ({ buildInfoSheet: () => ({ name: "Info", columns: [], rows: [] }), exportReportToExcel: state.excel }));
vi.mock("@/components/shared/report", () => ({ ReportPageHeader: ({ onExportFull, exportDisabled }: { onExportFull?: () => void; exportDisabled: boolean }) => <button disabled={exportDisabled || !onExportFull} onClick={onExportFull}>Full</button>,
  ReportDataTable: ({ rows }: { rows: { code: string; reviewStatus: string }[] }) => <div data-testid="rows">{rows.map(row => <p key={row.code}>{row.code} {row.reviewStatus}</p>)}</div> }));
import Page from "@/app/(main)/phan-tich/aging/page";
const row = { productId: "p1", code: "SKU-1", name: "Xưởng Cốt Dừa", currentQty: 50, costPrice: 10, stockValue: 500, catalogUnit: "Cái", currentConversion: "1 Cây = 50 Cái",
  lastInDate: null, daysInStock: null, lastSaleDate: null, daysSinceLastSale: null, agingBucket: "unknown", isDeadStock: true };
const report = { generatedAt: "2026-10-28T18:00:00Z", tenantId: "tenant", branchId: "a", rows: [row, { ...row, productId: "p2", code: "SKU-2", name: "Ly giấy", stockValue: 100 }] };
beforeEach(() => { vi.clearAllMocks(); state.branch = "a"; state.allowed = true; state.costAllowed = true; state.exportAllowed = true; state.read.mockResolvedValue(report); state.excel.mockResolvedValue(undefined); });
afterEach(cleanup);
it("exports identical filtered snapshot detail and summary without zero-filling unknown days", async () => {
  render(<Page />); await waitFor(() => expect(screen.getByTestId("rows")).toHaveTextContent("SKU-1"));
  fireEvent.change(screen.getByRole("textbox", { name: "Tìm mặt hàng" }), { target: { value: "cot dua" } });
  fireEvent.click(screen.getByRole("button", { name: "Full" })); await waitFor(() => expect(state.excel).toHaveBeenCalledOnce());
  const options = state.excel.mock.calls[0][0];
  expect(options.range).toEqual({ from: "2026-10-29", to: "2026-10-29" });
  expect(options.sheets[1].footer).toMatchObject({ count: 1, value: 500 });
  expect(options.sheets[2].rows).toHaveLength(1); expect(options.sheets[2].rows[0]).toMatchObject({ daysInStock: null, reviewStatus: "Thiếu lịch sử", conversionLabel: "1 Cây = 50 Cái" });
  expect(options.sheets[3].rows).toHaveLength(0);
});
it("ignores a late old-branch response", async () => {
  let finish!: (value: typeof report) => void; state.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(<Page />); state.branch = "b"; state.read.mockResolvedValue({ ...report, rows: [] }); view.rerender(<Page />);
  await waitFor(() => expect(state.read).toHaveBeenCalledTimes(2)); await act(async () => finish(report)); expect(screen.getByTestId("rows")).toBeEmptyDOMElement();
});
it("does not read or expose this value-bearing legacy report without cost permission", async () => {
  state.costAllowed = false; render(<Page />); expect(screen.getByRole("alert")).toHaveTextContent("Chưa được cấp quyền"); expect(state.read).not.toHaveBeenCalled();
});
it("hides cached values when permission is revoked", async () => {
  const view = render(<Page />); await waitFor(() => expect(screen.getByTestId("rows")).toHaveTextContent("SKU-1"));
  state.allowed = false; view.rerender(<Page />); expect(screen.getByRole("alert")).toBeInTheDocument(); expect(screen.queryByTestId("rows")).not.toBeInTheDocument();
});
it("shows an explicit source error and supports retry", async () => {
  state.read.mockRejectedValueOnce(new Error("Nguồn không khớp")); render(<Page />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Nguồn không khớp"); expect(screen.getByRole("button", { name: "Full" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Thử lại" })); await waitFor(() => expect(screen.getByTestId("rows")).toHaveTextContent("SKU-1"));
});
it("cancels a pending export after filters change and reports export failure", async () => {
  let reject!: (reason: Error) => void; state.excel.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  render(<Page />); await waitFor(() => expect(screen.getByTestId("rows")).toHaveTextContent("SKU-1")); fireEvent.click(screen.getByRole("button", { name: "Full" }));
  const canSave = state.excel.mock.calls[0][0].shouldSave; expect(canSave()).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Tìm mặt hàng" }), { target: { value: "khac" } }); expect(canSave()).toBe(false);
  await act(async () => reject(new Error("Download failed"))); expect(screen.queryByText("Download failed")).not.toBeInTheDocument(); expect(state.toast).not.toHaveBeenCalled();
});
it("honors separate export permissions", async () => {
  state.exportAllowed = false; render(<Page />); await waitFor(() => expect(screen.getByTestId("rows")).toHaveTextContent("SKU-1")); expect(screen.getByRole("button", { name: "Full" })).toBeDisabled();
});
