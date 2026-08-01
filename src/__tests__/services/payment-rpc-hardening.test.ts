import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00242_harden_payment_atomic_auth.sql",
  ),
  "utf8",
).toLowerCase();

describe("migration 00242 payment RPC hardening", () => {
  it("derives the actor from auth and blocks cross-tenant or cross-branch writes", () => {
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("finance.create_transaction");
    expect(sql).toContain("user_has_branch_access");
    expect(sql).toContain("i.tenant_id = v_actor_tenant");
    expect(sql).toContain("po.tenant_id = v_actor_tenant");
    expect(sql).toContain("actor_spoof_blocked");
    expect(sql).toContain("branch_spoof_blocked");
    expect(sql).not.toContain("coalesce(p_user_id, auth.uid())");
  });

  it("keeps cash code generation and audit inside the atomic transaction", () => {
    expect(sql.match(/next_cash_code/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql.match(/insert into public\.audit_log/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("'atomic', true");
    expect(sql).not.toMatch(/max\s*\(\s*cast\s*\(\s*regexp_replace\s*\(\s*code/);
  });

});
