import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/00379_allow_paid_kitchen_orders_to_progress.sql"),
  "utf8",
);

describe("00379 paid kitchen workflow", () => {
  it("keeps authentication, permission, tenant and branch guards", () => {
    expect(sql).toContain("UNAUTHENTICATED");
    expect(sql).toContain("ACTIVE_PROFILE_REQUIRED");
    expect(sql).toContain("pos_fnb.view_orders");
    expect(sql).toContain("user_has_branch_access");
    expect(sql).toContain("ko.tenant_id = v_tenant_id");
  });

  it("does not close kitchen work merely because an invoice exists", () => {
    expect(sql).not.toMatch(/invoice_id\s+is\s+not\s+null\s+or/i);
    expect(sql).toContain("v_item.order_status in ('completed', 'cancelled', 'served')");
    expect(sql).toContain("v_order.status in ('completed', 'cancelled')");
  });

  it("preserves item transitions, all-ready guard and audit logging", () => {
    expect(sql).toContain("v_item.status = 'pending' and p_new_status in ('preparing', 'ready')");
    expect(sql).toContain("v_item.status = 'preparing' and p_new_status = 'ready'");
    expect(sql).toContain("ORDER_ITEMS_NOT_READY");
    expect(sql).toContain("fnb_kitchen_item_status");
    expect(sql).toContain("fnb_kitchen_order_served");
  });

  it("keeps RPC execution restricted to authenticated users", () => {
    expect(sql).toMatch(/revoke all on function public\.fnb_update_kitchen_item_status_v2\(uuid, text\)[\s\S]*from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.fnb_update_kitchen_item_status_v2\(uuid, text\)[\s\S]*to authenticated/i);
    expect(sql).toMatch(/revoke all on function public\.fnb_update_kitchen_order_status_v2\(uuid, text\)[\s\S]*from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.fnb_update_kitchen_order_status_v2\(uuid, text\)[\s\S]*to authenticated/i);
  });

  it("fails closed when prerequisites or postconditions are wrong", () => {
    expect(sql).toContain("FNB_00379_REQUIRED_RPC_MISSING");
    expect(sql).toContain("FNB_00379_REQUIRED_TABLE_MISSING");
    expect(sql).toContain("FNB_00379_PAID_ORDER_GUARD_STILL_ACTIVE");
    expect(sql).toContain("FNB_00379_RPC_PRIVILEGE_CHECK_FAILED");
  });
});
