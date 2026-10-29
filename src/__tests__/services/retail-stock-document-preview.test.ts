import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ from: vi.fn(), source: "pos", itemError: null as null | {message: string; code: string} }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mock.from }), getCurrentTenantId: async () => "tenant-a",
  handleError: (e: {message: string}) => { throw new Error(e.message); },
}));
import { getStockDocumentDetail } from "@/lib/services/supabase/stock-documents";
beforeEach(() => {
  mock.source = "pos"; mock.itemError = null; mock.from.mockReset();
  mock.from.mockImplementation((table: string) => {
    const response = table === "invoices" ? { data: { id: "invoice", code: "HD001805", source: mock.source, status: "completed" } }
      : table === "invoice_items_scoped" ? { data: [{ id: "item", product_name: "Retail SKU", quantity: 2 }], error: mock.itemError }
      : { data: [] };
    const query: Record<string, unknown> = {};
    for (const name of ["select", "eq", "in", "maybeSingle"]) query[name] = vi.fn(() => query);
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve);
    return query;
  });
});
describe("Retail stock document preview", () => {
  it("loads HD001805 via the protected invoice-line view and retains the parent tenant guard", async () => {
    const detail = await getStockDocumentDetail("bom_consume", "invoice");
    expect(detail?.items[0].productName).toBe("Retail SKU");
    expect(mock.from).toHaveBeenCalledWith("invoice_items_scoped");
    expect(mock.from).not.toHaveBeenCalledWith("invoice_items");
    const headerQuery = mock.from.mock.results[0].value;
    expect(headerQuery.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    const itemQuery = mock.from.mock.results[1].value;
    expect(itemQuery.eq).toHaveBeenCalledWith("invoice_id", "invoice");
  });
  it("does not fall back to a less restricted table when access is denied", async () => {
    mock.itemError = { message: "permission denied", code: "42501" };
    await expect(getStockDocumentDetail("bom_consume", "invoice")).rejects.toThrow("permission denied");
    expect(mock.from).not.toHaveBeenCalledWith("invoice_items");
  });
  it("preserves the existing F&B document path", async () => {
    mock.source = "fnb";
    await getStockDocumentDetail("invoice", "invoice");
    expect(mock.from).toHaveBeenCalledWith("invoice_items");
    expect(mock.from).not.toHaveBeenCalledWith("invoice_items_scoped");
  });
});
