import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc: fake.rpc }), handleError: (error: Error) => { throw error; } }));
import { getAllCodReconciliation, getCodReconciliation, settleCodScoped } from "@/lib/services/supabase/cod-reconciliation";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number) => ({ id: uuid(n), code: `DS-${n}`, branchId: uuid(900), branchName: "Fixture", partnerName: "Fixture",
  createdAt: "2026-10-26T01:00:00Z", paymentMethod: "transfer", shipmentCount: 0, linkedCount: 0,
  moneyAccountId: uuid(901), feeMoneyAccountId: null, expectedReceipts: 100, expectedFees: 10, expectedNet: 90,
  postedReceipts: 100, postedFees: 10, postedNet: 90, receiptDifference: 0, feeDifference: 0, status: "matched", shipments: [] });
const response = (items = [row(1)], total = items.length, fingerprint = "a".repeat(32)) => ({ data: { items, total, fingerprint,
  summary: { count: total, matchedCount: total, reviewCount: 0, expectedReceipts: total * 100, postedReceipts: total * 100, postedFees: total * 10, postedNet: total * 90 } }, error: null });
const query = { branchId: uuid(900), from: "2026-10-01", to: "2026-10-26" };
beforeEach(() => fake.rpc.mockReset());
describe("COD reconciliation source contract", () => {
  it("passes branch, date, search and server sorting without changing scope", async () => {
    fake.rpc.mockResolvedValue(response());
    await getCodReconciliation({ ...query, search: " DS ", sortBy: "postedNet", descending: false });
    expect(fake.rpc).toHaveBeenCalledWith("get_cod_settlement_workspace_v1", expect.objectContaining({ p_branch_id: uuid(900), p_from: query.from, p_to: query.to, p_search: "DS", p_sort_by: "postedNet", p_sort_desc: false, p_with_shipments: false }));
  });
  it("rejects incomplete pages and inconsistent matched amounts", async () => {
    fake.rpc.mockResolvedValue(response([row(1)], 2));
    await expect(getCodReconciliation(query)).rejects.toThrow();
    fake.rpc.mockResolvedValue(response([{ ...row(1), postedNet: 99 }]));
    await expect(getCodReconciliation(query)).rejects.toThrow();
  });
  it("keeps unknown legacy money unknown", async () => {
    const result = response([{ ...row(1), status: "unlinked", postedReceipts: null, postedNet: null } as unknown as ReturnType<typeof row>]);
    result.data.summary = { ...result.data.summary, matchedCount: 0, reviewCount: 1 };
    fake.rpc.mockResolvedValue(result);
    expect((await getCodReconciliation(query)).items[0].postedNet).toBeNull();
  });
  it("exports all pages with batched details and a stable snapshot", async () => {
    fake.rpc.mockResolvedValueOnce(response(Array.from({ length: 200 }, (_, i) => row(i + 1)), 201)).mockResolvedValueOnce(response([row(201)], 201));
    expect(await getAllCodReconciliation(query)).toHaveLength(201);
    expect(fake.rpc.mock.calls.every(([, args]) => args.p_with_shipments === true)).toBe(true);
  });
  it("rejects snapshot changes even when the total stays the same", async () => {
    fake.rpc.mockResolvedValueOnce(response(Array.from({ length: 200 }, (_, i) => row(i + 1)), 201)).mockResolvedValueOnce(response([row(201)], 201, "b".repeat(32)));
    await expect(getAllCodReconciliation(query)).rejects.toThrow("đã thay đổi");
  });
  it("rejects missing full-export details", async () => {
    fake.rpc.mockResolvedValue(response([{ ...row(1), shipmentCount: 1 }]));
    await expect(getAllCodReconciliation(query)).rejects.toThrow();
  });
  it("does not fall back to the old posting function", async () => {
    fake.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "missing" } });
    await expect(settleCodScoped({ requestId: uuid(1), branchId: uuid(2), moneyAccountId: uuid(3), partnerId: null, items: [{ shipmentId: uuid(4), partnerFee: 0 }], paymentMethod: "cash" })).rejects.toThrow("chưa sẵn sàng");
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    expect(fake.rpc.mock.calls[0][0]).toBe("settle_cod_scoped_v1");
  });
});
