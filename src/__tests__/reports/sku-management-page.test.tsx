import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkuFinancialResult, SkuFinancialRow } from "@/lib/services/supabase/sku-financial-report";

const state = vi.hoisted(() => ({ branch: "fnb", range: { from: "2026-10-01", to: "2026-10-18" }, fetch: vi.fn(), invoice: vi.fn(), exportExcel: vi.fn(), toast: vi.fn(), refresh: undefined as (() => void) | undefined }));
vi.mock("@/lib/services/supabase/reports", () => ({ getProfitAndLoss: state.invoice }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ tenant: { id: "onebiz" } }), useBranchFilter: () => ({ activeBranchId: state.branch, branchLabel: state.branch, isReady: true }), useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset: "custom", range: state.range, setPreset: vi.fn(), setCustomRange: vi.fn() }) }));
vi.mock("@/lib/hooks/use-live-data-refresh", () => ({ useLiveDataRefresh: (refresh: () => void) => { state.refresh = refresh; } }));
vi.mock("@/lib/services/supabase/sku-financial-report", () => ({ getSkuFinancialReport: state.fetch }));
vi.mock("@/lib/utils/excel-export", async original => ({ ...await original<typeof import("@/lib/utils/excel-export")>(), exportReportToExcel: state.exportExcel }));
vi.mock("@/components/ui/searchable-select", () => ({ SearchableSelect: ({ value, onValueChange, placeholder, options, disabled }: { value: string; onValueChange: (v: string) => void; placeholder: string; options: {value: string; label: string}[]; disabled?: boolean }) => <select disabled={disabled} aria-label={placeholder} value={value} onChange={e => onValueChange(e.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));
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
beforeEach(() => { window.history.replaceState(null, "", "/"); state.branch = "fnb"; state.invoice.mockReset().mockResolvedValue({ current: { goodsRevenue: 121 }, previous: { goodsRevenue: 120 } }); state.fetch.mockReset().mockImplementation((range: {from:string}) => Promise.resolve(result(range.from === "2026-10-01" ? [sku("A", 20), sku("B", 100)] : [sku("A", 50), sku("C", 70)]))); state.exportExcel.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);

describe("SKU management workflow", () => {
  it("explains an empty customer selector and links to scoped unnamed-customer evidence", async () => {
    state.fetch.mockResolvedValue({ rows: [sku("TEST", 100)], customers: [] });
    render(<SkuPage />);
    await waitFor(() => expect(screen.getByLabelText("Mặt hàng")).toBeEnabled());
    expect(screen.getByText("Chưa có khách định danh trong kỳ và kỳ đối chiếu.").closest('[role="status"]')).not.toBeNull();
    const link = screen.getByRole("link", { name: "Xem doanh số chưa gắn khách" });
    expect(link).toHaveAttribute("href", expect.stringContaining("branch=fnb"));
    expect(link).toHaveAttribute("href", expect.stringContaining("customerReview=anonymous"));
    expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeEnabled();
  });
  it("offers every scoped item, size and unit from both periods and exports the selected size", async () => {
    const small = { ...sku("A", 100), name: "Item A · Small", variantId: "small" };
    const large = { ...sku("A", 200), name: "Item A · Large", variantId: "large" };
    const old = { ...sku("OLD", 50), unit: "Kg", category: "Coffee" };
    const extra = Array.from({ length: 75 }, (_, index) => sku(`SKU-${index}`, index + 1));
    state.fetch.mockImplementation((range: { from: string }) => Promise.resolve({ rows: range.from === "2026-10-01" ? [small, large, ...extra] : [old], customers: [{ id: range.from === "2026-10-01" ? "current" : "previous", code: "TEST", name: range.from === "2026-10-01" ? "Current customer" : "Previous customer" }] }));
    render(<SkuPage />);
    await waitFor(() => expect(screen.getByLabelText("Mặt hàng")).toBeEnabled());
    expect(within(screen.getByLabelText("Mặt hàng")).getAllByRole("option")).toHaveLength(79);
    expect(within(screen.getByLabelText("Khách hàng")).getAllByRole("option")).toHaveLength(3);
    expect(within(screen.getByLabelText("Đơn vị tính")).getByRole("option", { name: "Kg" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Nhóm hàng")).getByRole("option", { name: "Coffee" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Nghiệp vụ cần xem")).getByRole("option", { name: "Tất cả nghiệp vụ" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mặt hàng"), { target: { value: JSON.stringify(["A", "large", "Ly"]) } });
    expect(state.fetch).toHaveBeenCalledTimes(2);
    await act(async () => screen.getByRole("button", { name: "Xuất đầy đủ" }).click());
    const file = state.exportExcel.mock.calls[0][0];
    expect(file.sheets[0].rows).toEqual([expect.objectContaining({ name: large.name, salesAmount: 200 })]);
    expect(file.sheets[0].titleRows.join(" ")).toContain("Mặt hàng: A · Item A · Large · Ly");
    expect(file.sheets.some((sheet: { name: string }) => sheet.name === "Đối chiếu hóa đơn")).toBe(false);
    expect(new URLSearchParams(window.location.search).get("skuItem")).toBe(JSON.stringify(["A", "large", "Ly"]));
    fireEvent.click(screen.getByRole("button", { name: "Xóa bộ lọc" }));
    expect(screen.getByLabelText("Mặt hàng")).toHaveValue("all");
    expect(new URLSearchParams(window.location.search).has("skuItem")).toBe(false);
  });
  it("does not expose old-scope filter choices while another branch is loading", async () => {
    const view = render(<SkuPage />);
    await waitFor(() => expect(screen.getByLabelText("Khách hàng")).toBeEnabled());
    const next = deferred<SkuFinancialResult>();
    state.fetch.mockReturnValue(next.promise); state.branch = "next-branch"; view.rerender(<SkuPage />);
    for (const label of ["Khách hàng", "Mặt hàng", "Nhóm hàng", "Đơn vị tính", "Nghiệp vụ cần xem"]) expect(screen.getByLabelText(label)).toBeDisabled();
    expect(within(screen.getByLabelText("Khách hàng")).queryByRole("option", { name: "Khách 1" })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("Mặt hàng")).queryByRole("option", { name: "A" })).not.toBeInTheDocument();
    await act(async () => next.resolve({ rows: [{ ...sku("NEW", 300), unit: "G" }], customers: [{ id: "new", code: "NEW", name: "New customer" }] }));
    await waitFor(() => expect(screen.getByLabelText("Mặt hàng")).toBeEnabled());
    expect(within(screen.getByLabelText("Khách hàng")).getByRole("option", { name: "New customer" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Đơn vị tính")).queryByRole("option", { name: "Ly" })).not.toBeInTheDocument();
  });
  it("keeps a selected item visible when it has no activity after a scope change", async () => {
    window.history.replaceState(null, "", `/?skuItem=${encodeURIComponent(JSON.stringify(["MISSING", null, "Ly"]))}`);
    render(<SkuPage />);
    await waitFor(() => expect(screen.getByLabelText("Mặt hàng")).toBeEnabled());
    expect(screen.getByLabelText("Mặt hàng")).toHaveDisplayValue("Mặt hàng đã chọn · không có phát sinh");
    expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Xóa bộ lọc" }));
    expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeEnabled();
  });
  it("exports both sizes of one product with their own prices and previous-period amounts", async () => {
    const small = { ...sku("SKU-RXA-002", 80000), name: "Xưởng Đặc Biệt - Túi · 250 gram", variantId: "250g", variantName: "250 gram", unit: "Cái", averageSalePrice: 80000 };
    const large = { ...sku("SKU-RXA-002", 700000), name: "Xưởng Đặc Biệt - Túi · 500 gram", variantId: "500g", variantName: "500 gram", unit: "Cái", soldQty: 5, netQty: 5, averageSalePrice: 140000 };
    state.fetch.mockImplementation((range: { from: string }) => Promise.resolve(result(range.from === "2026-10-01" ? [small, large] : [{ ...large, netRevenue: 280000 }])));
    render(<SkuPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeEnabled());
    await act(async () => screen.getByRole("button", { name: "Xuất đầy đủ" }).click());
    const sheet = state.exportExcel.mock.calls[0][0].sheets[0];
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows).toContainEqual(expect.objectContaining({ name: small.name, soldQty: 1, averageSalePrice: 80000, previousRevenue: 0 }));
    expect(sheet.rows).toContainEqual(expect.objectContaining({ name: large.name, soldQty: 5, averageSalePrice: 140000, previousRevenue: 280000 }));
    expect(sheet.footer).toMatchObject({ salesAmount: 780000, soldQty: 6 });
    fireEvent.change(screen.getByLabelText("Tìm SKU"), { target: { value: "500 gram" } });
    await act(async () => screen.getByRole("button", { name: "Xuất bảng" }).click());
    expect(state.exportExcel.mock.calls[1][0].sheets[0].rows).toEqual([expect.objectContaining({ name: large.name })]);
  });
  it("presents free packaging as cost context and retains it in the filtered full export", async () => {
    state.fetch.mockImplementation((range: {from:string}) => Promise.resolve(result(range.from === "2026-10-01" ? [sku("Cup", 0, 12), sku("Tea", 50, 30)] : [])));
    render(<SkuPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: /^Lãi gộp âm:/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Giá vốn hàng doanh thu 0: 12 · 1 SKU/ĐVT" }));
    expect(screen.getByLabelText("Nghiệp vụ cần xem")).toHaveValue("zeroRevenueCost");
    await act(async () => screen.getByRole("button", { name: "Xuất đầy đủ" }).click());
    expect(state.exportExcel.mock.calls[0][0].sheets[0].rows).toEqual([expect.objectContaining({ code: "Cup", netRevenue: 0, cogs: 12, grossProfit: -12 })]);
  });
  it("restores combined numeric filters and exports full columns without dropping the filter", async () => {
    window.history.replaceState(null, "", `/?skuMetrics=${encodeURIComponent(JSON.stringify([{ key: "netRevenue", state: "range", min: 50, max: null }]))}`);
    render(<SkuPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Xuất đầy đủ" })).toBeEnabled());
    expect(screen.getAllByTestId("report-row").map(row => row.textContent)).toEqual(["B", "Trà"]);
    await act(async () => screen.getByRole("button", { name: "Xuất đầy đủ" }).click());
    const file = state.exportExcel.mock.calls[0][0];
    expect(file.sheets[0].rows.map((row: {code:string}) => row.code)).toEqual(["B"]);
    expect(file.sheets[0].columns).toHaveLength(23);
    expect(file.sheets[0].columnGroups.map((group: {span:number}) => group.span)).toEqual([4, 7, 2, 5, 5]);
    expect(file.sheets[0].tablePreferenceKey).toBeUndefined();
    expect(file.sheets[0].titleRows.join(" ")).toContain("Doanh thu thuần: 50 đến Không giới hạn");
    expect(file.sheets.some((sheet: {name:string}) => sheet.name === "Đối chiếu hóa đơn")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Xóa bộ lọc" }));
    expect(new URLSearchParams(window.location.search).has("skuMetrics")).toBe(false);
  });
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
    expect(screen.getByLabelText("Khách hàng")).toBeDisabled();
    expect(screen.getByLabelText("Mặt hàng")).toBeDisabled();
    expect(screen.getByLabelText("Đơn vị tính")).toBeDisabled();
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
    expect(state.invoice).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nghiệp vụ cần xem")).toHaveValue("missing");
  });

  it("exports the unexplained difference without changing either source", async () => {
    render(<SkuPage />);
    await waitFor(() => expect(screen.getByRole("button", {name:"Xuất đầy đủ"})).toBeEnabled());
    expect(screen.getByText(/Có chênh lệch chưa phân loại/)).toBeInTheDocument();
    await act(async () => screen.getByRole("button", {name:"Xuất đầy đủ"}).click());
    const sheets = state.exportExcel.mock.calls[0][0].sheets;
    expect(sheets.find((sheet:{name:string})=>sheet.name==="Đối chiếu hóa đơn").rows).toContainEqual({metric:"Chênh lệch",current:1,previous:0});
    expect(sheets[0].footer.netRevenue).toBe(120);
  });

  it("keeps invoice reconciliation unavailable rather than zero when access fails", async () => {
    state.invoice.mockRejectedValue(new Error("Không có quyền"));
    render(<SkuPage />);
    await waitFor(() => expect(screen.getByRole("button", {name:"Xuất đầy đủ"})).toBeEnabled());
    expect(screen.getByText("Chưa tải được tổng hóa đơn để đối chiếu.")).toBeInTheDocument();
    await act(async () => screen.getByRole("button", {name:"Xuất đầy đủ"}).click());
    const sheets = state.exportExcel.mock.calls[0][0].sheets;
    expect(sheets.find((sheet:{name:string})=>sheet.name==="Đối chiếu hóa đơn").rows).toEqual([{metric:"Chưa đối chiếu được",current:null,previous:null}]);
  });
});
