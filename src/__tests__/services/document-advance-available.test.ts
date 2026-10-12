import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ from: vi.fn(), eq: vi.fn(), queries: [] as string[] }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: state.from }), getCurrentContext: async () => ({ tenantId: "tenant-1" }),
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { getDocumentAdvanceAvailable } from "@/lib/services/supabase/payments";
describe("document advance availability", () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.queries = [];
    state.from.mockImplementation((table: string) => {
      state.queries.push(table);
      const query = { select: vi.fn(), eq: state.eq, gt: vi.fn(), order: vi.fn(), range: vi.fn(), single: vi.fn() };
      query.select.mockReturnValue(query); state.eq.mockReturnValue(query); query.gt.mockReturnValue(query); query.order.mockReturnValue(query);
      query.single.mockResolvedValue({ data: { branch_id: "document-branch", supplier_id: "supplier-1", customer_id: "customer-1" }, error: null });
      query.range.mockResolvedValue({ data: [{ remaining_amount: "300" }, { remaining_amount: 200 }], error: null });
      return query;
    });
  });
  it("uses only the supplier's active source money in the document branch", async () => {
    expect(await getDocumentAdvanceAvailable("purchase_order", "po-1")).toBe(500);
    expect(state.queries).toEqual(["purchase_orders", "supplier_advances"]);
    expect(state.eq).toHaveBeenCalledWith("supplier_id", "supplier-1");
    expect(state.eq).toHaveBeenCalledWith("branch_id", "document-branch");
    expect(state.eq).toHaveBeenCalledWith("status", "active");
    expect(state.eq.mock.calls.filter(call => call[0] === "tenant_id")).toHaveLength(2);
  });
  it("uses customer advances for an invoice without treating name matches as money", async () => {
    expect(await getDocumentAdvanceAvailable("invoice", "invoice-1")).toBe(500);
    expect(state.queries).toEqual(["invoices", "customer_advances"]);
    expect(state.eq).toHaveBeenCalledWith("customer_id", "customer-1");
  });
  it("does not hide a denied document as zero available money", async () => {
    state.from.mockImplementation(() => {
      const query = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
      query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
      query.single.mockResolvedValue({ data: null, error: { message: "branch denied" } }); return query;
    });
    await expect(getDocumentAdvanceAvailable("purchase_order", "po-1")).rejects.toThrow("branch denied");
  });
});
