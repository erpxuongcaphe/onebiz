import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8").toLowerCase();
const migration = read("supabase/migrations/00357_atomic_fnb_size_setup.sql");
const rollback = read(
  "supabase/migrations/00357_rollback_atomic_fnb_size_setup.sql",
);
const service = read("src/lib/services/supabase/variants.ts");
const dialog = read("src/components/shared/dialogs/create-product-dialog.tsx");
const preflight = read(
  "docs/qc/sql/00357-FNB-SIZE-ATOMIC-PREFLIGHT-READONLY.sql",
);
const postflight = read(
  "docs/qc/sql/00357-FNB-SIZE-ATOMIC-POSTFLIGHT-READONLY.sql",
);

describe("00357 atomic FnB size setup", () => {
  it("saves variants, BOM items and exact quantities in one guarded RPC", () => {
    expect(migration).toContain(
      "create or replace function public.save_fnb_size_setup_atomic",
    );
    expect(migration).toContain("products.edit");
    expect(migration).toContain("for update");
    expect(migration).toContain("delete from public.bom_items");
    expect(migration).toContain("save_bom_modifier_option_quantities");
    expect(migration).toContain("fnb_size_setup_variant_id_duplicate");
    expect(migration).toContain("update public.product_variants");
    expect(migration).toContain("set is_active = false");
  });

  it("keeps the RPC authenticated-only", () => {
    expect(migration).toContain(
      "from public, anon, authenticated, service_role",
    );
    expect(migration).toContain("to authenticated");
    expect(migration).not.toContain("to anon");
  });

  it("routes FnB per-size saves through the atomic RPC", () => {
    expect(service).toContain('"save_fnb_size_setup_atomic"');
    expect(service).toContain("result?.success === true");
    expect(service).toContain("saved.length === variants.length");
    expect(service).toContain("await getvariantsbyproduct(productid)");
    expect(service).toContain("error.details");
    expect(dialog).toContain("await savefnbsizesetupatomic(");
    expect(dialog).not.toContain("async function syncpersizerecipes");
    expect(dialog).toContain('setinnertab("variants")');
  });

  it("does not mutate business data in migration or rollback", () => {
    const beforeFunction = migration.split("create or replace function")[0];
    expect(beforeFunction).not.toMatch(
      /\b(update|delete from|insert into) public\.(products|product_variants|bom|bom_items)/,
    );
    expect(rollback).toContain(
      "drop function if exists public.save_fnb_size_setup_atomic",
    );
    expect(rollback).not.toMatch(/\b(update|delete from|insert into) public\./);
  });

  it("ships read-only preflight and postflight checks", () => {
    for (const sql of [preflight, postflight]) {
      expect(sql).toContain("read only");
      expect(sql).not.toMatch(/^\s*(update|delete from|insert into) public\./m);
    }
    expect(preflight).toContain("p3_00357_chua_cai");
    expect(postflight).toContain("k3_quyen_goi");
  });
});
