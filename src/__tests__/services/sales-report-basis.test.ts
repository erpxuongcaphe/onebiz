import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc: state.rpc }), getCurrentTenantId: vi.fn(), handleError: (error: unknown) => { throw error; } }));
import { getSalesReportSummary, getSalesReportDailyRows, getSalesReportInvoiceDetailPage, getSalesInvoiceExportRows } from "@/lib/services/supabase/analytics";
import { getSalesReturnReport } from "@/lib/services/supabase/sales-reports";
const range = { from: "2026-10-01", to: "2026-10-02" };
beforeEach(() => {
  const period = { net_revenue: 0, delivery_fee: 0, invoice_count: 0, return_amount: 0, return_count: 0, sold_qty: 0 };
  state.rpc.mockReset().mockResolvedValue({ data: { current: period, previous: period, daily: [], weekday: [], hourly: [], top_invoices: [], rows: [], has_more: false }, error: null });
});

describe("explicit report basis contracts", () => {
  it.each([true, false])("sends the same explicit basis %s to all sales readers", async basis => {
    await getSalesReportSummary("branch-a", range, basis);
    state.rpc.mockResolvedValueOnce({ data: [], error: null });
    await getSalesReportDailyRows("branch-a", range, basis);
    await getSalesReportInvoiceDetailPage("branch-a", range, 0, 50, basis);
    await getSalesInvoiceExportRows("branch-a", range, basis);
    expect(state.rpc.mock.calls.map(call => call[0])).toEqual(["get_sales_report_summary_basis_v1", "get_sales_report_daily_rows_basis_v1", "get_sales_report_invoice_detail_page_basis_v1", "get_sales_report_invoice_page_basis_v1"]);
    for (const [, params] of state.rpc.mock.calls) {
      expect(params).toMatchObject({ p_branch_id: "branch-a", p_exclude_internal: basis });
      expect(Date.parse(params.p_date_to) - Date.parse(params.p_date_from)).toBe(2 * 86400000);
    }
  });
  it("preserves existing callers that did not opt into the new source", async () => {
    await getSalesReportSummary("branch-a", range);
    expect(state.rpc).toHaveBeenCalledWith("get_sales_report_summary", expect.not.objectContaining({ p_exclude_internal: expect.anything() }));
  });
  it("fails closed without falling back to an unfiltered summary", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "source unavailable" } });
    await expect(getSalesReportSummary("branch-a", range, true)).rejects.toThrow("source unavailable");
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])("sends explicit basis %s to returns without a tenant override", async basis => {
    state.rpc.mockResolvedValueOnce({ data: { rows: [], exclude_internal: basis }, error: null });
    await getSalesReturnReport({ branchId: "branch-a", dateFrom: range.from, dateTo: range.to, excludeInternal: basis });
    expect(state.rpc).toHaveBeenCalledWith("get_sales_return_report_basis_v1", expect.objectContaining({ p_branch_id: "branch-a", p_exclude_internal: basis }));
    expect(state.rpc.mock.calls[0][1]).not.toHaveProperty("p_tenant_id");
  });
  it("keeps the explicit basis through every full-export page", async () => {
    const raw = { id: "i1", code: "HD-A", subtotal: 1, discount_amount: 0, delivery_fee: 0, total: 1, paid: 1, debt: 0, issued_at: "2026-10-01T12:00:00+07:00" };
    state.rpc.mockResolvedValueOnce({ data: { rows: [raw], has_more: true }, error: null })
      .mockResolvedValueOnce({ data: { rows: [{ ...raw, id: "i2", code: "HD-B" }], has_more: false }, error: null });
    const rows = await getSalesInvoiceExportRows(undefined, range, true);
    expect(rows).toHaveLength(2);
    expect(state.rpc.mock.calls.map(call => call[1].p_offset)).toEqual([0, 1]);
    expect(state.rpc.mock.calls.every(call => call[1].p_exclude_internal === true && call[1].p_branch_id === null)).toBe(true);
  });
  it("does not convert a missing monetary field to zero", async () => {
    state.rpc.mockResolvedValueOnce({ data: { current: {}, previous: {} }, error: null });
    await expect(getSalesReportSummary("branch-a", range, true)).rejects.toThrow("thiếu số liệu");
  });
  it("rejects an incomplete export page instead of saving a partial workbook", async () => {
    state.rpc.mockResolvedValueOnce({ data: { rows: [], has_more: true }, error: null });
    await expect(getSalesInvoiceExportRows("branch-a", range, true)).rejects.toThrow("thiếu trang");
  });
  it("rejects duplicate invoice identities between export pages", async () => {
    const row = { id: "i1", subtotal: 1, discount_amount: 0, delivery_fee: 0, total: 1, paid: 1, debt: 0 };
    state.rpc.mockResolvedValueOnce({ data: { rows: [row], has_more: true }, error: null }).mockResolvedValueOnce({ data: { rows: [row], has_more: false }, error: null });
    await expect(getSalesInvoiceExportRows("branch-a", range, true)).rejects.toThrow("đã thay đổi");
  });
});
