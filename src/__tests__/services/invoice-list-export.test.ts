import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice, QueryParams } from "@/lib/types";
const { getInvoices } = vi.hoisted(() => ({ getInvoices: vi.fn() }));
vi.mock("@/lib/services/supabase/invoices", () => ({ getInvoices }));
import { getInvoicesForFilteredExport } from "@/lib/services/supabase/invoice-list-export";
const scope = { mode: "branch" as const, branchId: "branch-a", duocDemChiNhanhKhac: false };
const rows = Array.from({ length: 1237 }, (_, i) => ({ id: `id-${i}`, code: `HD${i}`, totalAmount: i * 1000 }) as Invoice);
beforeEach(() => {
  getInvoices.mockReset();
  getInvoices.mockImplementation(async (q: QueryParams) => ({
    data: rows.slice(q.page! * q.pageSize!, (q.page! + 1) * q.pageSize!), total: rows.length,
  }));
});
describe("Full filtered invoice export", () => {
  it.each(["retailSaleType", "fnbOrderType"])("exports 1237 rows with the same %s, branch, date, status, search and sorting on every page", async key => {
    const query = { search: "Trang", searchField: "customerName", sortBy: "date", sortOrder: "desc" as const,
      filters: { [key]: "delivery", delivery: "all", status: ["completed"], dateFrom: "2026-10-01", dateTo: "2026-10-22" } };
    const progress = vi.fn();
    const result = await getInvoicesForFilteredExport(scope, query, { onProgress: progress });
    expect(result).toEqual(rows);
    expect(new Set(result.map(r => r.id)).size).toBe(1237);
    expect(getInvoices).toHaveBeenCalledTimes(7);
    getInvoices.mock.calls.forEach(([q], page) => expect(q).toEqual({ ...query, branchId: "branch-a", page, pageSize: 200 }));
    expect(progress).toHaveBeenLastCalledWith({ loaded: 1237, total: 1237 });
  });
  it("snapshots mutable filters and scope at click time", async () => {
    const mutableScope = { ...scope };
    const query = { filters: { status: ["completed"] } };
    const work = getInvoicesForFilteredExport(mutableScope, query);
    mutableScope.branchId = "branch-b";
    query.filters.status.push("cancelled");
    await work;
    for (const [q] of getInvoices.mock.calls) {
      expect(q.branchId).toBe("branch-a"); expect(q.filters.status).toEqual(["completed"]);
    }
  });
  it("supports explicit all-branch scope and empty results", async () => {
    getInvoices.mockResolvedValue({ data: [], total: 0 });
    expect(await getInvoicesForFilteredExport({ mode: "all", duocDemChiNhanhKhac: false }, {})).toEqual([]);
    expect(getInvoices).toHaveBeenCalledWith({ filters: {}, page: 0, pageSize: 200, branchId: undefined });
  });
  it("never queries without a branch scope", async () => {
    await expect(getInvoicesForFilteredExport({ mode: "none", duocDemChiNhanhKhac: false }, {})).rejects.toThrow("Chọn chi nhánh");
    expect(getInvoices).not.toHaveBeenCalled();
  });
  it.each(["count changed", "short page", "duplicate", "network error"])("refuses partial output: %s", async failure => {
    getInvoices.mockImplementationOnce(async () => ({ data: rows.slice(0, 200), total: rows.length }));
    if (failure === "network error") getInvoices.mockRejectedValueOnce(new Error("network"));
    else getInvoices.mockResolvedValueOnce({ data: failure === "short page" ? rows.slice(200, 210) : failure === "duplicate" ? rows.slice(0, 200) : rows.slice(200, 400), total: failure === "count changed" ? 1240 : rows.length });
    await expect(getInvoicesForFilteredExport(scope, {})).rejects.toThrow();
    expect(getInvoices).toHaveBeenCalledTimes(2);
  });
  it("stops after an in-flight page when cancelled", async () => {
    const controller = new AbortController();
    await expect(getInvoicesForFilteredExport(scope, {}, { signal: controller.signal, onProgress: () => controller.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(getInvoices).toHaveBeenCalledTimes(1);
  });
});
