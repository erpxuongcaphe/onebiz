import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00245_harden_purchase_order_rpcs.sql",
  ),
  "utf8",
).toLowerCase();

const service = readFileSync(
  join(
    process.cwd(),
    "src/lib/services/supabase/purchase-orders.ts",
  ),
  "utf8",
);

describe("migration 00245 purchase-order RPC hardening", () => {
  it("guards receive, revert and price edit by effective permissions and branch", () => {
    expect(migration.match(/auth\.uid\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration.match(/user_has_permission/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration.match(/user_has_branch_access/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration.match(/po\.tenant_id = v_tenant_id/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("requires the stronger adjust permission for negative-stock override", () => {
    expect(migration).toContain("negative_stock_override_denied");
    expect(migration).toContain("inventory.adjust");
  });

  it("keeps supplier validation and audit inside guarded price updates", () => {
    expect(migration).toContain("from public.suppliers s");
    expect(migration).toContain("s.tenant_id = v_tenant_id");
    expect(migration).toContain("purchase_price_update");
  });

  it("records missing supplier payment in the same receive transaction", () => {
    expect(migration).toContain("from public.cash_transactions ct");
    expect(migration).toContain("insert into public.cash_transactions");
    expect(migration).toContain("next_cash_code");
    expect(migration).toContain("cash_amount_recorded");
  });

  it("makes the original business implementations private", () => {
    expect(migration).toContain(
      "revoke all on function public._receive_purchase_items_atomic_impl_00102",
    );
    expect(migration).toContain(
      "revoke all on function public._revert_received_purchase_order_impl_00214",
    );
    expect(migration).toContain(
      "revoke all on function public._update_purchase_order_prices_impl_00234",
    );
  });

  it("does not send trusted actor IDs or perform best-effort payment writes", () => {
    expect(service.match(/p_created_by: null/g)?.length).toBeGreaterThanOrEqual(2);
    expect(service).toContain("p_user_id: null");
    expect(service).not.toContain("ensurePurchasePaymentRecorded");
    expect(service).not.toMatch(/PGRST202\|does not exist\|could not find/);
  });
});
