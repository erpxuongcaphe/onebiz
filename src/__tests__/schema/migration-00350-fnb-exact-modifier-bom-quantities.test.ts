import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00350_fnb_exact_modifier_bom_quantities.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/migrations/00350_rollback_fnb_exact_modifier_bom_quantities.sql",
  "utf8",
);
const preflight = readFileSync(
  "docs/qc/sql/00350-FNB-EXACT-MODIFIER-PREFLIGHT-READONLY.sql",
  "utf8",
);
const postflight = readFileSync(
  "docs/qc/sql/00350-FNB-EXACT-MODIFIER-POSTFLIGHT-READONLY.sql",
  "utf8",
);

function withoutFunctionBodies(sql: string) {
  return sql
    .replace(/\$function\$[\s\S]*?\$function\$/g, "")
    .replace(/^\s*--.*$/gm, "");
}

describe("00350 - exact FnB modifier recipe quantities", () => {
  it("adds configuration only, never rewrites existing business rows", () => {
    const topLevel = withoutFunctionBodies(migration);
    expect(migration).toContain("begin;");
    expect(migration).toContain("commit;");
    expect(migration).toContain("bom_modifier_option_quantities");
    expect(migration).toContain("trg_enforce_bom_modifier_option_quantity_00350");
    expect(migration).toContain("save_bom_modifier_option_quantities");
    expect(migration).toContain("grant select on table public.bom_modifier_option_quantities to authenticated");
    expect(migration).toContain("revoke all on table public.bom_modifier_option_quantities from public, anon");
    expect(topLevel).not.toMatch(
      /^\s*(?:insert\s+into|update\s+public\.|delete\s+from|truncate\s+)/gim,
    );
  });

  it("uses an exact BOM x material x option record before falling back to the legacy factor", () => {
    expect(migration).toContain("FNB_EXACT_RECIPE_OPTION_MISSING");
    expect(migration).toContain("FNB_EXACT_RECIPE_SELECTION_REQUIRED");
    expect(migration).toContain("v_exact_quantity * (1 + v_item.waste_percent / 100) * p_qty");
    expect(migration).toContain("else 'legacy_scale' end");
    expect(migration).toContain("v_item.quantity * (1 + v_item.waste_percent / 100) * p_qty * v_modifier_scale");
  });

  it("blocks an incomplete exact configuration before the kitchen order is written", () => {
    const sendWrapperStart = migration.indexOf(
      "create or replace function public.fnb_send_to_kitchen_atomic_v2",
    );
    const sendWrapper = migration.slice(sendWrapperStart, migration.indexOf("-- ── 4.", sendWrapperStart));
    expect(sendWrapper).toContain("FNB_EXACT_RECIPE_OPTION_MISSING");
    expect(sendWrapper).toContain("return public._fnb_send_to_kitchen_impl_00330");
    expect(sendWrapper.indexOf("FNB_EXACT_RECIPE_OPTION_MISSING")).toBeLessThan(
      sendWrapper.indexOf("return public._fnb_send_to_kitchen_impl_00330"),
    );
  });

  it("makes each material's exact recipe cover every active option before replacing rows", () => {
    const saveStart = migration.indexOf(
      "create or replace function public.save_bom_modifier_option_quantities",
    );
    const saveRpc = migration.slice(saveStart, migration.indexOf("-- ── 3.", saveStart));
    expect(saveRpc).toContain("FNB_EXACT_RECIPE_GROUP_INCOMPLETE");
    expect(saveRpc).toContain("v_provided_count <> v_expected_count");
    expect(saveRpc.indexOf("FNB_EXACT_RECIPE_GROUP_INCOMPLETE")).toBeLessThan(
      saveRpc.indexOf("delete from public.bom_modifier_option_quantities"),
    );
  });

  it("keeps void/return symmetric by restoring from movements, not recalculating an option", () => {
    expect(migration).not.toContain("fnb_void_invoice_atomic(");
    expect(migration).not.toContain("restore_bom_for_return(");
    expect(migration).toContain("Hủy bill vẫn hoàn theo stock_movements đã ghi");
  });

  it("has a guarded rollback that restores both public entry points", () => {
    expect(rollback).toContain("FNB_00350_ROLLBACK_EXACT_RECIPES_EXIST");
    expect(rollback).toContain("FNB_00350_ROLLBACK_EXACT_SALE_EXISTS");
    expect(rollback).toContain("rename to fnb_send_to_kitchen_atomic_v2");
    expect(rollback).toContain("create or replace function public.consume_bom_for_sale");
    expect(rollback).toContain("drop function if exists public.save_bom_modifier_option_quantities");
    expect(rollback).toContain("drop table if exists public.bom_modifier_option_quantities");
  });

  it("ships read-only before/after checks locked to the verified tenant", () => {
    const executablePreflight = preflight.replace(/--.*$/gm, "");
    const executablePostflight = postflight.replace(/--.*$/gm, "");
    expect(preflight).toContain("148e8ac5-b891-4de3-9055-cfa41f39ddb0");
    expect(preflight).not.toMatch(/DAN_TENANT|TENANT_ID_VAO_DAY/i);
    expect(executablePreflight).not.toMatch(/\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i);
    expect(executablePostflight).not.toMatch(/\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i);
    expect(postflight).toContain("K3_THANH_TOAN_DUNG_DINH_LUONG");
  });
});
