import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc: fake.rpc }), handleError: (error: Error) => { throw error; } }));
import { getAllSupplierReceipts, getSupplierReceiptWorkspace } from "@/lib/services/supabase/supplier-receipts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number) => ({ id: id(n), occurredAt: "2026-10-01T00:00:00+07:00", kind: "receipt", branchId: id(10000), branchName: "Fixture", orderId: id(10001), orderCode: "PN-1", supplierId: id(10002), supplierName: "Fixture", documentCode: "PN-1", documentStatus: "partial", productId: id(10003), productCode: "SKU-1", productName: "Fixture", stockUnit: "G", quantity: 10, unitPrice: 2, amount: 20, signedAmount: 20, priceSource: "movement", status: "verified" });
const result = (items = [row(1)], total = items.length, fingerprint = "a".repeat(32)) => ({ data: { items, total, fingerprint, basis: "historical_goods_value_before_document_discount_tax_and_fees", summary: { rows: total, reviewRows: 0, receivedAmount: total * 20, revertedAmount: 0, returnedAmount: 0, netAmount: total * 20 } }, error: null });
const query = { branchId: id(10000), from: "2026-10-01", to: "2026-10-26" };
beforeEach(() => { fake.rpc.mockReset(); });
describe("supplier physical receipt source", () => {
  it("forwards scope and all filters to one server source", async () => {
    fake.rpc.mockResolvedValue(result());
    await getSupplierReceiptWorkspace({ ...query, search: " PN ", kind: "receipt", status: "verified", sortBy: "amount", descending: false });
    expect(fake.rpc).toHaveBeenCalledWith("get_supplier_receipt_workspace_v1", expect.objectContaining({ p_branch_id: query.branchId, p_from: query.from, p_to: query.to, p_kind: "receipt", p_status: "verified", p_sort_by: "amount", p_sort_desc: false, p_search: "PN" }));
  });
  it("exports more than 1000 rows without accepting partial results", async () => {
    fake.rpc.mockImplementation(async (_name, args) => result(Array.from({ length: Math.min(200, 1001 - args.p_page * 200) }, (_, i) => row(args.p_page * 200 + i + 1)), 1001));
    expect(await getAllSupplierReceipts(query)).toHaveLength(1001);
    expect(fake.rpc).toHaveBeenCalledTimes(6);
  });
  it("rejects export snapshot changes with unchanged row count", async () => {
    fake.rpc.mockResolvedValueOnce(result(Array.from({ length: 200 }, (_, i) => row(i + 1)), 201)).mockResolvedValueOnce(result([row(201)], 201, "b".repeat(32)));
    await expect(getAllSupplierReceipts(query)).rejects.toThrow("đã thay đổi");
  });
  it("rejects incorrect row totals, signs and source basis", async () => {
    for (const response of [result([row(1)], 2), result([{ ...row(1), signedAmount: -20 }]), { ...result(), data: { ...result().data, basis: "current_price" } }]) {
      fake.rpc.mockResolvedValue(response); await expect(getSupplierReceiptWorkspace(query)).rejects.toThrow();
    }
  });
  it("does not fabricate zero for missing historical prices", async () => {
    const response = result();
    response.data.items[0] = { ...row(1), amount: null, signedAmount: null, unitPrice: null, status: "missing_price" } as unknown as ReturnType<typeof row>;
    response.data.summary = { ...response.data.summary, reviewRows: 1, receivedAmount: null, netAmount: null } as unknown as typeof response.data.summary;
    fake.rpc.mockResolvedValue(response);
    expect((await getSupplierReceiptWorkspace(query)).summary.netAmount).toBeNull();
  });
  it("fails closed when permission or source is unavailable", async () => {
    fake.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(getSupplierReceiptWorkspace(query)).rejects.toThrow("Không có quyền");
    fake.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    await expect(getSupplierReceiptWorkspace(query)).rejects.toThrow("chưa sẵn sàng");
  });
});
