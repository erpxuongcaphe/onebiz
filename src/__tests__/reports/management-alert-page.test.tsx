import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ branch: "alpha", load: vi.fn(), export: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useBranchFilter: () => ({ activeBranchId: state.branch, branchLabel: state.branch, isReady: true }), useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/services", () => ({ getFinancialAlerts: state.load }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "today", range: { from: "2026-10-29", to: "2026-10-29" }, setPreset: vi.fn(), setCustomRange: vi.fn() }) }));
vi.mock("@/components/shared/report", () => ({ ReportPageHeader: ({ onExportFull }: { onExportFull: () => void }) => <button onClick={onExportFull}>Export fixture</button> }));
vi.mock("@/lib/utils/excel-export", () => ({ exportReportToExcel: state.export, buildReportTitleRows: () => [], buildMetricSummarySheet: (value: unknown) => value }));
import Page from "@/app/(main)/phan-tich/canh-bao/page";
const alert = (title: string, type = "low_stock") => ({ id: title, title, type, severity: "warning", value: 2, description: title, link: "/" });
beforeEach(() => { state.branch = "alpha"; state.load.mockReset(); state.export.mockReset(); });
afterEach(cleanup);
it("discards a late response from the previous branch", async () => {
  let resolveOld!: (value: unknown) => void;
  state.load.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce([alert("Beta alert")]);
  const view = render(<Page />);
  state.branch = "beta"; view.rerender(<Page />);
  await screen.findAllByText("Beta alert");
  await act(async () => { resolveOld([alert("Stale alpha")]); });
  expect(screen.queryByText("Stale alpha")).toBeNull();
});
it("shows a source failure and retries instead of claiming no alerts", async () => {
  state.load.mockRejectedValueOnce(new Error("SOURCE_UNAVAILABLE")).mockResolvedValueOnce([alert("Recovered")]);
  render(<Page />);
  expect(await screen.findByRole("alert")).toHaveTextContent("SOURCE_UNAVAILABLE");
  fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
  await screen.findAllByText("Recovered");
});
it("exports units separately without adding currency, counts and percentages", async () => {
  state.load.mockResolvedValue([alert("Stock"), alert("Lots", "expiring_lot"), alert("Ratio", "high_expense"), alert("Debt", "overdue_debt")]);
  render(<Page />);
  fireEvent.click(await screen.findByRole("button", { name: "Export fixture" }));
  await waitFor(() => expect(state.export).toHaveBeenCalled());
  const [summary, detail] = state.export.mock.calls[0][0].sheets;
  expect(summary.metrics.some((metric: { label: string }) => metric.label === "Tổng giá trị liên quan")).toBe(false);
  expect(detail.rows.map((row: { unit: string }) => row.unit)).toEqual(["Mặt hàng", "Lô", "%", "VND"]);
  expect(detail.footer).not.toHaveProperty("amount");
});
