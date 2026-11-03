import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ calls: [] as unknown[][], receiptError: false, completed: true, debt: 0, purchaseStatus: "completed", branchId: "branch" as string | null, deniedTable: "" }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentContext: async () => ({ tenantId: "tenant" }),
  handleError: (error: unknown) => { throw error; },
  getClient: () => ({ from: (table: string) => {
    state.calls.push([table, "from"]);
    if (table === "customers" || table === "suppliers") throw new Error("Company balance must not be read");
    const response = () => table === state.deniedTable ? { data: null, error: new Error("Document access denied") }
      : table === "invoices" ? { data: { id: "invoice", code: "TEST-1", status: state.completed ? "completed" : "draft", total: 150, paid: 150, debt: state.debt, branch_id: state.branchId, customer_id: "customer", payment_method: "mixed" }, error: null }
      : table === "purchase_orders" ? { data: { id: "purchase", code: "TEST-PO", status: state.purchaseStatus, total: 180, paid: 70, debt: state.debt, branch_id: "branch", supplier_id: "supplier", supplier_name: "Synthetic supplier" }, error: null }
      : table === "purchase_order_items" ? { data: [{ product_id: "product", product_name: "Synthetic product", received_quantity: 5, unit: "unit" }, { product_id: "unreceived", product_name: "Unreceived", received_quantity: 0, unit: "unit" }], error: null }
      : table === "products_scoped" ? { data: [{ id: "product", stock: 2 }], error: null }
      : table === "invoice_items_scoped" ? { data: [], count: 3, error: null }
      : table === "loyalty_transactions" ? { data: [{ points: 4 }], error: null }
      : table === "shipping_orders" ? { data: [], count: 2, error: null }
      : table === "cash_transactions" ? { data: state.receiptError ? null : [{ id: "a", amount: 60, payment_method: "cash" }, { id: "b", amount: 40, payment_method: "transfer" }], error: state.receiptError ? new Error("Receipt access denied") : null, count: 2 }
      : table === "branches" ? { data: { name: "Test branch" }, error: null }
      : { data: [], count: 0, error: null };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gt", "in", "order", "range"]) query[method] = (...args: unknown[]) => { state.calls.push([table, method, ...args]); return query; };
    query.single = async () => response(); query.maybeSingle = async () => response();
    query.then = (resolve: (value: unknown) => void) => Promise.resolve(response()).then(resolve);
    return query;
  } }),
}));
import { getInvoiceCancelImpact, getPurchaseCancelImpact } from "@/lib/services/supabase/cancel-impact";

beforeEach(() => { state.calls = []; state.receiptError = false; state.completed = true; state.debt = 0; state.purchaseStatus = "completed"; state.branchId = "branch"; state.deniedTable = ""; });
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
  it("does not read receipts without an identified invoice branch", async () => {
    state.branchId = null;
    await expect(getInvoiceCancelImpact("invoice")).rejects.toThrow("Hóa đơn chưa xác định chi nhánh");
    expect(state.calls.some(([table]) => table === "cash_transactions")).toBe(false);
  });
  it.each([
    ["invoices", getInvoiceCancelImpact],
    ["purchase_orders", getPurchaseCancelImpact],
  ] as const)("stops at a denied %s document without child or company reads", async (table, fetchImpact) => {
    state.deniedTable = table;
    await expect(fetchImpact("denied")).rejects.toThrow("Document access denied");
    expect(state.calls.filter(([, method]) => method === "from")).toEqual([[table, "from"]]);
    expect(state.calls).toContainEqual([table, "eq", "tenant_id", "tenant"]);
    expect(state.calls).toContainEqual([table, "eq", "id", "denied"]);
  });
  it.each([0, 50])("preserves invoice document impact with debt %s and unknown prebalance", async debt => {
    state.debt = debt;
    const impact = await getInvoiceCancelImpact("invoice");
    expect(impact).toMatchObject({ debtAmount: debt, counterpartyDebtBefore: null,
      cashAmount: 100, cashDirection: "refund_to_customer", refundMethods: { cash: 60, transfer: 40 },
      stockLineCount: 3, branchName: "Test branch", loyaltyPoints: 4, pendingShippingCount: 2 });
    expect(state.calls.some(([table]) => table === "customers" || table === "suppliers")).toBe(false);
  });
  it.each(["completed", "partial"])("preserves %s purchase debt, refund and negative-stock warning without supplier balance", async status => {
    state.purchaseStatus = status; state.debt = 110;
    const impact = await getPurchaseCancelImpact("purchase");
    expect(impact).toMatchObject({ total: 180, hasSideEffects: true, debtAmount: 110,
      counterpartyDebtBefore: null, cashDirection: "collect_from_supplier", cashAmount: 70,
      suggestedMethod: "cash", stockLineCount: 1, branchName: "Test branch",
      negativeStock: [{ productName: "Synthetic product", available: 2, needed: 5, unit: "unit" }] });
    expect(impact.refundMethods).toBeUndefined();
    expect(state.calls).toContainEqual(["purchase_orders", "eq", "tenant_id", "tenant"]);
    expect(state.calls).toContainEqual(["products_scoped", "eq", "tenant_id", "tenant"]);
    expect(state.calls.some(([table]) => table === "customers" || table === "suppliers")).toBe(false);
  });
  it.each(["draft", "ordered"])("retains no-side-effect preview for %s purchases", async status => {
    state.purchaseStatus = status; state.debt = 110;
    expect(await getPurchaseCancelImpact("purchase")).toMatchObject({ hasSideEffects: false,
      debtAmount: 0, counterpartyDebtBefore: null, cashAmount: 0, cashDirection: null, stockLineCount: 0 });
    expect(state.calls.filter(([, method]) => method === "from")).toEqual([["purchase_orders", "from"]]);
  });
});
