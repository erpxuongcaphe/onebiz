import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getMergeOrderErrorMessage } from "@/lib/services/supabase/kitchen-orders";

const migration = readFileSync(
  "supabase/migrations/00322_atomic_fnb_merge_orders.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/migrations/00322_rollback_atomic_fnb_merge_orders.sql",
  "utf8",
);
const service = readFileSync(
  "src/lib/services/supabase/kitchen-orders.ts",
  "utf8",
);

describe("FnB order merge security contract", () => {
  it("derives actor scope and checks effective table-management access", () => {
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).toContain("coalesce(p.is_active, true)");
    expect(migration).toContain("pos_fnb.manage_tables");
    expect(migration).toContain("user_has_branch_access");
  });

  it("locks orders and tables before moving items", () => {
    expect(migration.match(/for update/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("order by ko.id");
    expect(migration).toContain("order by rt.id");
    expect(migration.indexOf("for update")).toBeLessThan(
      migration.indexOf("update public.kitchen_order_items"),
    );
  });

  it("moves batches, preserves discounts and audits the atomic operation", () => {
    expect(migration).toContain("update public.fnb_kitchen_item_batches");
    expect(migration).toContain("discount_amount = greatest");
    expect(migration).toContain("'fnb_merge_orders'");
    expect(migration).toContain("'atomic', true");
  });

  it("removes the legacy browser-side merge sequence", () => {
    const start = service.indexOf("export async function mergeKitchenOrders");
    const end = service.indexOf("// Giảm giá", start);
    const implementation = service.slice(start, end);
    expect(implementation).toContain('"merge_kitchen_orders_atomic"');
    expect(implementation).not.toContain('.from("kitchen_order_items")');
    expect(implementation).not.toContain('.from("restaurant_tables")');
  });

  it.each([
    [
      "FNB_MERGE_SOURCE_TABLE_STALE",
      "Bàn hoặc đơn vừa thay đổi. Vui lòng tải lại sơ đồ bàn.",
    ],
    [
      "FNB_MERGE_SOURCE_NOT_ELIGIBLE",
      "Chỉ gộp được các đơn tại quán chưa thanh toán và còn món.",
    ],
    [
      "FNB_MERGE_PERMISSION_REQUIRED",
      "Anh/chị không có quyền gộp các đơn này.",
    ],
  ])("translates %s into Vietnamese guidance", (code, message) => {
    expect(getMergeOrderErrorMessage({ message: code })).toBe(message);
  });

  it("rollback disables merge without restoring client-side writes", () => {
    expect(rollback).toContain("drop function if exists");
    expect(rollback).not.toContain("create or replace function");
  });
});
