import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00254_harden_invoice_shipping_atomic.sql",
  "utf8",
);
const service = readFileSync(
  "src/lib/services/supabase/shipping.ts",
  "utf8",
);

describe("Invoice shipping atomic hardening", () => {
  it("derives tenant, actor, invoice totals and debt on the server", () => {
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).toContain("public.get_user_tenant_id()");
    expect(migration).toContain("for update");
    expect(migration).toContain("public.user_has_branch_access");
    expect(migration).toContain("v_new_total := greatest");
    expect(migration).toContain("v_new_debt := greatest");
  });

  it("updates the invoice, shipment and audit in one transaction", () => {
    expect(migration).toContain("update public.invoices");
    expect(migration).toContain("insert into public.shipping_orders");
    expect(migration).toContain("insert into public.audit_log");
    expect(migration).toContain("'idempotent', true");
  });

  it("removes client-side multi-step shipping writes", () => {
    expect(service).toContain('"attach_invoice_shipment_atomic"');
    expect(service).not.toMatch(
      /\.from\("invoices"\)[\s\S]{0,500}\.update\(/,
    );
    expect(service).not.toMatch(
      /\.from\("shipping_orders"\)[\s\S]{0,500}\.insert\(/,
    );
    expect(service).not.toContain(".from(\"customers\")");
  });
});
