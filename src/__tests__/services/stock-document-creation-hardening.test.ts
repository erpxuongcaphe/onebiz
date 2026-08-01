import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("stock document creation hardening", () => {
  const migration = read(
    "supabase/migrations/00256_harden_stock_document_creation.sql",
  );

  it("creates and applies an inventory check in one server transaction", () => {
    expect(migration).toContain(
      "create_and_apply_inventory_check_atomic",
    );
    expect(migration).toContain("public.user_has_permission");
    expect(migration).toContain("'inventory.check'");
    expect(migration).toContain("public.user_has_branch_access");
    expect(migration).toContain("from public.branch_stock");
    expect(migration).toContain("v_system_stock");
    expect(migration).toContain("public.apply_inventory_check_atomic");

    const dialog = read(
      "src/components/shared/dialogs/create-inventory-check-dialog.tsx",
    );
    expect(dialog).toContain(
      '"create_and_apply_inventory_check_atomic"',
    );
    expect(dialog).not.toContain('.from("inventory_checks").insert');
    expect(dialog).not.toContain('.from("inventory_check_items")');
    expect(dialog).not.toContain("system_stock: item.systemStock");
  });

  it("creates transfer header and items atomically with server-derived product data", () => {
    expect(migration).toContain("create_stock_transfer_atomic");
    expect(migration).toContain("'inventory.transfer'");
    expect(migration).toContain("TRANSFER_BRANCHES_INVALID");
    expect(migration).toContain("DUPLICATE_PRODUCT");
    expect(migration).toContain("INSUFFICIENT_SOURCE_STOCK");
    expect(migration).toContain("insert into public.stock_transfer_items");

    const service = read("src/lib/services/supabase/transfers.ts");
    expect(service).toContain('"create_stock_transfer_atomic"');
    expect(service).not.toContain('.from("stock_transfers")\n    .insert');
    expect(service).not.toContain('.from("stock_transfer_items")\n    .insert');
  });

  it("moves and cancels transfer state through an authorized server RPC", () => {
    expect(migration).toContain("set_stock_transfer_state_atomic");
    expect(migration).toContain("TRANSFER_TRANSITION_INVALID");
    expect(migration).toContain("'idempotent', true");
    expect(migration).toContain("insert into public.audit_log");

    const service = read("src/lib/services/supabase/transfers.ts");
    expect(service).toContain('"set_stock_transfer_state_atomic"');
    expect(service).not.toContain('.from("stock_transfers")\n    .update');
  });

  it("does not update existing business rows while applying the migration", () => {
    const beforeFunctions = migration.split(
      "create or replace function public.create_and_apply_inventory_check_atomic",
    )[0];
    expect(beforeFunctions).not.toMatch(
      /\b(update|delete\s+from|insert\s+into)\s+public\.(inventory_checks|stock_transfers)\b/i,
    );
  });
});
