import { beforeEach, expect, it, vi } from "vitest";
import { getProductionOrdersForExport } from "@/lib/services/supabase/production";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc }) }));
const item = (n: number) => ({ id: `order-${n}`, code: `SX-${n}`, planned_qty: 12, completed_qty: 10 });
const page = (items: ReturnType<typeof item>[], total: number) => ({ data: { items, total }, error: null });
const filters = { branchId: "fixture-branch", search: "SX", qtyMin: 10 };
const first = Array.from({ length: 200 }, (_, n) => item(n));
beforeEach(() => rpc.mockReset());

it("keeps the same filters and reads all production pages", async () => {
  rpc.mockResolvedValueOnce(page(first, 201)).mockResolvedValueOnce(page([item(200)], 201));
  const rows = await getProductionOrdersForExport(filters);
  expect(rows).toHaveLength(201);
  expect(rows.at(-1)).toMatchObject({ code: "SX-200", plannedQty: 12, completedQty: 10 });
  for (const index of [0, 1]) {
    expect(rpc).toHaveBeenNthCalledWith(index + 1, "get_production_order_list_workspace",
      expect.objectContaining({ p_page: index, p_branch_id: "fixture-branch", p_search: "SX", p_qty_min: 10 }));
  }
});

it("rejects missing and repeated production rows", async () => {
  rpc.mockResolvedValueOnce(page(first, 201)).mockResolvedValueOnce(page([], 201));
  await expect(getProductionOrdersForExport(filters)).rejects.toThrow("Chưa tải đủ");
  rpc.mockResolvedValueOnce(page(first, 201)).mockResolvedValueOnce(page([item(0)], 201));
  await expect(getProductionOrdersForExport(filters)).rejects.toThrow("Lịch sử thay đổi");
});
