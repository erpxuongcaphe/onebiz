import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc: mocks.rpc }), handleError: (err: Error) => { throw err; } }));
import { getDeliveryInvoiceManagement } from "@/lib/services/supabase/delivery-invoice-management";
const branch = "20000000-0000-4000-8000-000000000001";
const row = { id: "40000000-0000-4000-8000-000000000001", orderNumber: "DH-1", branchId: branch, branchName: "Quán thử", staffId: null, staffName: "Chưa phân công", createdAt: "2026-11-01T01:00:00Z", assignedAt: null, completedAt: null, orderStatus: "pending", invoiceId: null, invoiceCode: null, invoiceStatus: null, customerName: null, paymentMethod: null, invoiceTotal: null, invoicePaid: null, invoiceDebt: null, deliveryFee: null, deliveryTier: null, durationSeconds: null, deliveryStatus: "unassigned" };
const report = { items: [row], total: 1, canViewMoney: false, dateBasis: "createdAt", paymentBasis: "invoice" };
describe("delivery invoice report source contract", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: report, error: null }); });
  it("passes the selected branch and period to the read source", async () => {
    expect((await getDeliveryInvoiceManagement(branch, { from: "2026-11-01", to: "2026-11-01" })).total).toBe(1);
    expect(mocks.rpc).toHaveBeenCalledWith("get_delivery_invoice_management_v1", expect.objectContaining({ p_branch_id: branch, p_from: "2026-11-01" }));
  });
  it.each([
    { ...report, total: 2 }, { ...report, items: [row, row], total: 2 },
    { ...report, items: [{ ...row, branchId: "20000000-0000-4000-8000-000000000002" }] },
    { ...report, items: [{ ...row, invoicePaid: 100 }] },
  ])("rejects incomplete scope, duplicates or unexpected money fields", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(getDeliveryInvoiceManagement(branch, { from: "2026-11-01", to: "2026-11-01" })).rejects.toThrow();
  });
  it("does not fall back to the legacy source after a permission error", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("Denied") });
    await expect(getDeliveryInvoiceManagement(branch, { from: "2026-11-01", to: "2026-11-01" })).rejects.toThrow("Denied");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
