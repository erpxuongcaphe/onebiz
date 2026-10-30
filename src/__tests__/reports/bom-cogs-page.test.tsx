import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ read: vi.fn(), excel: vi.fn(), branch: "a", allowed: true, exportAllowed: true }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ tenant: { id: "tenant" }, user: { id: "user" }, permissions: [], isLoading: false, hasPermission: (key: string) => state.allowed && (!key.startsWith("reports.export") || state.exportAllowed) }),
  useBranchFilter: () => ({ activeBranchId: state.branch, branchLabel: state.branch, isReady: true }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "thisMonth", range: { from: "2026-10-01", to: "2026-10-30" }, setPreset: () => {}, setCustomRange: () => {} }) }));
vi.mock("@/lib/services", () => ({ getCogsByBom: state.read }));
vi.mock("@/lib/utils/excel-export", () => ({ buildReportTitleRows: () => [], exportReportToExcel: state.excel }));
vi.mock("@/components/shared/report", () => ({ ReportPageHeader: ({ onExportFull, exportDisabled }: { onExportFull: () => void; exportDisabled: boolean }) => <button disabled={exportDisabled} onClick={onExportFull}>Full</button>,
  ReportDataTable: ({ rows }: { rows: { productCode: string; recordedUnit: string; unitReference: string }[] }) => <div data-testid="rows">{rows.map(row => <p key={row.productCode}>{row.productCode} {row.recordedUnit} {row.unitReference}</p>)}</div> }));
import Page from "@/app/(main)/phan-tich/cogs-theo-bom/page";
const row = { invoiceId: "bill", invoiceCode: "HD001", invoiceDate: "2026-10-01T00:00:00Z", branchId: "a", branchName: "A", productId: "p1", productCode: "SKU-1", productName: "Xưởng Cốt Dừa", qtySold: 2, revenue: 70000, cogsReal: null, margin: null, catalogUnit: "Ly" };
beforeEach(() => { vi.clearAllMocks(); state.branch = "a"; state.allowed = true; state.exportAllowed = true; state.read.mockResolvedValue([row]); state.excel.mockResolvedValue(undefined); });
afterEach(cleanup);
it("exports the same middle-name filtered rows with historical and current unit labels", async () => {
  render(<Page />); await screen.findByText(/SKU-1/);
  fireEvent.change(screen.getByRole("textbox", { name: "Tìm hóa đơn hoặc mặt hàng" }), { target: { value: "cot dua" } });
  expect(screen.getByTestId("rows")).toHaveTextContent("Chưa có ĐVT lịch sử Ly");
  fireEvent.click(screen.getByRole("button", { name: "Full" }));
  await waitFor(() => expect(state.excel).toHaveBeenCalledOnce());
  const detail = state.excel.mock.calls[0][0].sheets[1];
  expect(detail.rows).toHaveLength(1); expect(detail.rows[0].qtySold).toBe(2);
  expect(detail.tablePreferenceKey).toBeUndefined(); expect(detail.footer.cogsReal).toBeNull();
});
it("clears cached rows immediately when branch changes and ignores a late old response", async () => {
  let finish!: (rows: typeof row[]) => void;
  state.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(<Page />); state.branch = "b"; state.read.mockResolvedValue([]); view.rerender(<Page />);
  await waitFor(() => expect(state.read).toHaveBeenCalledTimes(2));
  await act(async () => finish([row]));
  expect(screen.getByTestId("rows")).not.toHaveTextContent("SKU-1");
});
it("hides existing rows and does not read after report permission is removed", async () => {
  const view = render(<Page />); await screen.findByText(/SKU-1/);
  state.allowed = false; view.rerender(<Page />);
  expect(screen.getByRole("alert")).toHaveTextContent("Chưa được cấp quyền");
  expect(screen.queryByText(/SKU-1/)).not.toBeInTheDocument(); expect(state.read).toHaveBeenCalledOnce();
});
it("retains source failure as an explicit error and supports retry without stale export", async () => {
  state.read.mockRejectedValueOnce(new Error("Nguồn chưa sẵn sàng")); render(<Page />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Nguồn chưa sẵn sàng");
  expect(screen.getByRole("button", { name: "Full" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Thử lại" })); await screen.findByText(/SKU-1/);
});
it("does not export without the separate detail export permission", async () => {
  state.exportAllowed = false; render(<Page />); await screen.findByText(/SKU-1/);
  fireEvent.click(screen.getByRole("button", { name: "Full" })); expect(state.excel).not.toHaveBeenCalled();
});
it("cancels a delayed download after a filter changes", async () => {
  let canSave!: () => boolean;
  state.excel.mockImplementationOnce(async (options: { shouldSave: () => boolean }) => { canSave = options.shouldSave; });
  render(<Page />); await screen.findByText(/SKU-1/); fireEvent.click(screen.getByRole("button", { name: "Full" }));
  await waitFor(() => expect(canSave).toBeTypeOf("function"));
  expect(canSave()).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Tìm hóa đơn hoặc mặt hàng" }), { target: { value: "khong co" } });
  expect(canSave()).toBe(false);
});
