import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/00247_atomic_supplier_return.sql"),
  "utf8",
).toLowerCase();

const service = readFileSync(
  join(process.cwd(), "src/lib/services/supabase/purchase-entries.ts"),
  "utf8",
);

const dialog = readFileSync(
  join(
    process.cwd(),
    "src/components/shared/dialogs/create-purchase-return-dialog.tsx",
  ),
  "utf8",
);

describe("migration 00247 atomic supplier return", () => {
  it("derives actor, tenant, branch and permission on the server", () => {
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("po.tenant_id = v_tenant_id");
    expect(migration).toContain("user_has_permission");
    expect(migration).toContain("user_has_branch_access");
  });

  it("locks the purchase order and source lines before quantity checks", () => {
    expect(migration.match(/for update/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("duplicate_return_item");
    expect(migration).toContain("return_line_quantity_exceeded");
    expect(migration).toContain("return_product_quantity_exceeded");
  });

  it("tracks child rows through their parent and source purchase line", () => {
    expect(migration).toContain("add column if not exists purchase_order_item_id");
    expect(migration).toContain("join public.supplier_returns sr");
    expect(migration).toContain("sr.tenant_id = v_tenant_id");
    expect(migration).not.toContain("sri.tenant_id");
  });

  it("commits document, stock, debt, cash and audit together", () => {
    expect(migration).toContain("insert into public.supplier_returns");
    expect(migration).toContain("insert into public.supplier_return_items");
    expect(migration).toContain("update public.branch_stock");
    expect(migration).toContain("insufficient_branch_stock");
    expect(migration).toContain("update public.purchase_orders");
    expect(migration).toContain("insert into public.cash_transactions");
    expect(migration).toContain("insert into public.audit_log");
  });

  it("keeps trusted commercial values out of the browser payload", () => {
    expect(service).toContain('rpc("create_supplier_return_atomic"');
    expect(service).toContain("purchaseOrderItemId");
    expect(service).not.toContain("completeSupplierReturn:insert_return");
    expect(service).not.toContain("completeSupplierReturn:cash_receipt");
    expect(dialog).not.toContain("purchaseOrderCode: selectedPO");
    expect(dialog).not.toContain("supplierName: selectedPO");
    expect(dialog).toContain('.eq("branch_id", ctx.branchId)');
  });
});
