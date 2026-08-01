import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00243_harden_internal_sale_atomic.sql",
  ),
  "utf8",
).toLowerCase();

describe("migration 00243 internal sale RPC hardening", () => {
  it("derives authorization context and validates both branches", () => {
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("inventory.internal_export");
    expect(sql.match(/user_has_branch_access/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("tenant_spoof_blocked");
    expect(sql).toContain("actor_spoof_blocked");
  });

  it("derives internal parties and product details from tenant-owned rows", () => {
    expect(sql).toContain("from public.customers c");
    expect(sql).toContain("from public.suppliers s");
    expect(sql).toContain("from public.products p");
    expect(sql).toContain("c.tenant_id = v_tenant_id");
    expect(sql).toContain("s.tenant_id = v_tenant_id");
    expect(sql).toContain("p.tenant_id = v_tenant_id");
  });

  it("keeps stock, money, linked documents and audit in one transaction", () => {
    expect(sql).toContain("begin;");
    expect(sql).toContain("insert into public.invoices");
    expect(sql).toContain("insert into public.input_invoices");
    expect(sql).toContain("insert into public.stock_movements");
    expect(sql.match(/insert into public\.cash_transactions/g)?.length).toBe(2);
    expect(sql).toContain("insert into public.internal_sales");
    expect(sql).toContain("insert into public.audit_log");
    expect(sql).toContain("commit;");
  });

  it("uses collision-safe cash codes and blocks direct calls to stock helper", () => {
    expect(sql.match(/next_cash_code/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).not.toMatch(/max\s*\(\s*cast\s*\(\s*regexp_replace\s*\(\s*code/);
    expect(sql).toContain(
      "revoke all on function public.internal_sale_apply_stock_out",
    );
    expect(sql).toContain("from public, anon, authenticated");
  });

  it("normalizes payment method and preserves unpaid/debt behavior", () => {
    expect(sql).toContain("v_requested_payment_method");
    expect(sql).toContain("coalesce(p_paid_full, false)");
    expect(sql).toContain("invalid_payment_method");
  });
});
