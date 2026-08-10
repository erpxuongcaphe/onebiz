import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00307_atomic_customer_code_change.sql",
  "utf8",
).toLowerCase();

describe("00307 secure customer-code change", () => {
  it("checks active actor, effective permission and tenant-owned customer", () => {
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("coalesce(p.is_active, true)");
    expect(migration).toContain("user_has_permission(v_actor, 'customers.edit')");
    expect(migration).toContain("c.tenant_id = v_profile.tenant_id");
  });

  it("blocks system customers and duplicate codes", () => {
    expect(migration).toContain("coalesce(v_customer.is_internal, false)");
    expect(migration).toContain("v_customer.code = 'kl-vl'");
    expect(migration).toContain("customer_code_duplicate");
    expect(migration).toContain("when unique_violation");
  });

  it("updates only code metadata and records immutable audit", () => {
    expect(migration).toMatch(/update public\.customers c\s+set code = v_new_code,\s+updated_at = now\(\)/);
    expect(migration).toContain("'customer_code_changed'");
    expect(migration).toContain("jsonb_build_object('code', v_customer.code)");
    expect(migration).toContain("jsonb_build_object('code', v_new_code, 'atomic', true)");
    expect(migration).not.toMatch(/set\s+(debt|total_spent|total_orders)\s*=/);
  });

  it("does not expose the RPC to anonymous callers", () => {
    expect(migration).toContain(
      "revoke all on function public.change_customer_code_atomic(uuid, text) from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.change_customer_code_atomic(uuid, text) to authenticated",
    );
  });
});
