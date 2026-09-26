import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  getCurrentTenantId: vi.fn(),
  handleError: vi.fn(),
}));
import { cancelProductionOrder } from "@/lib/services/supabase/production";

describe("F&B production cancellation cost guard", () => {
  beforeEach(() => rpc.mockReset());

  it.each([
    ["FNB_PRODUCTION_RETURN_SOURCE_REQUIRED", "Không xác định được mẻ"],
    ["FNB_PRODUCTION_RETURN_HISTORY_REQUIRED", "thiếu lịch sử giá vốn"],
    ["FNB_PRODUCTION_RETURN_QUANTITY_EXCEEDED", "vượt lượng đã xuất"],
  ])("explains %s without a fallback write or retry", async (message, text) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } });
    await expect(cancelProductionOrder("order", "Hủy mẻ thử")).rejects.toThrow(text);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("revert_production_materials", {
      p_production_order_id: "order", p_reason: "Hủy mẻ thử",
    });
  });

  it("retains the successful atomic cancellation result", async () => {
    rpc.mockResolvedValue({ data: { reverted_materials_qty: 4, reverted_cogs: 28 }, error: null });
    await expect(cancelProductionOrder("order", "Hủy mẻ thử")).resolves.toEqual({
      revertedMaterialsQty: 4, revertedCogs: 28,
    });
  });
});
