import { beforeEach, expect, it, vi } from "vitest";
import { getInventoryChecksForExport } from "@/lib/services/supabase/inventory";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc }) }));

const page = (ids: string[], total: number) => ({
  data: { items: ids.map(id => ({ id, code: id })), total },
  error: null,
});
const full = Array.from({ length: 200 }, (_, i) => `check-${i}`);
const filters = { branchId: "fixture-branch", search: "check" };
beforeEach(() => rpc.mockReset());

it("exports all rows using the same branch and filter on every page", async () => {
  rpc.mockResolvedValueOnce(page(full, 201)).mockResolvedValueOnce(page(["check-200"], 201));
  expect(await getInventoryChecksForExport(filters)).toHaveLength(201);
  for (const index of [0, 1]) {
    expect(rpc).toHaveBeenNthCalledWith(index + 1, "get_inventory_check_list_workspace",
      expect.objectContaining({ p_page: index, p_branch_id: filters.branchId, p_search: filters.search }));
  }
});

it("rejects missing pages rather than exporting a partial file", async () => {
  rpc.mockResolvedValueOnce(page(full, 201)).mockResolvedValueOnce(page([], 201));
  await expect(getInventoryChecksForExport(filters)).rejects.toThrow("Chưa tải đủ phiếu kiểm kho");
});

it("rejects duplicate IDs and inconsistent totals", async () => {
  rpc.mockResolvedValueOnce(page(full, 201)).mockResolvedValueOnce(page([full[0]], 201));
  await expect(getInventoryChecksForExport(filters)).rejects.toThrow("Dữ liệu kiểm kho đã thay đổi");
  rpc.mockResolvedValueOnce(page(full, 201)).mockResolvedValueOnce(page([], 200));
  await expect(getInventoryChecksForExport(filters)).rejects.toThrow("Số phiếu kiểm kho đã thay đổi");
});
