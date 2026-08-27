import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/00354_fnb_branch_menu_exclusions.sql"),
  "utf8",
);
const rollback = readFileSync(
  resolve(process.cwd(), "supabase/migrations/00354_rollback_fnb_branch_menu_exclusions.sql"),
  "utf8",
);
const preflight = readFileSync(
  resolve(process.cwd(), "docs/qc/sql/00354-FNB-BRANCH-MENU-POLICY-PREFLIGHT-READONLY.sql"),
  "utf8",
);
const postflight = readFileSync(
  resolve(process.cwd(), "docs/qc/sql/00354-FNB-BRANCH-MENU-POLICY-POSTFLIGHT-READONLY.sql"),
  "utf8",
);

function executable(sql: string) {
  return sql.replace(/^\s*--.*$/gm, "");
}

describe("00354 - FnB branch menu policy", () => {
  it("extends 00353 without copying or weakening its kitchen guard", () => {
    expect(migration).toContain("FNB_00354_PREREQUISITE_00353_MISSING");
    expect(migration).toContain("rename to _fnb_send_to_kitchen_impl_00353");
    expect(migration).toContain("return public._fnb_send_to_kitchen_impl_00353(");
    expect(migration).toContain("FNB_MENU_POLICY_PRODUCT_NOT_AVAILABLE");
  });

  it("models one safe menu policy per SKU and backfills old scopes as whitelists", () => {
    expect(migration).toContain("fnb_product_branch_menu_policies_product_unique");
    expect(migration).toContain("mode in ('only', 'except')");
    expect(migration).toContain("select s.tenant_id, s.product_id, 'only'");
    expect(migration).toContain("FNB_00354_LEGACY_SCOPE_BACKFILL_INCOMPLETE");
  });

  it("allows only authenticated product editors to save all, only or except", () => {
    expect(migration).toContain("public.user_has_permission(v_actor, 'products.edit')");
    expect(migration).toContain("FNB_MENU_POLICY_MODE_INVALID");
    expect(migration).toContain("FNB_MENU_POLICY_BRANCH_INVALID");
    expect(migration).toContain("grant execute on function public.save_fnb_product_branch_menu_policy(uuid, text, uuid[])\n  to authenticated");
    expect(migration).toContain("save_fnb_product_branch_menu_scope");
  });

  it("commits schema work before schema reload and keeps rollback non-destructive", () => {
    expect(migration).toContain("commit;\n\nnotify pgrst, 'reload schema'");
    expect(rollback).toContain("intentionally a no-op");
    expect(rollback).toContain("would immediately show draft menu items again");
  });

  it("ships read-only prerequisite and post-install checks", () => {
    expect(preflight).toContain("P2_00354_CHUA_CAI");
    expect(postflight).toContain("K2_GUI_BEP_CHAN_MON_AN_THEO_CHI_NHANH");
    expect(postflight).toContain("K5_SCOPE_CU_DA_CO_NGHIA_CHINH_SACH");
    expect(executable(preflight)).not.toMatch(/\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i);
    expect(executable(postflight)).not.toMatch(/\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i);
  });
});
