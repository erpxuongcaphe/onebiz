import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/00392_fnb_prepared_batch_completion_cost.sql",
  "utf8",
);

describe("F&B prepared batch completion cost", () => {
  it("changes only future completion RPC behavior for opted-in prepared stock", () => {
    expect(sql).toContain("rename to _complete_production_cost_impl_00392");
    expect(sql).toContain("coalesce(v_order.is_fnb_stock_item, false)");
    expect(sql).toContain("_fnb_branch_cost_tracking_enabled_00390");
    expect(sql).toContain("return public._complete_production_cost_impl_00392(");
    expect(sql).not.toMatch(/update public\.(products|invoices|stock_movements)\b/i);
  });

  it("refreshes only order-material cost after checking branch stock and ledger", () => {
    expect(sql).toContain("coalesce(pom.actual_qty, pom.planned_qty)");
    expect(sql).toContain("abs(v_costed_qty - v_physical_qty) > 0.0001");
    expect(sql).toContain("v_costed_qty + 0.0001 < v_material.quantity");
    expect(sql).toContain("set unit_cost = v_unit_cost");
    expect(sql).toContain("for update;");
  });
});
