import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/00353_fnb_branch_menu_isolation.sql"),
  "utf8",
);
const rollback = readFileSync(
  resolve(process.cwd(), "supabase/migrations/00353_rollback_fnb_branch_menu_isolation.sql"),
  "utf8",
);
const preflight = readFileSync(
  resolve(process.cwd(), "docs/qc/sql/00353-FNB-BRANCH-MENU-PREFLIGHT-READONLY.sql"),
  "utf8",
);
const postflight = readFileSync(
  resolve(process.cwd(), "docs/qc/sql/00353-FNB-BRANCH-MENU-POSTFLIGHT-READONLY.sql"),
  "utf8",
);

function executable(sql: string) {
  return sql.replace(/^\s*--.*$/gm, "");
}

describe("00353 - FnB branch menu isolation", () => {
  it("keeps legacy products global until an explicit whitelist exists", () => {
    expect(migration).toContain("SKU KHÔNG có dòng trong bảng mới: tiếp tục hiện ở mọi chi nhánh FnB");
    expect(migration).toContain("Empty array means restore the legacy all-FnB-branches behavior");
    expect(migration).toContain("delete from public.fnb_product_branch_menu_scopes");
  });

  it("guards the scope table by tenant, FnB SKU and active outlet", () => {
    expect(migration).toContain("fnb_product_branch_menu_scopes_unique");
    expect(migration).toContain("FNB_MENU_SCOPE_PRODUCT_NOT_FNB_SKU");
    expect(migration).toContain("FNB_MENU_SCOPE_BRANCH_NOT_FNB_OUTLET");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("grant select on table public.fnb_product_branch_menu_scopes to authenticated");
  });

  it("allows only authenticated product editors to save the atomic whitelist", () => {
    expect(migration).toContain("public.user_has_permission(v_actor, 'products.edit')");
    expect(migration).toContain("FNB_MENU_SCOPE_PERMISSION_DENIED");
    expect(migration).toContain("FNB_MENU_SCOPE_BRANCH_INVALID");
    expect(migration).toContain("grant execute on function public.save_fnb_product_branch_menu_scope(uuid, uuid[])\n  to authenticated");
    expect(migration).toContain("from public, anon, authenticated, service_role");
  });

  it("wraps the existing exact-recipe kitchen guard instead of replacing its business logic", () => {
    expect(migration).toContain("rename to _fnb_send_to_kitchen_impl_00350");
    expect(migration).toContain("FNB_MENU_SCOPE_PRODUCT_NOT_AVAILABLE");
    expect(migration).toContain("return public._fnb_send_to_kitchen_impl_00350(");
    expect(migration).toContain("FNB_00353_SEND_WRAPPER_NOT_ACTIVE");
  });

  it("commits schema work before schema reload and does not offer a dangerous rollback", () => {
    expect(migration).toContain("commit;\n\nnotify pgrst, 'reload schema'");
    expect(rollback).toContain("intentionally a no-op");
    expect(rollback).toMatch(/could let an old POS tab send a wrong-branch\s+-- kitchen order/);
  });

  it("ships read-only checks for both prerequisites and installed protections", () => {
    expect(preflight).toContain("P3_LOP_GUI_BEP_CO_THE_BOC_TIEP");
    expect(postflight).toContain("K2_GUI_BEP_CHAN_MON_NGOAI_PHAM_VI");
    expect(postflight).toContain("K4_HAM_NOI_BO_KHONG_MO_TRINH_DUYET");
    expect(postflight).toContain("K6_KHONG_CO_LINK_CHEO_TENANT_HOAC_SAI_KENH");
    expect(executable(preflight)).not.toMatch(/\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i);
    expect(executable(postflight)).not.toMatch(/\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i);
  });
});
