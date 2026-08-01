import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00246_harden_stock_document_rpcs.sql",
  ),
  "utf8",
).toLowerCase();
const stockService = readFileSync(
  join(process.cwd(), "src/lib/services/supabase/stock-adjustments.ts"),
  "utf8",
);
const inventoryService = readFileSync(
  join(process.cwd(), "src/lib/services/supabase/inventory.ts"),
  "utf8",
);
const exportCreationMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00268_atomic_internal_disposal_export_create.sql",
  ),
  "utf8",
).toLowerCase();

describe("migration 00246 stock RPC hardening", () => {
  it("guards all five stock mutators by auth, permission and branch", () => {
    expect(migration.match(/auth\.uid\(\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(migration.match(/user_has_permission/g)?.length).toBeGreaterThanOrEqual(5);
    expect(migration.match(/user_has_branch_access/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("uses explicit permissions for each manual stock reason", () => {
    expect(migration).toContain("when 'stock_adjustment' then 'inventory.adjust'");
    expect(migration).toContain("when 'supplier_return' then 'inventory.create_po'");
    expect(migration).toContain("when 'disposal_export' then 'inventory.dispose'");
    expect(migration).toContain(
      "when 'internal_export' then 'inventory.internal_export'",
    );
    expect(migration).toContain("stock_reference_type_not_allowed");
  });

  it("enforces inventory lock and blocks menu-stock escape", () => {
    expect(migration).toContain("inventory_lock");
    expect(migration).toContain("inventory_locked");
    expect(migration).toContain("menu_stock_override_denied");
  });

  it("makes the old high-privilege implementations private", () => {
    expect(migration.match(/revoke all on function public\._/g)?.length).toBe(5);
  });

  it("does not trust tenant or actor from the browser", () => {
    expect(stockService).toContain("p_tenant_id: null");
    expect(stockService).toContain("p_created_by: null");
    expect(stockService).not.toContain("recordAuditLog");
    expect(exportCreationMigration).toContain("v_actor uuid := auth.uid()");
    expect(exportCreationMigration).toContain(
      "select p.tenant_id into v_tenant_id",
    );
    expect(exportCreationMigration).toContain("user_has_branch_access");
  });

  it("creates and applies each stock export in one server transaction", () => {
    expect(inventoryService).toContain('"create_internal_export_atomic"');
    expect(inventoryService).toContain('"create_disposal_export_atomic"');
    expect(inventoryService).not.toMatch(
      /from\("internal_exports"\)[\s\S]{0,300}\.insert\(/,
    );
    expect(inventoryService).not.toMatch(
      /from\("disposal_exports"\)[\s\S]{0,300}\.insert\(/,
    );
    expect(exportCreationMigration).toContain("security definer");
    expect(exportCreationMigration).toContain("for update");
  });
});
