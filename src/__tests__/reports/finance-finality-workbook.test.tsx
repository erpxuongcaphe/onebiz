import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as XLSX from "xlsx-js-style";
const state = vi.hoisted(() => ({ save: vi.fn(), finance: vi.fn(), range: { from: "2026-10-01", to: "2026-10-01" } }));
vi.mock("file-saver", () => ({ saveAs: state.save }));
vi.mock("@/lib/contexts", () => ({ useBranchFilter: () => ({ activeBranchId: "fixture", branchLabel: "Fixture", isReady: true }),
  useAuth: () => ({ tenant: { name: "Fixture" } }), useToast: () => ({ toast: () => {} }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "today", range: state.range,
  setPreset: () => {}, setCustomRange: () => {}, viewMode: "table", setViewMode: () => {} }) }));
vi.mock("@/lib/services", () => ({ getFinanceDashboardReport: state.finance, getCashFlow: async () => [] }));
vi.mock("@/components/shared/report", () => ({
  ReportPageHeader: ({ onExportView, onExportFull }: { onExportView: () => void; onExportFull: () => void }) => <><button onClick={onExportView}>View</button><button onClick={onExportFull}>Full</button></>,
  ReportDataTable: () => null, ReportTableFrame: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/(main)/phan-tich/_components", () => ({ KpiCard: () => null, ChartCard: ({ children }: { children: React.ReactNode }) => children }));
import Page from "@/app/(main)/phan-tich/tai-chinh/page";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
async function reopen(blob: Blob) {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
  return XLSX.read(buffer, { type: "array" });
}
it.each(["View", "Full"])("reopens the actual %s workbook without false zeros, percentages or profit totals", async mode => {
  state.finance.mockResolvedValue({ kpis: { revenue: 1000, prevRevenue: 800, otherIncome: 20, prevOtherIncome: 0,
    expense: null, prevExpense: 300, profit: null, prevProfit: 500, profitMargin: null, prevProfitMargin: 62.5,
    cogsComplete: false, prevCogsComplete: true, missingCostLines: 2, prevMissingCostLines: 0 },
  trend: [{ label: "01/10", revenue: 1000, cogs: null, operatingExpense: 100, otherIncome: 20, expense: null, profit: null, missingCostLines: 2 }],
  expenseBreakdown: [{ name: "Giá vốn hàng bán", value: null }, { name: "Rent", value: 100 }] });
  render(<Page />); await screen.findByText("Chưa đủ giá vốn");
  fireEvent.click(screen.getByRole("button", { name: mode }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  const book = await reopen(state.save.mock.calls[0][0]);
  const matrix = (name: string) => XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: null });
  const summary = matrix(mode === "Full" ? "P&L kỳ này" : "KPI tài chính");
  const profit = summary.find(row => row.includes(mode === "Full" ? "LỢI NHUẬN HOẠT ĐỘNG" : "Lợi nhuận"))!;
  expect(profit[mode === "Full" ? 2 : 1]).toBe("");
  expect(summary.flat().some(value => String(value).includes("không phải 0"))).toBe(true);
  const trend = matrix(mode === "Full" ? "Xu hướng theo kỳ" : "Kết quả theo kỳ");
  const headerIndex = trend.findIndex(row => row.includes("Dòng chưa đủ giá vốn"));
  const header = trend[headerIndex], row = trend[headerIndex + 1];
  expect(row[header.findIndex(value => String(value).startsWith("Giá vốn"))]).toBe("");
  expect(row[header.findIndex(value => String(value).startsWith("Lợi nhuận"))]).toBe("");
  expect(row[header.indexOf("Dòng chưa đủ giá vốn")]).toBe(2);
  if (mode === "Full") {
    const expense = matrix("Cơ cấu chi phí");
    const unknown = expense.find(row => row.includes("Giá vốn hàng bán"))!;
    expect(unknown[2]).toBe(""); expect(unknown[3]).toBe("");
    expect(expense.find(row => row.includes("TỔNG CHI PHÍ"))?.[2]).toBe("");
  }
});
