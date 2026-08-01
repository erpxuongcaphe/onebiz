import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  "src/lib/services/supabase/production.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/00283_harden_production_order_lifecycle.sql",
  "utf8",
);

describe("atomic production-order lifecycle", () => {
  it("routes create, status and cancel through guarded RPCs", () => {
    expect(service).toContain('"create_production_order_atomic"');
    expect(service).toContain('"change_production_status_atomic"');
    expect(service).toContain('"revert_production_materials"');
    expect(service).not.toMatch(
      /createProductionOrder[\s\S]{0,3000}\.from\("production_orders"\)[\s\S]{0,300}\.insert\(/,
    );
    expect(service).not.toMatch(
      /cancelProductionOrder[\s\S]{0,1800}\.from\("production_orders"\)[\s\S]{0,220}\.update\(/,
    );
  });

  it("derives actor and tenant, checks permissions and branch access", () => {
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).toContain("production.create_order");
    expect(migration).toContain("production.complete_order");
    expect(migration).toContain("production.cancel_order");
    expect(migration).toContain("user_has_branch_access");
  });

  it("keeps order creation and materials in one database transaction", () => {
    expect(migration).toContain("create_production_order_atomic");
    expect(migration).toContain("insert into public.production_orders");
    expect(migration).toContain("insert into public.production_order_materials");
    expect(migration).toContain("PRODUCTION_MATERIALS_INVALID");
    expect(migration).toContain("PRODUCTION_MATERIAL_DUPLICATED");
  });

  it("cannot mark complete or cancelled through a status-only write", () => {
    expect(migration).toContain("USE_PRODUCTION_STOCK_FLOW");
    expect(service).toContain("Hãy dùng nút Hoàn thành");
    expect(service).toContain("Hãy dùng nút Hủy");
  });

  it("restores branch stock atomically and never uses the legacy note column", () => {
    expect(migration).toContain(
      "on conflict (tenant_id, branch_id, product_id) where variant_id is null",
    );
    expect(migration).toContain("notes = concat_ws");
    expect(migration).not.toMatch(/\n\s*note\s*=\s*case/);
    expect(migration).toContain("CANCEL_REASON_REQUIRED");
  });

  it("blocks direct browser access to low-level stock functions", () => {
    expect(migration).toContain(
      "revoke all on function public.consume_production_materials(uuid)",
    );
    expect(migration).toContain(
      "revoke all on function public.complete_production_order(uuid, numeric, text, date, date)",
    );
    expect(migration).toContain("from public, anon, authenticated");
  });
});
