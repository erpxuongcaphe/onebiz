import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/services/supabase/base", () => ({ getClient: vi.fn(), getCurrentContext: vi.fn(), handleError: vi.fn() }));
vi.mock("@/lib/services/supabase/invoices", () => ({ cancelInvoice: vi.fn(), voidCompletedInvoice: vi.fn() }));
import { executeInvoiceBulkCancel, canCancelInvoice, type InvoiceCancelPreview } from "@/lib/services/supabase/invoice-bulk-cancel";

const row = (id: string, overrides: Partial<InvoiceCancelPreview> = {}): InvoiceCancelPreview => ({
  id, code: "HD-" + id, status: "completed", source: "fnb", branchId: "xtb",
  total: 55000, paid: 55000, debt: 0, paymentMethod: "mixed", refund: 55000, stockMovements: 4, ...overrides,
});
const setup = (rows: InvoiceCancelPreview[]) => ({
  preview: vi.fn().mockResolvedValue(rows),
  voidInvoice: vi.fn().mockResolvedValue({ reversedCash: 55000, reversedStockMovements: 4 }),
  cancelDraft: vi.fn().mockResolvedValue(undefined),
});

describe("bulk completed invoice cancellation", () => {
  it("uses existing atomic reversal, original payment methods and one call per invoice", async () => {
    const rows = [row("a"), row("b")], deps = setup(rows), progress = vi.fn();
    const result = await executeInvoiceBulkCancel(rows, "  Nhập sai  ", { fnb: true, retail: false }, progress, deps);
    expect(result.every(r => r.ok)).toBe(true);
    expect(deps.cancelDraft).not.toHaveBeenCalled();
    expect(deps.voidInvoice.mock.calls).toEqual([
      [{ invoiceId: "a", reason: "Nhập sai" }], [{ invoiceId: "b", reason: "Nhập sai" }],
    ]);
    expect(progress).toHaveBeenCalledTimes(2);
  });
  it("routes drafts separately and skips cancelled/unauthorized invoices", async () => {
    const rows = [row("a", {status:"draft"}), row("b", {status:"cancelled"}), row("c", {source:"retail"})], deps = setup(rows);
    const result = await executeInvoiceBulkCancel(rows, "Kiểm tra", { fnb: true, retail: false }, vi.fn(), deps);
    expect(deps.cancelDraft).toHaveBeenCalledExactlyOnceWith("a");
    expect(deps.voidInvoice).not.toHaveBeenCalled();
    expect(result.map(r => r.ok)).toEqual([true,false,false]);
    expect(canCancelInvoice(row("x"), {fnb:false,retail:true})).toBe(false);
  });
  it("reports each failure without retrying or losing successful results", async () => {
    const rows=[row("a"),row("b"),row("c")], deps=setup(rows);
    deps.voidInvoice.mockRejectedValueOnce(new Error("NETWORK_TIMEOUT"));
    const result=await executeInvoiceBulkCancel(rows,"Nhập sai",{fnb:true,retail:false},vi.fn(),deps);
    expect(deps.voidInvoice).toHaveBeenCalledTimes(3);
    expect(result.map(r=>r.ok)).toEqual([false,true,true]);
    expect(result[0].message).toContain("kiểm tra lại hóa đơn");
  });
  it("does not mutate anything when preview values or status changed", async () => {
    const rows=[row("a")], deps=setup([row("a",{paid:10000})]);
    await expect(executeInvoiceBulkCancel(rows,"Nhập sai",{fnb:true,retail:true},vi.fn(),deps)).rejects.toThrow("đã thay đổi");
    expect(deps.voidInvoice).not.toHaveBeenCalled();
  });
  it("fails closed if preview reload fails", async () => {
    const rows=[row("a")],deps=setup(rows); deps.preview.mockRejectedValue(new Error("RLS"));
    await expect(executeInvoiceBulkCancel(rows,"Nhập sai",{fnb:true,retail:true},vi.fn(),deps)).rejects.toThrow("RLS");
    expect(deps.voidInvoice).not.toHaveBeenCalled();
  });
  it("rejects missing reason and duplicate IDs before preview/mutation", async () => {
    const rows=[row("a")],deps=setup(rows);
    await expect(executeInvoiceBulkCancel(rows,"ab",{fnb:true,retail:true},vi.fn(),deps)).rejects.toThrow("lý do");
    await expect(executeInvoiceBulkCancel([...rows,...rows],"Nhập sai",{fnb:true,retail:true},vi.fn(),deps)).rejects.toThrow("trùng");
    expect(deps.preview).not.toHaveBeenCalled(); expect(deps.voidInvoice).not.toHaveBeenCalled();
  });
  it("runs sequentially instead of concurrently writing shared stock and cash", async () => {
    const rows=[row("a"),row("b")],deps=setup(rows);let active=0,maxActive=0;
    deps.voidInvoice.mockImplementation(async()=>{active++;maxActive=Math.max(active,maxActive);await Promise.resolve();active--;});
    await executeInvoiceBulkCancel(rows,"Nhập sai",{fnb:true,retail:true},vi.fn(),deps);
    expect(maxActive).toBe(1);
  });
});
