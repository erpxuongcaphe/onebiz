import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ read: vi.fn(), excel: vi.fn(), branch: "a", allowed: true, exportAllowed: true,
  range: { from: "2026-10-01", to: "2026-10-29" } }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ tenant: { id: "tenant" }, user: { id: "user" }, permissions: [], isLoading: false,
  hasPermission: (key: string) => state.allowed && (!key.startsWith("reports.export") || state.exportAllowed) }),
  useBranchFilter: () => ({ activeBranchId: state.branch, branches: [], isReady: true }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "thisMonth", range: state.range, setPreset: () => {}, setCustomRange: () => {} }) }));
vi.mock("@/lib/services/supabase/abc-analysis", () => ({ getAbcReport: state.read }));
vi.mock("@/lib/utils/excel-export", () => ({ buildReportTitleRows: () => [], exportReportToExcel: state.excel }));
vi.mock("@/components/shared/report", () => ({ ReportPageHeader: ({ onExportFull, exportDisabled }: { onExportFull?: () => void; exportDisabled: boolean }) => <button disabled={exportDisabled || !onExportFull} onClick={onExportFull}>Full</button>,
  ReportDataTable: ({ rows }: { rows: { code: string }[] }) => <div data-testid="rows">{rows.map(row => <p key={row.code}>{row.code}</p>)}</div> }));
import Page from "@/app/(main)/phan-tich/abc-analysis/page";
import { buildAbcReport } from "@/lib/reports/abc-model";
const report = buildAbcReport([], [
  { product_id: "a", product_name: "Xưởng Cốt Dừa", unit: "Ly", quantity: 2, total: 80, invoices: { ngay_chung_tu: "2026-10-10" } },
  { product_id: "b", product_name: "Cà phê", unit: "Ly", quantity: 1, total: 20, invoices: { ngay_chung_tu: "2026-10-10" } },
], state.range);
beforeEach(() => { vi.clearAllMocks(); state.branch = "a"; state.allowed = true; state.exportAllowed = true; state.read.mockResolvedValue(report); state.excel.mockResolvedValue(undefined); });
afterEach(cleanup);
it("filters middle-name accentless search and exports aligned detail and summary", async () => {
  render(<Page />); await screen.findByTestId("rows");
  fireEvent.change(screen.getByRole("textbox", { name: "Tìm mặt hàng" }), { target: { value: "cot dua" } });
  expect(screen.getByTestId("rows")).toHaveTextContent("a"); expect(screen.getByTestId("rows")).not.toHaveTextContent("b");
  fireEvent.click(screen.getByRole("button", { name: "Full" }));
  await waitFor(() => expect(state.excel).toHaveBeenCalledOnce());
  const sheets = state.excel.mock.calls[0][0].sheets;
  expect(sheets[0].footer).toMatchObject({ count: 1, revenue: 80, pct: 80 });
  expect(sheets[1].rows).toHaveLength(1); expect(sheets[2].rows).toHaveLength(0);
  expect(sheets[1].rows[0]).toMatchObject({ unit: "Ly", qtySold: 2 });
});
it("does not retain old-branch rows after a late response", async () => {
  let finish!: (result: typeof report) => void;
  state.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(<Page />); state.branch = "b"; state.read.mockResolvedValue({ ...report, rows: [] }); view.rerender(<Page />);
  await waitFor(() => expect(state.read).toHaveBeenCalledTimes(2)); await act(async () => finish(report));
  expect(screen.getByTestId("rows")).toBeEmptyDOMElement();
});
it("removes cached results on permission revocation", async () => {
  const view = render(<Page />); await screen.findByTestId("rows"); state.allowed = false; view.rerender(<Page />);
  expect(screen.getByRole("alert")).toHaveTextContent("Chưa được cấp quyền"); expect(state.read).toHaveBeenCalledOnce();
});
it("shows a source error and retries rather than exporting old data", async () => {
  state.read.mockRejectedValueOnce(new Error("Nguồn lỗi")); render(<Page />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Nguồn lỗi"); expect(screen.getByRole("button", { name: "Full" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Thử lại" })); await screen.findByTestId("rows");
});
it("honors detail export permission", async () => {
  state.exportAllowed = false; render(<Page />); await screen.findByTestId("rows");
  expect(screen.getByRole("button", { name: "Full" })).toBeDisabled(); expect(state.excel).not.toHaveBeenCalled();
});
it("cancels delayed download when filters change", async () => {
  render(<Page />); await screen.findByTestId("rows"); fireEvent.click(screen.getByRole("button", { name: "Full" }));
  const canSave = state.excel.mock.calls[0][0].shouldSave;
  expect(canSave()).toBe(true); fireEvent.change(screen.getByRole("textbox", { name: "Tìm mặt hàng" }), { target: { value: "khac" } }); expect(canSave()).toBe(false);
});
