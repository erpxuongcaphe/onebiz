import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8").toLowerCase();
const migration = read(
  "supabase/migrations/00366_adopt_legacy_bom_before_fnb_size_setup.sql",
);
const rollback = read(
  "supabase/migrations/00366_rollback_adopt_legacy_bom_before_fnb_size_setup.sql",
);
const preflight = read(
  "docs/qc/sql/00366-FNB-SIZE-LEGACY-BOM-PREFLIGHT-READONLY.sql",
);
const postflight = read(
  "docs/qc/sql/00366-FNB-SIZE-LEGACY-BOM-POSTFLIGHT-READONLY.sql",
);

describe("00366 legacy parent BOM adoption", () => {
  it("wraps 00357 and archives only an unowned same-product BOM code", () => {
    expect(migration).toContain("rename to save_fnb_size_setup_atomic_00357");
    expect(migration).toContain("bom.product_id = p_product_id");
    expect(migration).toContain("bom.variant_id is null");
    expect(migration).toContain("existing_variant.is_active");
    expect(migration).toContain("'-legacy-'");
    expect(migration).toContain(
      "return public.save_fnb_size_setup_atomic_00357(p_product_id, p_variants)",
    );
  });

  it("keeps both product permissions and tenant guards", () => {
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("products.edit");
    expect(migration).toContain("product.tenant_id = v_tenant");
    expect(migration).toContain("for update");
  });

  it("exposes only the wrapper to authenticated users", () => {
    expect(migration).toContain(
      "revoke all on function public.save_fnb_size_setup_atomic_00357",
    );
    expect(migration).toContain("to authenticated");
    expect(postflight).toContain("k3_ham_nen_khong_mo_cho_trinh_duyet");
    expect(postflight).toContain("k4_quyen_goi_wrapper");
  });

  it("ships a non-destructive rollback and read-only checks", () => {
    expect(rollback).toContain("rename to save_fnb_size_setup_atomic");
    expect(rollback).not.toMatch(/\b(update|delete from|insert into) public\./);
    for (const sql of [preflight, postflight]) {
      expect(sql).toContain("read only");
      expect(sql).not.toMatch(/^\s*(update|delete from|insert into) public\./m);
    }
  });
});
