import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  getCurrentTenantId: vi.fn(),
  handleError: (error: { message: string }, context: string) => {
    throw new Error(`[${context}] ${error.message}`);
  },
}));

import { splitByItems, splitEqually } from "@/lib/services/supabase/split-bill";

const splitMigration = readFileSync(
  "supabase/migrations/00273_atomic_fnb_split_bill.sql",
  "utf8",
);
const tableGuardMigration = readFileSync(
  "supabase/migrations/00274_fnb_split_table_payment_guard.sql",
  "utf8",
);
const service = readFileSync(
  "src/lib/services/supabase/split-bill.ts",
  "utf8",
);
const page = readFileSync("src/app/pos/fnb/page.tsx", "utf8");

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: {
      parent_items_left: 2,
      parent_discount_amount: 60_000,
      children: [
        {
          order_id: "child-1",
          order_number: "KB001-B",
          item_count: 1,
          discount_amount: 40_000,
        },
      ],
    },
    error: null,
  });
});

describe("atomic F&B split bill", () => {
  it("splits selected items through one RPC", async () => {
    const result = await splitByItems("order-1", ["item-1"]);

    expect(result).toEqual({
      childOrderId: "child-1",
      childDiscountAmount: 40_000,
      parentItemsLeft: 2,
      parentDiscountAmount: 60_000,
    });
    expect(rpc).toHaveBeenCalledWith("split_kitchen_order_atomic", {
      p_order_id: "order-1",
      p_mode: "items",
      p_item_ids: ["item-1"],
      p_number_of_ways: null,
    });
  });

  it("splits equally through the same guarded RPC", async () => {
    await splitEqually("order-1", 2);
    expect(rpc).toHaveBeenCalledWith("split_kitchen_order_atomic", {
      p_order_id: "order-1",
      p_mode: "equal",
      p_item_ids: null,
      p_number_of_ways: 2,
    });
  });

  it("locks, authorizes and audits every split", () => {
    expect(splitMigration).toContain("for update");
    expect(splitMigration).toContain("pos_fnb.split_bill");
    expect(splitMigration).toContain("user_has_branch_access");
    expect(splitMigration).toContain("SPLIT_ITEM_NOT_IN_ORDER");
    expect(splitMigration).toContain("SPLIT_CONCURRENT_CHANGE");
    expect(splitMigration).toContain("fnb_split_bill");
    expect(splitMigration).toContain("parent_discount_amount");
  });

  it("removes browser-side split writes and keeps split table occupied", () => {
    expect(service).not.toContain('.from("kitchen_orders").insert');
    expect(service).not.toContain('.from("kitchen_order_items").update');
    expect(tableGuardMigration).toContain("v_next_order_id");
    expect(tableGuardMigration).toContain("current_order_id = v_next_order_id");
    // Sau khi tách, giảm giá phải nạp lại từ snapshot máy chủ của từng đơn.
    // Không giữ số giảm giá cũ trên tab vì người dùng có thể chuyển ca/máy.
    expect(page).toContain("persistedOrderDiscountAmount: order.discountAmount");
    expect(page).toContain("await loadChildOrderIntoTab(result.childOrderId, newTabId)");
    expect(page).toContain("await hydrateKitchenOrderIntoTab(tab.kitchenOrderId, tab.id, true)");
  });
});
