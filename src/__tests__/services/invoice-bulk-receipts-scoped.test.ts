import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  tables: [] as string[],
  invoices: [] as unknown[],
}));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentContext: async () => ({ tenantId: "tenant" }),
  handleError: (error: Error) => {
    throw error;
  },
  getClient: () => ({
    rpc: state.rpc,
    from: (table: string) => {
      state.tables.push(table);
      if (table === "cash_transactions" || table === "stock_movements_scoped")
        throw new Error("Broad ledger access is forbidden");
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "in", "order", "range"])
        chain[method] = () => chain;
      chain.then = (resolve: (value: unknown) => void) =>
        Promise.resolve(
          table === "invoices"
            ? { data: state.invoices, error: null }
            : { data: [], count: 0, error: null },
        ).then(resolve);
      return chain;
    },
  }),
}));
vi.mock("@/lib/services/supabase/invoices", () => ({
  cancelInvoice: vi.fn(),
  voidCompletedInvoice: vi.fn(),
}));
import { previewInvoiceBulkCancel } from "@/lib/services/supabase/invoice-bulk-cancel";

const invoice = (id: string, branch: string, status = "completed") => ({
  id,
  code: id,
  branch_id: branch,
  source: "fnb",
  status,
  total: 100,
  paid: 100,
  debt: 0,
  payment_method: "cash",
});
const permissions = {
  fnb: true,
  retail: false,
  forInvoice: (row: { branchId?: string }) => row.branchId === "allowed",
};
beforeEach(() => {
  state.rpc.mockReset();
  state.tables = [];
  state.invoices = [invoice("a", "allowed"), invoice("b", "denied")];
});

describe("bulk invoice cancellation receipt totals", () => {
  it("loads only permitted totals and never reads the full cash table", async () => {
    state.rpc.mockResolvedValue({
      data: [{ invoice_id: "a", refund: 65, stock_movements: 3 }],
      error: null,
    });
    const rows = await previewInvoiceBulkCancel(["a", "b"], permissions);
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith(
      "get_invoice_cancel_preview_totals",
      { p_invoice_ids: ["a"] },
    );
    expect(rows.map((row) => row.refund)).toEqual([65, 0]);
    expect(rows.map((row) => row.stockMovements)).toEqual([3, 0]);
    expect(state.tables).not.toContain("cash_transactions");
    expect(state.tables).not.toContain("stock_movements_scoped");
  });

  it("fails closed if the totals are incomplete or an invoice is changed", async () => {
    state.rpc.mockResolvedValue({ data: [], error: null });
    await expect(
      previewInvoiceBulkCancel(["a", "b"], permissions),
    ).rejects.toThrow("Chưa xác nhận được tổng khoản thu");
    state.rpc.mockResolvedValue({
      data: [{ invoice_id: "a", refund: null, stock_movements: 0 }],
      error: null,
    });
    await expect(
      previewInvoiceBulkCancel(["a", "b"], permissions),
    ).rejects.toThrow("Chưa xác nhận được tổng khoản thu");
    state.invoices = [invoice("a", "allowed")];
    await expect(
      previewInvoiceBulkCancel(["a", "b"], permissions),
    ).rejects.toThrow("hóa đơn đã thay đổi");
  });

  it("checks original movements for permitted drafts too", async () => {
    state.invoices = [invoice("a", "allowed", "draft")];
    state.rpc.mockResolvedValue({
      data: [{ invoice_id: "a", refund: 0, stock_movements: 1 }],
      error: null,
    });
    const row = (await previewInvoiceBulkCancel(["a"], permissions))[0];
    expect(row.refund).toBe(0);
    expect(row.stockMovements).toBe(1);
  });
});
