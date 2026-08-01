import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("atomic input invoice and internal sale state transitions", () => {
  const purchaseEntries = read("src/lib/services/supabase/purchase-entries.ts");
  const internalSales = read("src/lib/services/supabase/internal-sales.ts");
  const serviceBarrel = read("src/lib/services/supabase/index.ts");
  const dialogBarrel = read("src/components/shared/dialogs/index.ts");
  const migration = read(
    "supabase/migrations/00289_atomic_input_invoice_internal_sale_state.sql",
  );

  it("routes active browser mutations through guarded RPCs", () => {
    expect(purchaseEntries).toContain('"set_input_invoice_state_atomic"');
    expect(internalSales).toContain('"cancel_internal_sale_atomic"');

    expect(purchaseEntries).not.toMatch(
      /from\(["']input_invoices["']\)[\s\S]{0,160}\.(?:update|delete)\(/,
    );
    expect(internalSales).not.toMatch(
      /from\(["']internal_sales["']\)[\s\S]{0,160}\.update\(/,
    );
    expect(serviceBarrel).not.toContain("deleteInputInvoice");
  });

  it("derives actor and tenant, locks rows, checks branch/permission and audits", () => {
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).toContain("public.user_has_permission");
    expect(migration).toContain("public.user_has_branch_access");
    expect(migration).toContain("for update");
    expect(migration).toContain("insert into public.audit_log");
    expect(migration).toContain("inventory.adjust");
    expect(migration).toContain("inventory.internal_export");
  });

  it("does not touch stock or cash and revokes direct browser mutation", () => {
    expect(migration).not.toMatch(
      /(?:insert into|update|delete from) public\.(?:branch_stock|stock_movements|product_lots|cash_transactions)/,
    );
    expect(migration).toContain(
      "revoke insert, update, delete on table public.input_invoices from authenticated",
    );
    expect(migration).toContain(
      "revoke insert, update, delete on table public.internal_sales from authenticated",
    );
  });

  it("removes unused unsafe write surfaces from public barrels", () => {
    expect(serviceBarrel).not.toContain('from "./duplicate-services"');
    expect(serviceBarrel).not.toContain("allocateLotsFIFO");
    expect(serviceBarrel).not.toContain("createPurchaseLot");
    expect(dialogBarrel).not.toContain("CreateInvoiceDialog");
  });
});
