import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ requests: [] as { from: number; to: number; scope: [string, unknown][]; order: string[] }[], changed: false, failed: false }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "tenant-1",
  getPaginationRange: ({ page, pageSize }: { page: number; pageSize: number }) => ({ from: page * pageSize, to: (page + 1) * pageSize - 1 }),
  handleError: (error: { message: string }) => { throw new Error(error.message); },
  getClient: () => ({ from: () => {
    const req = { from: 0, to: 0, scope: [] as [string, unknown][], order: [] as string[] };
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { req.scope.push([key, value]); return chain; },
      in: (key: string, value: unknown) => { req.scope.push([key, value]); return chain; },
      order: (key: string) => { req.order.push(key); return chain; },
      range: async (from: number, to: number) => {
        req.from = from; req.to = to; state.requests.push(req);
        if (state.failed && from > 0) return { error: { message: "network failed" } };
        return { data: Array.from({length: 225}, (_, index) => ({ id: `id-${index}`, code: `PN${index}`, status: "ordered", created_at: "2026-10-15", branch_id: "branch-1" })).slice(from, to + 1), count: state.changed && from > 0 ? 226 : 225, error: null };
      },
    };
    return chain;
  } }),
}));

import { getPurchaseOrderBoard } from "@/lib/services/supabase/purchase-orders";
beforeEach(() => { state.requests = []; state.changed = false; state.failed = false; });

it("loads every receipt beyond a single page with tenant and branch on every request", async () => {
  const rows = await getPurchaseOrderBoard({ branchId: "branch-1", filters: { status: ["ordered", "partial"] } });
  expect(rows).toHaveLength(225);
  expect(state.requests.map(req => [req.from, req.to])).toEqual([[0, 199], [200, 399]]);
  for (const req of state.requests) {
    expect(req.scope).toEqual(expect.arrayContaining([["tenant_id", "tenant-1"], ["branch_id", "branch-1"], ["status", ["ordered", "partial"]]]));
    expect(req.order).toEqual(["created_at", "id"]);
  }
});

it("does not present a changing receipt set as a complete board", async () => {
  state.changed = true;
  await expect(getPurchaseOrderBoard({ branchId: "branch-1" })).rejects.toThrow("Số dòng lịch sử thay đổi");
});

it("does not return a partial board when a later page fails", async () => {
  state.failed = true;
  await expect(getPurchaseOrderBoard({ branchId: "branch-1" })).rejects.toThrow("network failed");
});
