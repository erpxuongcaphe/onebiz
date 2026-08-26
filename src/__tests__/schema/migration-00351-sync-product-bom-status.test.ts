import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/00351_sync_product_bom_status.sql"),
  "utf8",
);
const rollback = readFileSync(
  resolve(process.cwd(), "supabase/migrations/00351_rollback_sync_product_bom_status.sql"),
  "utf8",
);
const preflight = readFileSync(
  resolve(process.cwd(), "docs/qc/sql/00351-FNB-BOM-LINK-PREFLIGHT-READONLY.sql"),
  "utf8",
);
const postflight = readFileSync(
  resolve(process.cwd(), "docs/qc/sql/00351-FNB-BOM-LINK-POSTFLIGHT-READONLY.sql"),
  "utf8",
);

function withoutComments(sql: string) {
  return sql.replace(/^\s*--.*$/gm, "");
}

describe("00351 - sync product BOM status", () => {
  it("derives the flag from a usable active BOM instead of trusting stale data", () => {
    expect(migration).toContain("sync_product_has_bom_from_active_bom");
    expect(migration).toContain("get_active_bom_for_branch");
    expect(migration).toContain("exists (\n         select 1\n           from public.bom_items bi");
    expect(migration).toContain("and bi.material_id = p_product_id");
    expect(migration).toContain("update public.products");
  });

  it("keeps self-referential and empty BOMs out of the live flag", () => {
    expect(migration).toContain("BOM tu chua chinh SKU bi loai tru");
    expect(migration).toContain("and not exists (\n         select 1\n           from public.bom_items bi");
    expect(migration).toContain("and exists (\n         select 1\n           from public.bom_items bi");
  });

  it("updates the flag after both header and item changes, then verifies every product", () => {
    expect(migration).toContain("trg_sync_product_bom_status_00351");
    expect(migration).toContain("trg_sync_product_bom_status_item_00351");
    expect(migration).toContain("after insert or delete or update of tenant_id, product_id, code, is_active");
    expect(migration).toContain("after insert or update or delete on public.bom_items");
    expect(migration).toContain("FNB_00351_PRODUCT_BOM_FLAG_MISMATCH");
    expect(migration).toContain("begin;");
    expect(migration).toContain("commit;");
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });

  it("ships a rollback that only stops future syncing, not inventory or documents", () => {
    expect(rollback).toContain("FNB_00351_ROLLBACK_SYNC_NOT_INSTALLED");
    expect(rollback).toContain("drop trigger if exists trg_sync_product_bom_status_item_00351");
    expect(rollback).toContain("drop function if exists public.sync_product_has_bom_from_active_bom(uuid)");
    expect(withoutComments(rollback)).not.toMatch(/stock_movements|invoice_items|kitchen_orders/i);
  });

  it("provides read-only checks for the actual OneBiz test tenant", () => {
    expect(preflight).toContain("148e8ac5-b891-4de3-9055-cfa41f39ddb0");
    expect(preflight).toContain("P2_CO_BOM_LECH_FLAG");
    expect(postflight).toContain("K1_KHONG_CON_LECH_FLAG");
    expect(postflight).toContain("K2_HONG_TRA_XTB_CO_BOM");
  });
});
