import { describe, expect, it, vi, beforeEach } from "vitest";
import { salesRange, salesBucketLabel, canViewSalesDashboard } from "@/lib/dashboard-sales";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc }), handleError: (error: {message: string}) => { throw new Error(error.message); } }));
import { getSalesDashboard } from "@/lib/services/supabase/dashboard-sales";
beforeEach(() => rpc.mockReset());
describe("sales ranges", () => {
  it("uses complete calendar periods including leap days", () => {
    expect(salesRange("day", "2024-02-16")).toMatchObject({ from: "2024-02-01", to: "2024-02-29" });
    expect(salesRange("month", "2026-10-20")).toMatchObject({ from: "2026-01-01", to: "2026-12-31" });
    expect(salesRange("year", "2026-10-20")).toMatchObject({ from: "2022-01-01", to: "2026-12-31" });
  });
  it("rejects normalized invalid dates", () => expect(() => salesRange("day", "2026-02-30")).toThrow());
  it("formats local bucket keys without timezone shifting", () => {
    expect(salesBucketLabel("2026-10-01T00:00:00", "hour")).toBe("00h");
    expect(salesBucketLabel("2026-10-01T00:00:00", "day")).toBe("01/10");
    expect(salesBucketLabel("2026-10-01T00:00:00", "month")).toBe("T10");
  });
  it("does not infer summary permission from cashier cashbook access", () => {
    expect(canViewSalesDashboard(code => code === "finance.view_cash_book", "store")).toBe(false);
    expect(canViewSalesDashboard(code => code === "pos_fnb.view_sales_summary", "store")).toBe(true);
    expect(canViewSalesDashboard(code => code === "reports.dashboard", "warehouse")).toBe(true);
  });
});
describe("sales RPC boundary", () => {
  it("passes explicit branch, dates and grain", async () => {
    const data = { sales: 0, discounts: 0, returns: 0, orders: 0, received: 0, refunded: 0, collected: 0, methods: {}, buckets: [], modes: [] };
    rpc.mockResolvedValue({ data, error: null });
    expect(await getSalesDashboard(undefined, "2026-01-01", "2026-10-20", "month")).toEqual(data);
    expect(rpc).toHaveBeenCalledWith("get_operational_sales_dashboard", { p_branch_id: null, p_from: "2026-01-01", p_to: "2026-10-20", p_grain: "month" });
  });
  it("rejects incomplete payload rather than substituting zero", async () => {
    rpc.mockResolvedValue({ data: { sales: 0 }, error: null });
    await expect(getSalesDashboard("b1", "2026-10-20", "2026-10-20", "hour")).rejects.toThrow("chưa đầy đủ");
  });
  it("propagates denied permissions", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "DENIED" } });
    await expect(getSalesDashboard("b1", "2026-10-20", "2026-10-20", "hour")).rejects.toThrow("DENIED");
  });
});
