import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ calls: [] as unknown[][], receiptError: false, completed: true }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentContext: async () => ({ tenantId: "tenant" }),
  handleError: (error: unknown) => { throw error; },
  getClient: () => ({ from: (table: string) => {
    const response = () => table === "invoices" ? { data: { id: "invoice", code: "TEST-1", status: state.completed ? "completed" : "draft", total: 150, paid: 150, debt: 0, branch_id: "branch", customer_id: null, payment_method: "mixed" }, error: null }
      : table === "cash_transactions" ? { data: state.receiptError ? null : [{ id: "a", amount: 60, payment_method: "cash" }, { id: "b", amount: 40, payment_method: "transfer" }], error: state.receiptError ? new Error("Receipt access denied") : null, count: 2 }
      : table === "branches" ? { data: { name: "Test branch" }, error: null }
      : { data: [], count: 0, error: null };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gt", "order", "range"]) query[method] = (...args: unknown[]) => { state.calls.push([table, method, ...args]); return query; };
    query.single = async () => response(); query.maybeSingle = async () => response();
    query.then = (resolve: (value: unknown) => void) => Promise.resolve(response()).then(resolve);
    return query;
  } }),
}));
import { getInvoiceCancelImpact } from "@/lib/services/supabase/cancel-impact";

beforeEach(() => { state.calls = []; state.receiptError = false; state.completed = true; });
describe("invoice cancellation cash impact", () => {
  it("reads effective receipts rather than assuming invoice.paid is refundable", async () => {
    const impact = await getInvoiceCancelImpact("invoice");
    expect(impact.cashAmount).toBe(100);
    expect(impact.refundMethods).toEqual({ cash: 60, transfer: 40 });
    for (const [field, value] of [["tenant_id", "tenant"], ["branch_id", "branch"], ["reference_id", "invoice"], ["reference_type", "invoice"], ["type", "receipt"], ["status", "completed"]]) {
      expect(state.calls).toContainEqual(["cash_transactions", "eq", field, value]);
    }
  });
  it("fails closed instead of showing zero when receipt access fails", async () => {
    state.receiptError = true;
    await expect(getInvoiceCancelImpact("invoice")).rejects.toThrow("Receipt access denied");
  });
  it("does not load or offer money reversal for an unpaid draft", async () => {
    state.completed = false;
    expect((await getInvoiceCancelImpact("invoice")).cashAmount).toBe(0);
    expect(state.calls.some(([table]) => table === "cash_transactions")).toBe(false);
  });
});
