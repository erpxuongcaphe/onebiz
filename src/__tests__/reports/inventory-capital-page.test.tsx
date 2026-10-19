import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ branch: "fnb", range: { from: "2026-10-01", to: "2026-10-18" }, get: vi.fn(), excel: vi.fn(), toast: vi.fn(), refresh: undefined as (() => void) | undefined }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ tenant: { id: "t" } }), useBranchFilter: () => ({ activeBranchId: state.branch, isReady: true, branches: [{ id: state.branch, name: state.branch }] }), useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "custom", range: state.range, setPreset: vi.fn(), setCustomRange: vi.fn() }) }));
vi.mock("@/lib/hooks/use-live-data-refresh", () => ({ useLiveDataRefresh: (callback: () => void) => { state.refresh = callback; } }));
vi.mock("@/lib/hooks/use-product-uom", () => ({ useProductUom: () => ({ map: new Map() }) }));
vi.mock("@/lib/services", () => ({ getXntReport: state.get }));
vi.mock("@/lib/utils/excel-export", async original => ({ ...await original<typeof import("@/lib/utils/excel-export")>(), exportReportToExcel: state.excel }));
vi.mock("@/components/shared/report", () => ({ ReportPageHeader: ({ onExportFull, exportDisabled }: { onExportFull: () => void; exportDisabled: boolean }) => <button disabled={exportDisabled} onClick={onExportFull}>Xuất đầy đủ</button>, ReportDataTable: ({ rows }: { rows: { code: string }[] }) => <div>{rows.map(row => <span key={row.code}>{row.code}</span>)}</div> }));
vi.mock("@/components/shared/report/inventory-capital-review", () => ({ InventoryCapitalReview: () => <div>Vốn tồn</div> }));
import Page from "@/app/(main)/phan-tich/xuat-nhap-ton/page";
import type { XntRow } from "@/lib/services/supabase/xnt-report";
const row = (code: string, totalOut: number): XntRow => ({ productId: code, code, name: code, unit: "G", categoryName: "Tea", openingQty: 10, openingValue: 100, totalIn: 0, inValue: 0, totalOut, outValue: totalOut * 10, closingQty: 10 - totalOut, closingValue: (10 - totalOut) * 10, inSupplier: 0, inCheck: 0, inReturn: 0, inTransfer: 0, inProduction: 0, inOther: 0, outSale: totalOut, outDisposal: 0, outSupplierReturn: 0, outCheck: 0, outTransfer: 0, outProduction: 0, outInternal: 0, outOther: 0, valuedMovementCount: 1, missingCostMovementCount: 0, valuationComplete: true });
const result = { rows: [row("A", 0), row("B", 2)] };
beforeEach(() => { state.branch = "fnb"; state.get.mockReset().mockResolvedValue(result); state.excel.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);
describe("inventory capital workspace", () => {
  it("exports the same review filter in every detail and capital sheet", async () => {
    render(<Page />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeEnabled());
    fireEvent.change(screen.getByRole("combobox", { name: "Kiểm tra vốn tồn kho" }), { target: { value: "noOut" } });
    await act(async () => screen.getByRole("button", { name: "Xuất đầy đủ" }).click());
    const file = state.excel.mock.calls[0][0];
    expect(file.sheets.find((sheet: { name: string }) => sheet.name === "Kiểm soát vốn tồn").rows.map((r: { code: string }) => r.code)).toEqual(["A"]);
    expect(file.sheets.find((sheet: { name: string }) => sheet.name === "Vốn tồn theo nhóm").rows[0]).toMatchObject({ products: 1, closingValue: 100, noOut: 1 });
    expect(file.sheets.find((sheet: { name: string }) => sheet.name === "1. Tổng hợp").rows.map((r: { code: string }) => r.code)).toEqual(["A"]);
  });
  it("never shows old-scope rows or enables export while switching branch", async () => {
    const view = render(<Page />);
    await waitFor(() => expect(screen.getByText("A", { exact: true })).toBeInTheDocument());
    state.get.mockImplementation(() => new Promise(() => {}));
    state.branch = "retail"; view.rerender(<Page />);
    expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeDisabled();
    expect(screen.queryByText("A", { exact: true })).not.toBeInTheDocument();
  });
  it("refreshes from the existing live signal without inventing stock values", async () => {
    render(<Page />);
    await waitFor(() => expect(screen.getByText("A", { exact: true })).toBeInTheDocument());
    state.get.mockResolvedValueOnce({ rows: [row("Fresh", 0)] });
    await act(async () => state.refresh?.());
    expect(await screen.findByText("Fresh", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("A", { exact: true })).not.toBeInTheDocument();
  });
});
