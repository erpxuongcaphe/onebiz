import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/00387_fnb_supply_catalog_opt_in_enforcement.sql"),
  "utf8",
).toLowerCase();

describe("00387 F&B supply catalog opt-in enforcement", () => {
  it("keeps enforcement disabled until an administrator explicitly enables a store", () => {
    expect(migration).toContain("enforcement_enabled boolean not null default false");
    expect(migration).toContain("fnb_supply_store_required");
    expect(migration).toContain("fnb_supply_catalog_empty");
    expect(migration).toContain("products.edit");
    expect(migration).toContain("system.manage_branches");
  });

  it("keeps scope and audit tables read-only to browser users", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.fnb_supply_branch_scopes");
    expect(migration).toContain("grant select on public.fnb_supply_branch_scopes");
    expect(migration).toContain("fnb_supply_branch_scope_audit");
  });

  it("validates before preserving the existing atomic internal-sale implementation", () => {
    expect(migration).toContain("fnb_supply_catalog_required");
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended('fnb-supply:'");
    expect(migration).toContain("public._create_internal_sale_auth_impl_00243");
    expect(migration).toContain("public._reconcile_product_lots_to_branch_00284");
    expect(migration).not.toMatch(/insert\s+into\s+public\.stock_movements/);
  });
});
