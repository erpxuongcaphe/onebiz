import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), units: vi.fn(), recorded: vi.fn() }));
vi.mock("@/lib/services/supabase/bom-sale-units", () => ({ getBomSaleUnits: state.recorded }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc: state.rpc }), handleError: (error: { message: string }) => { throw new Error(error.message); } }));
vi.mock("@/lib/services/supabase/report-stock-units", () => ({ getStockReportUnits: state.units, stockUnitReferenceKey: (a: string, b: string) => `${a}:${b}` }));
import { getCogsByBom } from "@/lib/services/supabase/bom-reports";
const params = { fromDate: "2026-10-01", toDate: "2026-10-30", branchId: "branch-1" };
beforeEach(() => {
  vi.clearAllMocks();
  const result = { data: [{ invoice_id: "bill-1", invoice_code: "HD001", product_id: "p1", branch_id: "branch-1", qty_sold: 2, revenue: 70000, cogs_real: null, margin: null }], error: null };
  const query = { order: vi.fn(() => query), gte: vi.fn(() => query), lt: vi.fn(() => query), range: vi.fn().mockResolvedValue(result) };
  state.rpc.mockReturnValue(query);
  state.units.mockResolvedValue(new Map([["bill-1:p1", { catalogUnit: "Ly", recordedUnit: "Ly", currentConversion: "1 Khay = 6 Ly" }]]));
  state.recorded.mockImplementation(async (rows: unknown[]) => rows.map(() => "Cái"));
});
it("loads current references only for authorized report IDs without promoting them to historical units", async () => {
  const rows = await getCogsByBom(params);
  expect(state.units).toHaveBeenCalledExactlyOnceWith([{ referenceId: "bill-1", productId: "p1", actualQuantity: 2 }], "current_stock");
  expect(rows[0]).toMatchObject({ qtySold: 2, catalogUnit: "Ly", currentConversion: "1 Khay = 6 Ly", cogsReal: null });
  expect(rows[0].recordedUnit).toBe("Cái");
});
it("widens the UTC calendar source and filters exact Vietnam dates before paging", async () => {
  const query = state.rpc(); state.rpc.mockClear();
  await getCogsByBom({ fromDate: "2026-10-01", toDate: "2026-10-29", branchId: "branch-1" });
  expect(state.rpc).toHaveBeenCalledWith("report_cogs_by_bom", { p_from_date: "2026-09-30", p_to_date: "2026-10-29", p_branch_id: "branch-1" });
  expect(query.gte).toHaveBeenCalledWith("invoice_date", "2026-09-30T17:00:00.000Z");
  expect(query.lt).toHaveBeenCalledWith("invoice_date", "2026-10-29T17:00:00.000Z");
});
it("rejects an inverted date range before reading financial data", async () => {
  await expect(getCogsByBom({ ...params, fromDate: "2026-11-01" })).rejects.toThrow("Khoảng ngày"); expect(state.rpc).not.toHaveBeenCalled();
});
it("does not read product metadata when the report is denied", async () => {
  state.rpc().range.mockResolvedValue({ data: null, error: { code: "42501", message: "REPORT_PERMISSION_DENIED" } });
  await expect(getCogsByBom(params)).rejects.toThrow("REPORT_PERMISSION_DENIED");
  expect(state.units).not.toHaveBeenCalled();
});
it("reads past the server page limit before loading the exact unit references", async () => {
  const first = Array.from({ length: 1000 }, (_, i) => ({ invoice_id: `bill-${i}`, product_id: "p1", branch_id: "branch-1", qty_sold: 1, revenue: 10, cogs_real: 0, margin: 10 }));
  const query = state.rpc(); query.range.mockResolvedValueOnce({ data: first, error: null }).mockResolvedValueOnce({ data: [{ ...first[0], invoice_id: "last" }], error: null });
  const rows = await getCogsByBom(params);
  expect(rows).toHaveLength(1001); expect(query.range).toHaveBeenNthCalledWith(1, 0, 999); expect(query.range).toHaveBeenNthCalledWith(2, 1000, 1999);
  expect(state.units.mock.calls[0][0]).toHaveLength(1001);
});
it("retains separate identical product lines on the same bill with distinct row keys", async () => {
  const item = { invoice_id: "bill", product_id: "p1", branch_id: "branch-1", qty_sold: 2, revenue: 10, cogs_real: 0, margin: 10 };
  state.rpc().range.mockResolvedValue({ data: [item, item], error: null });
  const rows = await getCogsByBom(params);
  expect(rows).toHaveLength(2); expect(new Set(rows.map(row => row.rowKey)).size).toBe(2);
  expect(rows.reduce((sum, row) => sum + row.revenue, 0)).toBe(20);
});
it("rejects foreign-branch source rows rather than exporting them", async () => {
  const item = { invoice_id: "bill", product_id: "p1", branch_id: "another" };
  state.rpc().range.mockResolvedValue({ data: [item], error: null });
  await expect(getCogsByBom(params)).rejects.toThrow("không khớp chi nhánh"); expect(state.units).not.toHaveBeenCalled();
});
it("fails rather than silently dropping missing metadata source errors", async () => {
  state.units.mockRejectedValue(new Error("Metadata unavailable"));
  await expect(getCogsByBom(params)).rejects.toThrow("Metadata unavailable");
});
