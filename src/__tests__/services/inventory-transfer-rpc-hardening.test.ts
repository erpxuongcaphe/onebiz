import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/00249_harden_inventory_check_transfer.sql",
  ),
  "utf8",
).toLowerCase();

const inventoryService = readFileSync(
  join(process.cwd(), "src/lib/services/supabase/inventory.ts"),
  "utf8",
);
const transferService = readFileSync(
  join(process.cwd(), "src/lib/services/supabase/transfers.ts"),
  "utf8",
);

describe("migration 00249 inventory and transfer hardening", () => {
  it("keeps old business implementations private", () => {
    expect(migration).toContain("rename to _apply_inventory_check_impl_00056");
    expect(migration).toContain("rename to _complete_stock_transfer_impl_00056");
    expect(migration).toContain(
      "revoke all on function public._apply_inventory_check_impl_00056",
    );
    expect(migration).toContain(
      "revoke all on function public._complete_stock_transfer_impl_00056",
    );
  });

  it("derives actor and enforces effective permission and branch access", () => {
    expect(migration.match(/auth.uid()/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("inventory.check");
    expect(migration).toContain("inventory.transfer");
    expect(migration.match(/user_has_permission/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration.match(/user_has_branch_access/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration.match(/actor_spoof_blocked/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("blocks direct menu stock and transfer beyond source stock", () => {
    expect(migration.match(/menu_no_direct_stock/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("insufficient_source_stock");
    expect(migration).toContain("from public.branch_stock bs");
    expect(migration.match(/for update/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("records audit in the transaction instead of best effort in the browser", () => {
    expect(migration.match(/insert into public.audit_log/g)?.length).toBeGreaterThanOrEqual(2);
    expect(inventoryService).not.toContain("void recordAuditLog");
    expect(transferService).not.toContain("void recordAuditLog");
  });
});
