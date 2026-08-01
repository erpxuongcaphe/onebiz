import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00248_harden_supplier_and_po_close.sql",
  ),
  "utf8",
).toLowerCase();

describe("migration 00248 supplier and PO-close hardening", () => {
  it("blocks actor spoofing and requires effective permissions", () => {
    expect(migration.match(/auth.uid()/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration.match(/actor_spoof_blocked/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("suppliers.delete");
    expect(migration).toContain("inventory.create_po");
    expect(migration.match(/user_has_permission/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("scopes supplier deletion to the active tenant", () => {
    expect(migration).toContain("s.tenant_id = v_tenant_id");
    expect(migration).toContain("po.tenant_id = v_tenant_id");
    expect(migration).toContain("p.tenant_id = v_tenant_id");
    expect(migration).toContain("sr.tenant_id = v_tenant_id");
  });

  it("checks PO branch access, locks state and detects concurrent close", () => {
    expect(migration).toContain("user_has_branch_access");
    expect(migration.match(/for update/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("po_status_race_detected");
    expect(migration).toContain("purchase_order_id = p_order_id");
  });

  it("keeps audit writes in the same transaction", () => {
    expect(migration.match(/insert into public.audit_log/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("begin;");
    expect(migration).toContain("commit;");
  });
});
