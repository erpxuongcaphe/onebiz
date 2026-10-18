import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkuFinancialResult, SkuFinancialRow } from "@/lib/services/supabase/sku-financial-report";

const state = vi.hoisted(() => ({ branch: "fnb", range: { from: "2026-10-01", to: "2026-10-18" }, fetch: vi.fn(), exportExcel: vi.fn(), toast: vi.fn(), refresh: undefined as (() => void) | undefined }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ tenant: { id: "onebiz" } }), useBranchFilter: () => ({ activeBranchId: state.branch, branchLabel: state.branch, isReady: true }), useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "custom", range: state.range, setPreset: vi.fn(), setCustomRange: vi.fn() }) }));
vi.mock("@/lib/hooks/use-live-data-refresh", () => ({ useLiveDataRefresh: (refresh: () => void) => { state.refresh = refresh; } }));
vi.mock("@/lib/services/supabase/sku-financial-report", () => ({ getSkuFinancialReport: state.fetch }));
vi.mock("@/lib/utils/excel-export", async original => ({ ...await original<typeof import("@/lib/utils/excel-export")>(), exportReportToExcel: state.exportExcel }));
vi.mock("@/components/ui/searchable-select", () => ({ SearchableSelect: ({ value, onValueChange, placeholder, options }: { value: string; onValueChange: (v: string) => void; placeholder: string; options: {value: string; label: string}[] }) => <select aria-label={placeholder} value={value} onChange={e => onValueChange(e.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));
vi.mock("@/components/shared/report", () => ({
  ReportPageHeader: ({ onExportView, onExportFull, exportDisabled, subtitle }: { onExportView: () => void; onExportFull: () => void; exportDisabled: boolean; subtitle: string }) => <><p>{subtitle}</p><button disabled={exportDisabled} onClick={onExportView}>Xuất bảng</button><button disabled={exportDisabled} onClick={onExportFull}>Xuất đầy đủ</button></>,
  ReportDataTable: ({ rows, onSortChange, tablePreferenceKey }: { rows: {code?: string; category?: string}[]; tablePreferenceKey: string; onSortChange?: (sort: {id: string; direction: string}) => void }) => <div>{onSortChange && <button onClick={() => onSortChange({ id: "netRevenue", direction: "desc" })}>{tablePreferenceKey.endsWith("categories") ? "Sắp nhóm" : "Sắp doanh thu"}</button>}{rows.map((row,i) => <span key={i} data-testid="report-row">{row.code ?? row.category}</span>)}</div>,
}));
import SkuPage from "@/app/(main)/phan-tich/sku-chi-tiet/page";

function sku(id: string, revenue: number, cost: number | null = 10): SkuFinancialRow {
  return { productId: id, code: id, name: id, category: "Trà", unit: "Ly", orders: 1, customers: 1, soldQty: 1, returnedQty: 0, netQty: 1, salesAmount: revenue, returnAmount: 0, netRevenue: revenue, cogs: cost, grossProfit: cost === null ? null : revenue-cost, marginPercent: cost === null ? null : 50, averageSalePrice: revenue, missingCostLines: cost === null ? 1 : 0, lastActivityAt: "2026-10-18T00:00:00Z" };
}
const result = (rows: SkuFinancialRow[]): SkuFinancialResult => ({ rows, customers: [{ id: "c1", code: "KH01", name: "Khách 1" }] });
function deferred<T>() { let resolve!: (value:T) => void; const promise = new Promise<T>(done => { resolve=done; }); return {promise,resolve}; }
beforeEach(() => { window.history.replaceState(null, "", "/"); state.branch = "fnb"; state.fetch.mockReset().mockImplementation((range: {from:string}) => Promise.resolve(result(range.from === "2026-10-01" ? [sku("A", 20), sku("B", 100)] : [sku("A", 50), sku("C", 70)]))); state.exportExcel.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);

describe("SKU management workflow", () => {
  it("keeps lost sales visible and exports the exact filtered sorted rows", async () => {
    render(<SkuPage />);
    await waitFor(() => expect(screen.getByRole("button", {name:"Xuất bảng"})).toBeEnabled());
    expect(screen.getAllByTestId("report-row").map(row => row.textContent)).toContain("C");
    fireEvent.change(screen.getByLabelText("Nghiệp vụ cần xem"), {target:{value:"decline"}});
    fireEvent.click(screen.getByRole("button",{name:"Sắp doanh thu"}));
    await act(async () => screen.getByRole("button",{name:"Xuất bảng"}).click());
    const file=state.exportExcel.mock.calls[0][0];
    expect(file.sheets[0].rows.map((row:{code:string})=>row.code)).toEqual(["A","C"]);
    expect(file.sheets[0].rows[1]).toMatchObject({netRevenue:0,previousRevenue:70,revenueDifference:-70});
    expect(file.sheets[0].titleRows.join(" ")).toContain("13/09/2026 - 30/09/2026");
    expect(file.sheets[0].titleRows.join(" ")).toContain("Doanh thu giảm");
    fireEvent.click(screen.getByRole("button",{name:"Xóa bộ lọc"}));
    expect(screen.getByLabelText("Nghiệp vụ cần xem")).toHaveValue("all");
  });

  it("shows a load failure instead of a zero-result report and retries", async () => {
    state.fetch.mockRejectedValue(new Error("Mất kết nối"));
    render(<SkuPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Mất kết nối"));
    expect(screen.queryByTestId("report-row")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name:"Xuất bảng"})).toBeDisabled();
    state.fetch.mockResolvedValue(result([sku("OK",100)]));
    fireEvent.click(screen.getByRole("button",{name:"Thử lại"}));
    await waitFor(()=>expect(screen.getAllByTestId("report-row").map(row=>row.textContent)).toContain("OK"));
  });

  it("rejects late old-scope data and hides loaded values during branch changes", async () => {
    const view=render(<SkuPage />);
    await waitFor(()=>expect(screen.getByRole("button",{name:"Xuất bảng"})).toBeEnabled());
    const old=deferred<SkuFinancialResult>();
    state.fetch.mockReturnValue(old.promise);
    act(()=>state.refresh?.());
    state.branch="retail";
    state.fetch.mockResolvedValue(result([sku("NEW",300)]));
    view.rerender(<SkuPage />);
    expect(screen.getByRole("button",{name:"Xuất bảng"})).toBeDisabled();
    await waitFor(()=>expect(screen.getAllByTestId("report-row").map(row=>row.textContent)).toContain("NEW"));
    await act(async()=>old.resolve(result([sku("OLD",999)])));
    expect(screen.queryByText("OLD")).not.toBeInTheDocument();
  });

  it("coalesces refresh events and honors a customer deep link on both periods", async () => {
    window.history.replaceState(null,"","/?customer=c1&skuReview=missing");
    const first=deferred<SkuFinancialResult>();
    state.fetch.mockReturnValueOnce(first.promise).mockResolvedValue(result([sku("COST",100,null)]));
    render(<SkuPage />);
    await waitFor(()=>expect(state.fetch).toHaveBeenCalledTimes(2));
    act(()=>{state.refresh?.();state.refresh?.();state.refresh?.();});
    expect(state.fetch).toHaveBeenCalledTimes(2);
    await act(async()=>first.resolve(result([sku("COST",100,null)])));
    await waitFor(()=>expect(state.fetch).toHaveBeenCalledTimes(4));
    expect(state.fetch.mock.calls.every(call=>call[2]==="c1")).toBe(true);
    expect(screen.getByLabelText("Nghiệp vụ cần xem")).toHaveValue("missing");
  });
});
