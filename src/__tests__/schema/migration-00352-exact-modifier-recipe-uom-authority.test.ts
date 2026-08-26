import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/00352_exact_modifier_recipe_uom_authority.sql"),
  "utf8",
);
const rollback = readFileSync(
  resolve(process.cwd(), "supabase/migrations/00352_rollback_exact_modifier_recipe_uom_authority.sql"),
  "utf8",
);
const preflight = readFileSync(
  resolve(process.cwd(), "docs/qc/sql/00352-FNB-EXACT-UOM-PREFLIGHT-READONLY.sql"),
  "utf8",
);
const postflight = readFileSync(
  resolve(process.cwd(), "docs/qc/sql/00352-FNB-EXACT-UOM-POSTFLIGHT-READONLY.sql"),
  "utf8",
);

function executable(sql: string) {
  return sql.replace(/^\s*--.*$/gm, "");
}

describe("00352 - exact FnB recipe UOM authority", () => {
  it("accepts only the operator input quantity and the matching BOM input unit", () => {
    expect(migration).toContain("v_input_quantity := (v_row->>'inputQuantity')::numeric");
    expect(migration).toContain("v_input_unit := nullif(trim(v_row->>'inputUnit'), '')");
    expect(migration).toContain("FNB_EXACT_RECIPE_INPUT_REQUIRED");
    expect(migration).toContain("FNB_EXACT_RECIPE_INPUT_UNIT_MISMATCH");
  });

  it("refuses a choice group that the POS cannot show for the SKU", () => {
    expect(migration).toContain("FNB_EXACT_RECIPE_GROUP_NOT_EFFECTIVE_FOR_PRODUCT");
    expect(migration).toContain("g.channel in ('fnb', 'all')");
    expect(migration).toContain("product_modifier_groups own_link");
    expect(migration).toContain("category_modifier_groups target_link");
  });

  it("uses the snapshot factor from the BOM line before it writes a stock quantity", () => {
    expect(migration).toContain("min(coalesce(bi.conversion_factor, 1))");
    expect(migration).toContain("v_normalized_quantity := round(v_input_quantity * v_factor, 4)");
    expect(migration).toContain("'quantity', v_normalized_quantity");
    expect(migration).toContain("delete from public.bom_modifier_option_quantities");
  });

  it("refuses to guess the meaning of a legacy mapping", () => {
    expect(migration).toContain("FNB_00352_EXISTING_EXACT_MAPS_REQUIRE_REVIEW");
    expect(migration).toContain("if exists (select 1 from public.bom_modifier_option_quantities)");
  });

  it("keeps authenticated access only and completes the DDL transaction before reloading schema", () => {
    expect(migration).toContain("revoke all on function public.save_bom_modifier_option_quantities(uuid, jsonb)");
    expect(migration).toMatch(/grant execute on function public\.save_bom_modifier_option_quantities\(uuid, jsonb\)\s+to authenticated/);
    expect(migration).toContain("begin;");
    expect(migration).toMatch(/commit;\s+notify pgrst, 'reload schema'/);
  });

  it("does not offer a destructive rollback that would reopen the unit ambiguity", () => {
    expect(rollback).toContain("intentionally a no-op");
    expect(rollback).toContain("no safe data-preserving reversal");
  });

  it("ships read-only checks for both the stop condition and the installed guard", () => {
    expect(preflight).toContain("P2_CHUA_CO_DINH_LUONG_CU_CAN_RAP_RIEN");
    expect(postflight).toContain("K2_MAY_CHU_TU_QUY_DOI_VE_DON_VI_TON");
    expect(postflight).toContain("K3_CHAN_DON_VI_KHONG_KHOP_BOM");
    expect(postflight).toContain("K5_CHI_NHOM_HIEN_TREN_POS_MOI_DUOC_KHAI_DINH_LUONG");
    expect(executable(preflight)).not.toMatch(/\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i);
    expect(executable(postflight)).not.toMatch(/\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i);
  });
});
