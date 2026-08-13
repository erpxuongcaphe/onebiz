import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/00320_uom_accounting_snapshots.sql"),
  "utf8",
);
const purchaseService = readFileSync(
  join(root, "src/lib/services/supabase/purchase-orders.ts"),
  "utf8",
);
const uomService = readFileSync(
  join(root, "src/lib/services/supabase/uom.ts"),
  "utf8",
);
const productDialog = readFileSync(
  join(root, "src/components/shared/dialogs/create-product-dialog.tsx"),
  "utf8",
);

describe("UOM accounting contract", () => {
  it("keeps transaction snapshots separate from normalized stock values", () => {
    expect(migration).toContain("transaction_quantity");
    expect(migration).toContain("transaction_unit_price");
    expect(migration).toContain("conversion_factor");
    expect(migration).toContain("round(v_input_quantity * v_factor, 4)");
    expect(migration).toContain(
      "v_normalized_price := (v_input_quantity * v_input_price) / v_normalized_quantity",
    );
    expect(migration).toContain("alter column unit_price type numeric(24,8)");
    expect(migration).toContain("transaction_unit_price numeric(24,8)");
  });

  it("resolves factors on the server and rejects ambiguous conversions", () => {
    expect(migration).toContain("resolve_product_uom_factor");
    expect(migration).toContain("UOM_CONVERSION_AMBIGUOUS");
    expect(migration).toContain("idx_uom_conversions_active_pair_unique");
  });

  it("replaces conversion configuration atomically with permission and audit", () => {
    expect(migration).toContain("replace_product_uom_conversions_atomic");
    expect(migration).toContain("PRODUCT_UOM_MUST_CONNECT_TO_STOCK_UNIT");
    expect(migration).toContain("product_uom_conversions_replaced");
    expect(migration).toContain("user_has_permission(v_actor, 'products.edit')");
    expect(migration).toContain(
      "revoke insert, update, delete on table public.uom_conversions",
    );
    expect(uomService).toContain('"replace_product_uom_conversions_atomic"');
    expect(uomService).not.toContain('.from("uom_conversions").insert');
    expect(productDialog).toContain("replaceProductUOMConversions");
    expect(productDialog).not.toContain("createUOMConversion");
    expect(migration).toContain("v_old_stock_unit := trim(v_stock_unit)");
    expect(migration).toContain(
      "jsonb_build_object('stock_unit', v_old_stock_unit, 'conversions', v_old_data)",
    );
  });

  it("locks the canonical stock unit after accounting history exists", () => {
    expect(migration).toContain("PRODUCT_STOCK_UNIT_LOCKED_BY_HISTORY");
    expect(migration).toContain("from public.stock_movements");
    expect(migration).toContain("from public.purchase_order_items");
    expect(migration).toContain("from public.invoice_items");
  });

  it("normalizes BOM items before they can affect inventory", () => {
    expect(migration).toContain("trg_normalize_bom_item_uom_00320");
    expect(migration).toContain("BOM_MATERIAL_TENANT_MISMATCH");
    expect(migration).toContain("new.unit := v_stock_unit");
  });

  it("routes purchase writes through the UOM-aware atomic wrapper", () => {
    expect(purchaseService).toContain('"save_purchase_order_with_uom_atomic"');
    expect(purchaseService).toContain('"update_purchase_order_prices_with_uom"');
    expect(purchaseService).toContain('"receive_purchase_items_with_uom_atomic"');
    expect(purchaseService).not.toContain('rpc as any)(\n    "save_purchase_order_atomic"');
    expect(migration).toContain("where po.id = p_order_id and po.tenant_id = v_tenant_id");
    expect(migration).toContain("user_has_branch_access(v_actor, v_branch_id)");
  });
});
