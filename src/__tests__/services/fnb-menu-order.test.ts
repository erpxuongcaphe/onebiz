import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => ({ rpc }), getCurrentTenantId: async () => "tenant" }));
import { moveMenuEntry, saveFnbMenuOrder } from "@/lib/services/supabase/fnb-menu-order";
describe("shared FnB menu ordering", () => {
  beforeEach(() => rpc.mockReset());
  const rows = [{ id: "a", category_id: "coffee" }, { id: "hidden-other-group", category_id: "tea" }, { id: "b", category_id: "coffee" }];
  it("moves only within the chosen category, preserving other groups and input", () => {
    expect(moveMenuEntry(rows, "b", "up", row => row.category_id).map(row => row.id)).toEqual(["b", "hidden-other-group", "a"]);
    expect(rows.map(row => row.id)).toEqual(["a", "hidden-other-group", "b"]);
    expect(moveMenuEntry(rows, "a", "up", row => row.category_id)).toBe(rows);
    expect(moveMenuEntry(rows, "missing", "up")).toBe(rows);
  });
  it("handles tied original ranks and sends one atomic request with the original snapshot", async () => {
    rpc.mockResolvedValue({ error: null });
    const original = { categories: [], products: rows.map(row => ({ ...row, name: row.id, sort_order: 0 })) };
    const next = { ...original, products: moveMenuEntry(original.products, "b", "up", row => row.category_id) };
    await saveFnbMenuOrder(original, next);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("save_fnb_menu_order_atomic", { p_original: original, p_category_ids: [], p_product_ids: ["b", "hidden-other-group", "a"] });
  });
  it("reports a concurrent edit without pretending to save", async () => {
    rpc.mockResolvedValue({ error: { message: "MENU_ORDER_CONFLICT" } });
    await expect(saveFnbMenuOrder({ categories: [], products: [] }, { categories: [], products: [] })).rejects.toThrow("người khác sửa");
  });
  it("reports an unapplied migration", async () => {
    rpc.mockResolvedValue({ error: { code: "PGRST202", message: "not found" } });
    await expect(saveFnbMenuOrder({ categories: [], products: [] }, { categories: [], products: [] })).rejects.toThrow("Chưa lưu thay đổi");
  });
});
