import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync("src/lib/services/supabase/orders.ts", "utf8");
const dialog = readFileSync(
  "src/components/shared/dialogs/create-order-dialog.tsx",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/00265_atomic_sales_order_save.sql",
  "utf8",
);

describe("atomic sales-order draft save", () => {
  it("keeps actor and tenant derivation on the server", () => {
    expect(service).toContain('"save_sales_order_atomic"');
    expect(service).toContain("p_order_id: input.orderId ?? null");
    expect(service).not.toContain("p_actor_id: input");
    expect(service).not.toContain("p_tenant_id: input");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("user_has_permission(v_actor, 'orders.create')");
    expect(migration).toContain("user_has_branch_access(v_actor, v_branch_id)");
  });

  it("locks edits and validates all linked entities before writing", () => {
    expect(migration).toContain("for update");
    expect(migration).toContain("ORDER_NOT_EDITABLE");
    expect(migration).toContain("ORDER_CUSTOMER_INVALID");
    expect(migration).toContain("DELIVERY_PARTNER_INVALID");
    expect(migration).toContain("ORDER_PRODUCT_INVALID");
    expect(migration).toContain("SHIPMENT_RECEIVER_INCOMPLETE");
    expect(migration).toContain("insert into public.audit_log");
  });

  it("uses one RPC instead of separate header, item and shipment mutations", () => {
    expect(dialog).toContain("saveSalesOrderAtomic({");
    expect(dialog).not.toMatch(/\.from\("invoices"\)[\s\S]{0,160}\.(insert|update)\(/);
    expect(dialog).not.toMatch(/\.from\("invoice_items"\)[\s\S]{0,160}\.(insert|delete)\(/);
    expect(dialog).not.toMatch(/\.from\("shipping_orders"\)[\s\S]{0,160}\.(insert|update)\(/);
    expect(dialog).toContain("errors.receiver");
  });
});
