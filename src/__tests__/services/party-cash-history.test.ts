import { beforeEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(), gte: vi.fn(), lte: vi.fn(), or: vi.fn() };
  return { query, from: vi.fn(), result: { data: [] as Record<string, unknown>[], count: 0, error: null as null | { message: string } } };
});
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mocked.from }),
  getCurrentTenantId: async () => "tenant-1",
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { getAllPartyCashHistory, getPartyCashHistory } from "@/lib/services/supabase/cash-book";

describe("party cash history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.from.mockReturnValue(mocked.query);
    mocked.query.select.mockReturnValue(mocked.query);
    mocked.query.eq.mockReturnValue(mocked.query);
    mocked.query.order.mockReturnValue(mocked.query);
    mocked.query.gte.mockReturnValue(mocked.query);
    mocked.query.lte.mockReturnValue(mocked.query);
    mocked.query.or.mockReturnValue(mocked.query);
    mocked.query.range.mockImplementation(async () => mocked.result);
    mocked.result = { data: [], count: 0, error: null };
  });
  it("uses tenant, exact supplier identity and the selected branch", async () => {
    await getPartyCashHistory("supplier", "supplier-1", "branch-1", 1);
    expect(mocked.query.eq.mock.calls).toEqual([["tenant_id", "tenant-1"], ["supplier_id", "supplier-1"], ["branch_id", "branch-1"]]);
    expect(mocked.query.range).toHaveBeenCalledWith(25, 49);
  });
  it("can read permitted branches together without guessing counterparties by name", async () => {
    await getPartyCashHistory("customer", "customer-1", null);
    expect(mocked.query.eq.mock.calls).toEqual([["tenant_id", "tenant-1"], ["customer_id", "customer-1"]]);
    expect(mocked.query.order.mock.calls).toEqual([["transaction_date", { ascending: false }], ["created_at", { ascending: false }], ["id", { ascending: false }]]);
  });
  it("keeps cancelled vouchers and separates booking date from actual cash time", async () => {
    mocked.result = { count: 1, error: null, data: [{ id: "cash-1", code: "PC1", type: "payment", category: "supplier_advance", amount: 500000, status: "cancelled", transaction_date: "2026-10-01", occurred_at: "2026-10-02T03:00:00Z", created_at: "2026-10-03T03:00:00Z", profiles: { full_name: "Admin" }, branches: { name: "Kho Tổng" } }] };
    const result = await getPartyCashHistory("supplier", "supplier-1");
    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({ status: "cancelled", date: "2026-10-01", occurredAt: "2026-10-02T03:00:00Z", createdByName: "Admin", branchName: "Kho Tổng" });
  });
  it("does not report an inaccessible history as empty", async () => {
    mocked.result.error = { message: "permission denied" };
    await expect(getPartyCashHistory("supplier", "supplier-1")).rejects.toThrow("permission denied");
  });
  it("applies filters and stable amount sorting before pagination", async () => {
    await getPartyCashHistory("customer", "customer-1", "branch-1", 0, { search: 'PT1, note', dateFrom: "2026-10-01", dateTo: "2026-10-12", type: "receipt", status: "completed", paymentMethod: "transfer", sortBy: "amount", ascending: true });
    expect(mocked.query.gte).toHaveBeenCalledWith("transaction_date", "2026-10-01");
    expect(mocked.query.lte).toHaveBeenCalledWith("transaction_date", "2026-10-12");
    expect(mocked.query.eq).toHaveBeenCalledWith("payment_method", "transfer");
    expect(mocked.query.eq).toHaveBeenCalledWith("status", "completed");
    expect(mocked.query.or).toHaveBeenCalledWith('code.ilike."%PT1, note%",note.ilike."%PT1, note%"');
    expect(mocked.query.order.mock.calls[0]).toEqual(["amount", { ascending: true }]);
  });
  it("exports all matching pages without dropping the first page boundary", async () => {
    const first = Array.from({ length: 1000 }, (_, index) => ({ id: `cash-${index}`, amount: index }));
    mocked.query.range.mockResolvedValueOnce({ data: first, count: 1001, error: null }).mockResolvedValueOnce({ data: [{ id: "last", amount: 1 }], count: 1001, error: null });
    const rows = await getAllPartyCashHistory("supplier", "supplier-1", "branch-1", { status: "completed" });
    expect(rows).toHaveLength(1001);
    expect(mocked.query.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
    expect(mocked.query.eq).toHaveBeenCalledWith("supplier_id", "supplier-1");
  });
  it("does not silently export partial or duplicated history", async () => {
    const first = Array.from({ length: 1000 }, (_, i) => ({ id: `cash-${i}` }));
    mocked.query.range.mockResolvedValueOnce({data:first,count:1001,error:null}).mockResolvedValueOnce({data:[],count:1001,error:null});
    await expect(getAllPartyCashHistory("supplier","supplier-1")).rejects.toThrow("chưa tải đủ");
    mocked.query.range.mockResolvedValueOnce({data:first,count:1001,error:null}).mockResolvedValueOnce({data:[{id:"cash-1"}],count:1001,error:null});
    await expect(getAllPartyCashHistory("supplier","supplier-1")).rejects.toThrow("bị trùng");
  });
});
