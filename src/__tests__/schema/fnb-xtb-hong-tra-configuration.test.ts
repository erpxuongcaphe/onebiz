import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const configure = readFileSync(
  resolve(process.cwd(), "docs/qc/sql/FNB-XTB-HONG-TRA-BUOC-2-CAU-HINH.sql"),
  "utf8",
);
const rollback = readFileSync(
  resolve(process.cwd(), "docs/qc/sql/FNB-XTB-HONG-TRA-HOAN-TAC.sql"),
  "utf8",
);
const postflight = readFileSync(
  resolve(process.cwd(), "docs/qc/sql/FNB-XTB-HONG-TRA-BUOC-3-KIEM-SAU.sql"),
  "utf8",
);

function executable(sql: string) {
  return sql.replace(/^\s*--.*$/gm, "");
}

describe("Hong Tra - pilot Xưởng Tư Búa", () => {
  it("targets exactly the approved tenant, SKU and pilot outlet", () => {
    expect(configure).toContain("148e8ac5-b891-4de3-9055-cfa41f39ddb0");
    expect(configure).toContain("SKU-HTR-001");
    expect(configure).toContain("Xưởng Cà Phê - Xưởng Tư Búa");
    expect(configure).toContain("FNB_XTB_HONG_TRA_TENANT_MISMATCH");
    expect(configure).toContain("FNB_XTB_HONG_TRA_BRANCH_NOT_UNIQUE_OR_NOT_OUTLET");
  });

  it("keeps the product override complete instead of hiding inherited ice or topping", () => {
    expect(configure).toContain("FNB_XTB_HONG_TRA_ICE_INHERITANCE_CHANGED");
    expect(configure).toContain("FNB_XTB_HONG_TRA_TOPPING_INHERITANCE_CHANGED");
    expect(configure).toContain("(v_tenant, v_product_id, v_ice_group_id, 0)");
    expect(configure).toContain("(v_tenant, v_product_id, v_sugar_group_id, 1)");
    expect(configure).toContain("(v_tenant, v_product_id, v_topping_group_id, 2)");
    expect(postflight).toContain("K3_TUY_CHON_HIEN_TREN_POS_DUNG_THU_TU");
    expect(postflight).toContain("K6_MUC_DUONG_CHUNG_KHONG_CON_HIEU_LUC_CHO_HONG_TRA");
  });

  it("uses exact measured sugar quantities with verified UOM conversion", () => {
    expect(configure).toContain("FNB_XTB_HONG_TRA_SUGAR_BOM_OR_UOM_CHANGED");
    expect(configure).toContain("when '60%' then 0.021");
    expect(configure).toContain("when '80%' then 0.028");
    expect(configure).toContain("when '100%' then 0.035");
    expect(configure).toContain("v_sugar_input_quantity is distinct from 35");
    expect(configure).toContain("v_tea_input_quantity is distinct from 6.8");
    expect(configure).toContain("v_cup_input_quantity is distinct from 1");
    expect(configure).toContain("FNB_XTB_HONG_TRA_TEA_BOM_OR_UOM_CHANGED");
    expect(configure).toContain("FNB_XTB_HONG_TRA_CUP_BOM_OR_UOM_CHANGED");
    expect(postflight).toContain("K5_BA_MUC_DUONG_CHINH_XAC");
    expect(postflight).toContain("'luong_pha_g'");
  });

  it("stops before overwriting a concurrent configuration", () => {
    expect(configure).toContain("FNB_XTB_HONG_TRA_PRODUCT_OVERRIDE_ALREADY_EXISTS");
    expect(configure).toContain("FNB_XTB_HONG_TRA_MENU_SCOPE_ALREADY_EXISTS");
    expect(configure).toContain("FNB_XTB_HONG_TRA_EXACT_MAP_ALREADY_EXISTS");
    expect(configure).toContain("begin;");
    expect(configure).toContain("commit;");
  });

  it("has a narrowly guarded rollback and a read-only postflight", () => {
    expect(rollback).toContain("FNB_XTB_HONG_TRA_ROLLBACK_SCOPE_CHANGED");
    expect(rollback).toContain("FNB_XTB_HONG_TRA_ROLLBACK_EXACT_MAP_CHANGED");
    expect(rollback).toContain("delete from public.bom_modifier_option_quantities where bom_id = v_bom_id");
    expect(rollback).toContain("set modifier_scale_target = null");
    expect(postflight).toContain("K1_DUNG_TENANT_VA_SAN_PHAM");
    expect(postflight).toContain("K2_MENU_CHI_XUONG_TU_BUA");
    expect(executable(postflight)).not.toMatch(/\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i);
  });

  it("does not manipulate business documents or inventory movements", () => {
    expect(configure).not.toMatch(/public\.(?:invoices|sales_orders|kitchen_orders|inventory_movements|stock_movements)\b/i);
    expect(rollback).not.toMatch(/public\.(?:invoices|sales_orders|kitchen_orders|inventory_movements|stock_movements)\b/i);
  });
});
