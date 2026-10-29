import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import * as XLSX from "xlsx-js-style";
const state = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), toast: vi.fn(), range: { from: "2026-10-29", to: "2026-10-29" } }));
vi.mock("file-saver", () => ({ saveAs: state.save }));
vi.mock("@/lib/contexts", () => ({ useBranchFilter: () => ({ activeBranchId: "b", isReady: true, branches: [{ id: "b", name: "Fixture branch" }] }), useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "today", range: state.range, setPreset: () => {}, setCustomRange: () => {} }) }));
vi.mock("@/lib/services/supabase/inventory-check-report", () => ({ getInventoryCheckReport: state.load }));
vi.mock("@/app/(main)/phan-tich/_components", () => ({ KpiCard: () => null }));
vi.mock("@/components/shared/report", () => ({
  ReportPageHeader: ({ onExportFull, onExportView }: { onExportFull: () => void; onExportView: () => void }) => <header><button onClick={onExportFull}>Full export fixture</button><button onClick={onExportView}>View export fixture</button></header>,
  ReportDataTable: ({ columns, rows, subtotalLabel }: { columns: { key: string; label: string; cell?: (row: Record<string, unknown>) => ReactNode }[]; rows: Record<string, unknown>[]; subtotalLabel: string }) => <><p>{subtotalLabel}</p><table><thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={String(row.id)}>{columns.map(column => <td key={column.key}>{column.cell ? column.cell(row) : String(row[column.key] ?? "")}</td>)}</tr>)}</tbody></table></>,
}));
import Page from "@/app/(main)/phan-tich/kiem-ke/page";
const detail = { id: "i1", checkId: "c", checkCode: "KK-1", checkDate: "2026-10-29", branchName: "Fixture branch", productId: "p1", productName: "Fixture cups", productCode: "SKU-CUP", systemStock: 100, actualStock: 103, difference: 3, recordedUnit: "Cái", catalogUnit: "Cái", currentConversion: "1 Cây = 50 Cái", recordedCount: "2 Cây + 3 Cái" };
beforeEach(() => {
  state.save.mockClear(); state.load.mockReset();
  state.load.mockResolvedValue({ range: { from: "2026-10-29", to: "2026-10-29" }, summary: { totalChecks: 1, totalIncrease: 10, totalDecrease: 0, netImpact: 10, prevTotalChecks: 0, prevTotalIncrease: 0, prevTotalDecrease: 0, prevNetImpact: 0 }, rows: [{ id: "c", code: "KK-1", date: "2026-10-29", branchName: "Fixture branch", createdByName: "Fixture", status: "balanced", totalProducts: 2, totalIncrease: 10, totalDecrease: 0, netImpact: 10 }], details: [detail, { ...detail, id: "i2", productId: "p2", productCode: "SKU-OLD", productName: "Fixture legacy material", recordedUnit: null, catalogUnit: "Kg", currentConversion: "Chưa có quy đổi phụ", recordedCount: null, actualStock: 100, difference: 0 }] });
});
afterEach(cleanup);
it("opens item detail with units, package rules, original count and explicit historical gaps", async () => {
  render(<Page />); await screen.findByText("SKU-CUP");
  expect(screen.getByRole("tab", { name: "Chi tiết mặt hàng" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("1 Cây = 50 Cái")).toBeInTheDocument();
  expect(screen.getByText("2 Cây + 3 Cái")).toBeInTheDocument();
  expect(screen.getByText("Chưa lưu ĐVT")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "ĐVT danh mục" }), { target: { value: "Cái" } });
  expect(screen.queryByText("SKU-OLD")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Theo phiếu" }));
  expect(screen.getByText("Số sản phẩm")).toBeInTheDocument();
});
it("reopens the real full workbook with unit columns and filtered lines, without a mixed-unit quantity total", async () => {
  render(<Page />); await screen.findByText("SKU-CUP");
  fireEvent.change(screen.getByRole("combobox", { name: "ĐVT danh mục" }), { target: { value: "Cái" } });
  fireEvent.click(screen.getByRole("button", { name: "Full export fixture" }));
  await waitFor(() => expect(state.save).toHaveBeenCalled());
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(state.save.mock.calls[0][0]); });
  const book = XLSX.read(buffer, { type: "array" });
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Chi tiết mặt hàng"], { header: 1, defval: null });
  const index = matrix.findIndex(row => row[0] === "Mã phiếu");
  const header = matrix[index];
  expect(header).toContain("ĐVT ghi sổ"); expect(header).toContain("ĐVT danh mục hiện tại"); expect(header).toContain("Quy cách hiện tại");
  const data = matrix[index + 1];
  expect(data[header.indexOf("Thực kiểm theo ĐVT nhập")]).toBe("2 Cây + 3 Cái");
  expect(data[header.indexOf("Thực tế")]).toBe(103);
  expect(matrix.flat()).not.toContain("SKU-OLD");
  expect(matrix.slice(index + 2).some(row => typeof row[header.indexOf("Thực tế")] === "number")).toBe(false);
});
it("does not leave the prior report visible when loading fails", async () => {
  state.load.mockRejectedValue(new Error("Fixture source unavailable"));
  render(<Page />); expect(await screen.findByRole("alert")).toHaveTextContent("Fixture source unavailable");
  expect(screen.queryByText("SKU-CUP")).toBeNull();
});
